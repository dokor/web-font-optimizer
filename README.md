# web-font-optimizer

CLI d’audit statique des polices web, développée en TypeScript pour
**Node.js 22 ou ultérieur** (ES modules).

Le projet vise les applications **React, notamment avec Vite, et Next.js** :
recenser les déclarations, les chargements et les usages de polices, puis aider
à repérer les doublons et les incohérences. L’audit est en lecture seule : il
ne modifie pas les sources, n’exécute pas le projet analysé et ne télécharge
pas les polices ni les feuilles de style distantes.

## État actuel

Le socle est disponible sur `main` : découverte des fichiers, API de scan avec
analyseurs injectables, contrats d’observation et exemple de rapport v1.
**Le binaire découvre actuellement les sources et affiche leur nombre.** Son
registre d’analyseurs est vide par défaut ; il ne produit pas encore d’audit
complet ni de diagnostics.

L’analyseur React est disponible via l’API injectable décrite ci-dessous.
Son parseur TypeScript et son décodeur de valeurs CSS sont des dépendances
d’exécution du paquet.

Le reste du MVP prévoit des analyseurs CSS/SCSS et CSS Modules, HTML/Google Fonts
et `next/font`, un moteur de diagnostics, des sorties terminal et JSON,
et une option CI pour échouer sur les doublons certains. Ces fonctions font
l’objet des lots ci-dessous ; les options `--report json` et
`--fail-on-duplicates` ne sont pas encore disponibles dans le socle.

Le suivi d’ensemble et les critères de livraison sont dans
[l’issue de pilotage #9](https://github.com/dokor/web-font-optimizer/issues/9).

## Démarrer depuis le dépôt

```sh
git clone https://github.com/dokor/web-font-optimizer.git
cd web-font-optimizer
npm ci
npm run typecheck
npm run build
npm test
npm exec --offline -- web-font-optimizer --help
npm exec --offline -- web-font-optimizer scan ./src
```

Ces commandes utilisent le binaire construit depuis le dépôt et ne nécessitent
pas de publication npm. `--offline` s’applique à l’exécution locale après
l’installation des dépendances.

Exemple avec un seul fichier source du dépôt :

```sh
npm exec --offline -- web-font-optimizer scan ./src/discovery.ts
```

```text
Fichiers sources découverts : 1
```

`scan [chemin]` accepte un répertoire (par défaut, le répertoire courant) ou
un fichier pris en charge. La découverte trie les chemins et reconnaît HTML,
CSS, SCSS, JS, JSX, TS et TSX, y compris les CSS Modules. Elle ignore les
répertoires `node_modules`, `.next`, `dist`, `build` et `.git` et ne suit pas
les liens symboliques rencontrés.

| Code de sortie actuel | Signification |
| --- | --- |
| `0` | Aide affichée ou découverte réussie |
| `2` | Arguments invalides, chemin inaccessible, extension non prise en charge ou erreur d’exécution ; message sur stderr |

## Écrire et tester un analyseur

Importer les types depuis `web-font-optimizer/contracts`. Un analyseur reçoit
le texte UTF-8 d’un fichier et retourne des observations, directement ou via une
promesse. Il travaille sur ce texte sans écrire, exécuter le projet ni télécharger
de ressource. Pour le tester isolément, appeler `analyze` avec un exemple en mémoire :

```ts
import type { Analyzer } from 'web-font-optimizer/contracts';

const example: Analyzer = {
  id: 'example-css',
  languages: ['css'],
  analyze({ file, text }) {
    if (!text.startsWith('body { font-family: Atlas;')) return [];
    return [{
      kind: 'usage', origin: 'font-family', family: 'Atlas',
      location: { file, line: 1, column: 8 },
    }];
  },
};

const observations = await example.analyze({
  file: 'body.css', language: 'css', text: 'body { font-family: Atlas; }',
});
```

Pour passer par la découverte réelle, appeler `scan(chemin, [example])` depuis
`web-font-optimizer`. Le registre est la liste fournie à cet appel. Un fichier
partagé par plusieurs analyseurs est lu une seule fois, puis transmis dans
l’ordre du registre. Le résultat sépare les fichiers découverts des observations.

Les chemins du contrat sont relatifs à la racine du scan, avec des séparateurs
`/` ; pour un fichier seul, la racine est son dossier parent. Les lignes et
colonnes commencent à 1 (colonnes en unités UTF-16). Conserver les variantes,
l’ordre des sources de repli et les contextes connus. Omettre un champ inconnu ;
pour une expression non résolue, émettre une observation `indeterminate` avec
sa position, son texte et la raison.

## Analyser React et Vite (#4)

```js
import { reactAnalyzer, scan } from 'web-font-optimizer';

const { files, observations } = await scan('./mon-app-vite', [reactAnalyzer]);
```

`reactAnalyzer` accepte JS, JSX (également dans `.js`), TS et TSX. Il analyse le
texte en mémoire, sans lire de configuration, résoudre les imports, installer
React/Vite/Next, exécuter l’application ou accéder au réseau. La fixture
`test/fixtures/react-vite` s’analyse sans installer ses dépendances.
Le registre du binaire reste réservé au lot d’intégration #8.

Les imports ES locaux `.css` et `.scss`, dont les CSS Modules, produisent des
ressources `react:stylesheet-import`. Leur chemin est normalisé relativement à
la racine du scan, sans suffixe de requête ou fragment. L’analyseur ne parcourt
pas ces imports : la découverte du socle visite chaque feuille une seule fois,
même si plusieurs composants l’importent. Ajouter l’analyseur CSS au registre
pour extraire le contenu des feuilles ; React n’invente pas leur contenu.

Les attributs JSX `style={{…}}` et les objets `style` explicites des appels à
`createElement` importé de React produisent des observations pour `fontFamily`,
`fontWeight`, `fontStyle` et `font`. Les chaînes, nombres de poids, constantes
primitives locales et enveloppes TypeScript (`as`, `satisfies`) sont reconnus.
Les usages conservent `value`, la pile de familles et les variantes explicites
identifiables. Les références `var(--nom)` deviennent des observations
`variable` et la valeur CSS reste `indeterminate` sans résolution des variables.
Les expressions dynamiques, objets style indirects, spreads et propriétés
calculées inconnues restent `indeterminate`, avec texte, raison et position ;
ils n’interrompent pas le scan. Les raccourcis système (`font: 'menu'`, etc.)
et les valeurs héritées restent également indéterminés.

Les accès directs `styles.title` et `styles['title']` aux imports par défaut ou
namespace de `.module.css` / `.module.scss` produisent un usage
`react:css-module`, avec `cssModule: { stylesheet, className }` et
`context: 'static-code-reference'`. Les variables locales masquant l’import
sont respectées ; les clés dynamiques restent indéterminées. Une référence,
même dans une fonction inutilisée, prouve sa présence dans le code uniquement.
Elle ne prouve ni l’existence de la classe dans la feuille ni un rendu dans le
navigateur, et n’attribue aucune famille de police à la classe.
Les appels et imports `next/font` restent du ressort du lot Next #5.

Validation : `npm run typecheck` puis `npm test`. Les tests React couvrent
chaque critère d’acceptation, les positions UTF-16, les valeurs inconnues,
les imports partagés et l’absence de modification de la fixture Vite.

## Rapport v1 et répartition des lots

Le contrat `AuditReportV1` définit le rapport JSON que le moteur devra produire
à partir des observations. L’inventaire conserve les observations et les
ressources distinctes ; `sizeBytes` est absent si la taille est inconnue.
Un diagnostic lie un `ruleId` stable à une gravité, une confiance, au moins
un emplacement et un conseil. Les sorties peuvent importer `exampleReport` depuis
`web-font-optimizer/examples/report-v1` sans lancer de scan.

| Lot | Point d’extension | Validation isolée |
| --- | --- | --- |
| [Socle (#1)](https://github.com/dokor/web-font-optimizer/issues/1), livré | `src/contracts.ts`, `src/discovery.ts`, `src/scan.ts` | Découverte, injection et rapport d’exemple |
| [CSS / SCSS (#2)](https://github.com/dokor/web-font-optimizer/issues/2) | `src/analyzers/css/` | Feuilles et CSS Modules synthétiques |
| [HTML / Google Fonts (#3)](https://github.com/dokor/web-font-optimizer/issues/3) | `src/analyzers/html/`, `src/sources/google-fonts.ts` | HTML et décodage pur des URL |
| [React (#4)](https://github.com/dokor/web-font-optimizer/issues/4) | `src/analyzers/react/` | JS, JSX, TS et TSX sans Next.js |
| [Next (#5)](https://github.com/dokor/web-font-optimizer/issues/5) | `src/analyzers/next/` | Texte contenant des appels à `next/font` |
| [Moteur (#6)](https://github.com/dokor/web-font-optimizer/issues/6) | `src/engine/` | Observations synthétiques → rapport v1 |
| [Sorties et politique CI (#7)](https://github.com/dokor/web-font-optimizer/issues/7) | `src/reporters/` | Rapport v1 → terminal, JSON et statut |
| [Intégration (#8)](https://github.com/dokor/web-font-optimizer/issues/8) | `src/cli.ts` et registre de production | Binaire empaqueté sur les deux projets de référence |

Les chemins des lots suivants sont des emplacements proposés. Chaque lot peut
ajouter ses tests et ses fixtures sans modifier le registre des autres.

## Limites et périmètre

- Une référence dans le code ne prouve pas qu’une police est rendue ou chargée
  dans le navigateur. L’absence d’usage statique ne prouve pas qu’elle est inutile.
- Les expressions dynamiques ou les rapprochements ambigus doivent rester
  signalés comme tels ; ils ne justifient pas une suppression automatique.
- La taille sur disque d’une ressource locale, lorsqu’elle sera inventoriée,
  ne mesure pas une économie réseau. La taille des ressources distantes reste
  inconnue sans téléchargement.
- Les correctifs automatiques, le rapport Markdown, les plugins de formatage
  et le score global sont hors du périmètre du MVP.
