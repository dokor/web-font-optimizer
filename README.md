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

L’analyseur HTML et le décodeur Google Fonts sont disponibles via l’API
optionnelle décrite ci-dessous. Leur branchement au registre de production
appartient au lot d’intégration.

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

## HTML et Google Fonts (#3)

L’analyseur optionnel utilise `parse5` pour lire les balises et leurs positions
sans exécuter le document.

```ts
import { htmlAnalyzer, scan, decodeGoogleFontsUrl } from 'web-font-optimizer';

const result = await scan('./index.html', [htmlAnalyzer]);
const request = decodeGoogleFontsUrl(
  'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700&family=Lora',
  { file: 'src/style.css', line: 1, column: 14 },
);
```

`htmlAnalyzer` (ou `analyzeHtml(source)` pour du texte en mémoire) recense les
`link[rel=stylesheet]`, `link[rel=preload][as=font]` et `link[rel=preconnect]`.
Chaque ressource conserve le contenu original du `href`, y compris les entités
comme `&amp;`, et la position du premier caractère de sa valeur. Les commentaires,
les chaînes des scripts et les contenus inertes des `template` sont ignorés.
Le HTML est interprété avec les scripts activés : le contenu de `noscript` est
donc ignoré. Aucun script n’est exécuté.

Seules les feuilles Google Fonts produisent des observations `declaration` de
familles et variantes. Une préconnexion ou un préchargement reste une ressource,
sans famille ni preuve d’usage. L’analyse ne télécharge aucune ressource et
n’émet aucune observation `usage`.

Le décodeur pur `decodeGoogleFontsUrl(url, location)` accepte les URL HTTP(S) et
les URL sans protocole vers `fonts.googleapis.com/css` ou `/css2` ; il retourne
`undefined` pour les autres sources. Il reçoit une URL extraite de sa syntaxe :
le parseur HTML décode les entités ; l’appelant CSS doit décoder les échappements
CSS avant l’appel. Le résultat conserve l’URL fournie et sa position, sans
normaliser la preuve originale.

Les familles multiples, les alias CSS (`bold`, `italic`, `bi`, `700i`…), les
tuples CSS2 `ital,wght` et les intervalles variables sont décodés. Les axes
`wght`, `ital` et `wdth` sont représentés par `weight`, `style` et `stretch` ;
les valeurs par défaut connues sont 400 et normal, les intervalles sont conservés
comme `100 900`. `display` et `subset` sont conservés quand présents.
Les syntaxes et axes non compris produisent `complete: false` et des `issues` ;
les familles et variantes comprises restent disponibles. Le HTML conserve la
ressource et ajoute des observations `indeterminate` avec leur position et la
raison, même si aucune famille n’a pu être décodée. Cette lecture n’est pas une
validation de la disponibilité d’une famille ou de toutes les contraintes de
l’API Google Fonts.

Le registre par défaut et la CLI restent au socle de découverte. Le branchement
aux observations CSS et au registre de production appartient au lot #8.

Références de syntaxe : [API CSS](https://developers.google.com/fonts/docs/getting_started)
et [API CSS2](https://developers.google.com/fonts/docs/css2). Les cas d’acceptation
sont dans `test/html.test.js`, `test/google-fonts.test.js` et
`test/fixtures/html/vite/index.html`.
