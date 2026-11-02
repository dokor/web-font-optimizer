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
Le moteur `buildAuditReport` transforme les observations en inventaire et en
diagnostics via l’API, sans nouvelle dépendance d’exécution. Il est utilisable
avec des observations synthétiques ou des analyseurs injectés.
**Le binaire découvre actuellement les sources et affiche leur nombre.** Son
registre d’analyseurs est vide par défaut ; il ne produit pas encore d’audit
complet ni de diagnostics.

Le MVP prévoit des analyseurs CSS/SCSS et CSS Modules, HTML/Google Fonts,
React et `next/font`, des sorties terminal et JSON,
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

Le contrat `AuditReportV1` définit le rapport JSON produit par `buildAuditReport`
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
- La taille sur disque d’une ressource locale, inventoriée par l’API du moteur,
  ne mesure pas une économie réseau. La taille des ressources distantes reste
  inconnue sans téléchargement.
- Les correctifs automatiques, le rapport Markdown, les plugins de formatage
  et le score global sont hors du périmètre du MVP.

## Rapprocher les observations (#6)

`buildAuditReport` est exporté depuis `web-font-optimizer`. Il accepte les
observations du contrat partagé, y compris des entrées synthétiques, sans
registre d’analyseurs ni exécution du projet. Cet exemple réutilise l’analyseur
`example` défini plus haut :

```ts
import { buildAuditReport, scan } from 'web-font-optimizer';

const scanResult = await scan('./mon-projet', [example]);
const report = await buildAuditReport(scanResult.observations, { root: './mon-projet' });
console.log(JSON.stringify(report, null, 2));
```

`root` désigne la racine du scan (le dossier parent pour le scan d’un fichier
seul) et vaut `.` par défaut. Les sources de type `file` sont des chemins de
fichiers résolus relativement au fichier de l’observation. Le moteur lit leurs
métadonnées, uniquement à l’intérieur de cette racine, sans écrire ni télécharger
de ressource. Les URL, les chemins inaccessibles et les répertoires n’ont pas de
`sizeBytes`. Un fichier local partagé, y compris par plusieurs chemins relatifs
ou liens symboliques accessibles, n’apparaît qu’une fois dans les ressources,
avec tous ses emplacements. Sa taille sur disque **ne représente pas une
économie réseau** : cache, compression, sous-ensembles et formats de repli
nécessitent une vérification dans le navigateur.

Les observations restent intégralement consultables ; leurs tableaux de
variantes, sous-ensembles et sources conservent leur ordre. Le moteur trie les
observations, les ressources, les diagnostics et leurs emplacements pour produire
le même JSON quel que soit l’ordre d’entrée, sans modifier les entrées. Les
ressources sont regroupées par identité ; l’observation conserve le chemin
original de chaque référence, et l’entrée de ressource retient une référence
représentative choisie de manière déterministe.

| `ruleId` stable | Gravité / confiance | Interprétation |
| --- | --- | --- |
| `duplicate-load` | `warning` / `certain` | Même chargement observé à plusieurs emplacements dans un même contexte, avec mêmes origine, variantes, sources ordonnées et descripteurs. Sans contexte explicite, la comparaison stricte reste limitée au même fichier. La certitude porte sur la répétition observée. |
| `possible-overlap` | `info` / `possible` ou `probable` | Même famille via des origines différentes (par exemple Google Fonts et `next/font`), ou même source dans plusieurs contextes. Une plage de variantes connue et commune dans le même contexte rend le rapprochement probable. |
| `no-static-usage` | `info` / `possible` | Famille ou variante déclarée/chargée sans usage statique compatible dans sa portée. Vérifier avant de supprimer. |
| `undeclared-family` | `info` / `possible` | Famille utilisée sans déclaration/chargement connu compatible. Vérifier les feuilles externes et polices installées. |

Les portées sont des identités opaques : une déclaration sans contexte peut
servir un usage de toute portée ; deux contextes explicites différents ne
prouvent pas un usage commun. Ils ne prouvent pas non plus que les chargements
s’excluent à l’exécution, d’où un chevauchement seulement possible. Une portée
inconnue reste ambiguë. Des `unicode-range` disjoints ou des graisses/styles/
étirements connus disjoints excluent le chevauchement. Une plage variable couvre
les graisses incluses ; un descripteur omis reste inconnu. Une graisse isolée
ne permet jamais de déduire une famille. Les sources d’un même `src` sont des
formats de repli, et ne constituent pas des chargements répétés.

Les piles génériques et les familles système courantes ne demandent pas de
déclaration. Les variables CSS littérales et leurs alias sont résolus dans la
portée connue, avec priorité à une définition de cette portée sur une définition
globale. Les cycles, définitions contradictoires, expressions dynamiques et
références non résolues restent indéterminés : ils empêchent de conclure à
l’absence d’usage dans les portées concernées. Le moteur n’évalue ni la cascade,
ni le JavaScript, ni la coexistence effective des pages au runtime.

Les tests `test/engine.test.js` couvrent les répétitions, le chevauchement CDN/Next,
les contre-exemples du MVP, les variables et portées, les tailles et ressources
manquantes, ainsi que toutes les 120 permutations d’un jeu d’observations mixte.
