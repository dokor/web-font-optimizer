# web-font-optimizer

Socle d’audit statique des polices pour **Node.js 22 ou ultérieur** (ES modules).
À ce stade, le binaire découvre les sources et affiche leur nombre. Le registre
d’analyseurs est vide par défaut ; un scan ne constitue donc pas encore un audit
des usages. Le paquet n’a aucune dépendance d’exécution.

## Démarrer depuis le dépôt

```sh
npm ci
npm run typecheck
npm run build
npm test
npm exec --offline -- web-font-optimizer --help
npm exec --offline -- web-font-optimizer scan ./src
```

`scan [chemin]` accepte un répertoire (par défaut, le répertoire courant) ou
un fichier pris en charge. La découverte trie les chemins et reconnaît HTML,
CSS, SCSS, JS, JSX, TS et TSX, y compris les CSS Modules. Elle ignore les
répertoires `node_modules`, `.next`, `dist`, `build` et `.git` et ne suit pas
les liens symboliques rencontrés. L’aide et un scan réussi renvoient 0 ; une
invocation invalide ou un chemin inaccessible renvoient 2 et une erreur sur stderr.

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

Le moteur reçoit les observations et produit un `AuditReportV1` sérialisable
en JSON. L’inventaire conserve les observations et les ressources distinctes ;
`sizeBytes` est absent si la taille est inconnue. Un diagnostic lie un
`ruleId` stable à une gravité, une confiance, au moins un emplacement et un
conseil. Les sorties peuvent importer `exampleReport` depuis
`web-font-optimizer/examples/report-v1` sans lancer de scan.

| Lot | Point d’extension | Validation isolée |
| --- | --- | --- |
| Socle (#1) | `src/contracts.ts`, `discovery.ts`, `scan.ts` | Découverte, injection et rapport d’exemple |
| CSS / SCSS (#2) | `src/analyzers/css/` | Feuilles et CSS Modules synthétiques |
| HTML / Google Fonts (#3) | `src/analyzers/html/`, `src/sources/google-fonts.ts` | HTML et décodage pur des URL |
| React (#4) | `src/analyzers/react/` | JS, JSX, TS et TSX sans Next.js |
| Next (#5) | `src/analyzers/next/` | Texte contenant des appels à `next/font` |
| Moteur (#6) | `src/engine/` | Observations synthétiques → rapport v1 |
| Sorties et politique CI (#7) | `src/reporters/` | Rapport v1 → terminal, JSON et statut |
| Intégration (#8) | `src/cli.ts` et registre de production | Binaire empaqueté sur les deux projets de référence |

Les chemins des lots suivants sont des emplacements proposés. Chaque lot peut
ajouter ses tests et ses fixtures sans modifier le registre des autres.
