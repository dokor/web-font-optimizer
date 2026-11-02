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

Le MVP prévoit des analyseurs CSS/SCSS et CSS Modules, HTML/Google Fonts,
React et `next/font`, un moteur de diagnostics, des sorties terminal et JSON,
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

## Analyseur CSS et SCSS

```ts
import { scan } from 'web-font-optimizer';
import { cssAnalyzer } from 'web-font-optimizer/analyzers/css';

const result = await scan('./src', [cssAnalyzer]);
console.log(result.observations);
```

L’analyseur fonctionne également en mémoire avec `cssAnalyzer.analyze`.
Il utilise PostCSS, son parseur SCSS et `postcss-value-parser`, sans dépendance
à un framework.
Il accepte CSS, SCSS et leurs CSS Modules. Il conserve les déclarations
`@font-face`, leurs sources ordonnées, les ressources et les imports avec
leurs URL brutes. Il extrait les piles de familles, graisses et styles des
propriétés explicites et du raccourci `font`. Les observations d’usage d’un
même bloc partagent un contexte de sélecteur et d’ancêtres (dont `@media`).
Les positions pointent au début de la déclaration, du descripteur de ressource
ou de la directive ; les références de variables pointent sur la référence.

Les alias simples suivent la portée lexicale SCSS ou une définition CSS locale
ou `:root` unique et inconditionnelle. Une pile de repli de `var()` est utilisable
si aucune définition du nom n’existe dans le fichier. Les cycles, définitions
concurrentes, interpolations, valeurs calculées non prises en charge et portées
SCSS conditionnelles produisent des observations indéterminées. Les observations
statiques du reste du fichier sont conservées.

L’analyse ne résout pas la cascade du navigateur, les alias entre fichiers ni
les mixins et fonctions Sass. Un poids isolé ne reçoit pas de famille inférée.
Les imports ne sont ni téléchargés ni exécutés. Le décodage Google Fonts et
l’enregistrement dans la CLI sont réservés aux lots #3 et #8.

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
