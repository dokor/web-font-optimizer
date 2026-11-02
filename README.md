# web-font-optimizer

CLI d’audit statique des polices web, développée en TypeScript pour
**Node.js 22 ou ultérieur** (ES modules).

Le projet vise les applications **React, notamment avec Vite, et Next.js** :
recenser les déclarations, les chargements et les usages de polices, puis aider
à repérer les doublons et les incohérences. L’audit est en lecture seule : il
ne modifie pas les sources, n’exécute pas le projet analysé et ne télécharge
pas les polices ni les feuilles de style distantes.

## État actuel

Le socle fournit la découverte des fichiers, une API de scan avec analyseurs
injectables, les contrats d’observation et un exemple de rapport v1. Le binaire
sait rendre un rapport dans le terminal ou en JSON et appliquer la politique CI.
**Le registre d’analyseurs est vide par défaut et le moteur n’est pas encore
raccordé** : le binaire affiche actuellement un inventaire vide, qui ne constitue
pas encore un audit des usages. L’assemblage de production est prévu dans le lot
#8. Le paquet n’a aucune dépendance d’exécution.

Le MVP prévoit des analyseurs CSS/SCSS et CSS Modules, HTML/Google Fonts,
React et `next/font`, et un moteur de diagnostics. Les lots ci-dessous détaillent
ces fonctions et leur intégration avec les sorties et la politique CI.

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
npm exec --offline -- web-font-optimizer scan ./src --report json --fail-on-duplicates
```

Ces commandes utilisent le binaire construit depuis le dépôt et ne nécessitent
pas de publication npm. `--offline` s’applique à l’exécution locale après
l’installation des dépendances.

Exemple avec un seul fichier source du dépôt :

```sh
npm exec --offline -- web-font-optimizer scan ./src/discovery.ts
```

```text
Audit des polices — rapport v1
Inventaire : 0 observation(s), 0 ressource(s) distincte(s)
  Aucune observation.

Ressources distinctes :
  Aucune ressource.

Diagnostics : 0
  Aucun diagnostic.
```

`scan [chemin]` accepte un répertoire (par défaut, le répertoire courant) ou
un fichier pris en charge. La découverte trie les chemins et reconnaît HTML,
CSS, SCSS, JS, JSX, TS et TSX, y compris les CSS Modules. Elle ignore les
répertoires `node_modules`, `.next`, `dist`, `build` et `.git` et ne suit pas
les liens symboliques rencontrés.

## Sorties et statut CI

`scan [chemin]` rend par défaut l’inventaire, les ressources distinctes et les
diagnostics dans le terminal. Chaque diagnostic indique sa règle, sa gravité,
sa certitude, tous ses emplacements `fichier:ligne:colonne` et l’action proposée.
Les familles, contextes et variantes sont repris des observations aux mêmes
emplacements ; aucune variante inconnue n’est déduite. Les tailles inconnues
restent inconnues ; les tailles sur disque ne mesurent pas une économie réseau.

`--report json` (ou `--report=json`) écrit uniquement le rapport `AuditReportV1`
sur stdout, sans couleur ni préambule. Les erreurs d’invocation, d’accès ou
d’exécution vont sur stderr. Le JSON reste complet et parseable lorsqu’un
doublon déclenche le statut CI. `--report terminal` sélectionne explicitement
le rendu terminal. Les options peuvent précéder ou suivre le chemin ; `--`
permet de passer un chemin commençant par un tiret.

| Code | Signification |
| --- | --- |
| `0` | Aide ou audit accepté, y compris avec avertissements ou doublons sans option CI |
| `1` | `--fail-on-duplicates` activé et au moins un diagnostic `duplicate-load` de confiance `certain` |
| `2` | Invocation invalide, chemin inaccessible/non pris en charge ou erreur d’exécution |

La politique CI utilise uniquement l’identifiant de règle et la confiance du
diagnostic, quelle que soit sa gravité. Les doublons possibles ou probables et
les autres règles restent consultatifs, même avec `--fail-on-duplicates`.

Pour tester ou raccorder les sorties indépendamment du moteur :

```ts
import { exampleReport } from 'web-font-optimizer/examples/report-v1';
import { renderTerminal, renderJson, getExitCode, runCli } from 'web-font-optimizer/reporters';

process.stdout.write(renderTerminal(exampleReport));
const json = renderJson(exampleReport);
const status = getExitCode(exampleReport, { failOnDuplicates: true }); // 0

// Le pipeline injecté doit retourner le rapport du moteur ; il est appelé une fois.
const code = await runCli(['scan', '.', '--report', 'json', '--fail-on-duplicates'], {
  audit: async target => exampleReport, // Remplacer par le pipeline scan → moteur.
  stdout: text => { process.stdout.write(text); },
  stderr: text => { process.stderr.write(text); },
});
process.exitCode = code;
```

Les deux reporters et la politique consomment le même rapport sans recalculer
les règles ni modifier le résultat du moteur. `runCli` retourne le code de sortie
sans modifier les variables globales du processus. `npm test` vérifie les rapports
vide, consultatif et avec doublon certain, les deux formats, les codes réels de
processus et les erreurs de chemin. Les tests avec diagnostic injectent un
rapport synthétique, en attendant le raccordement de production du lot #8.

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
