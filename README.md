# web-font-optimizer

CLI d’audit statique des polices web, développée en TypeScript pour
**Node.js 22 ou ultérieur** (ES modules).

Le projet vise les applications **React, notamment avec Vite, et Next.js** :
recenser les déclarations, les chargements et les usages de polices, puis aider
à repérer les doublons et les incohérences. L’audit est en lecture seule : il
ne modifie pas les sources, n’exécute pas le projet analysé et ne télécharge
pas les polices ni les feuilles de style distantes.

## État actuel

Les analyseurs CSS/SCSS et CSS Modules, HTML/Google Fonts, React et `next/font`
sont utilisables via l’API injectable. Le moteur `buildAuditReport` transforme
leurs observations en rapport v1 ; les reporters terminal et JSON ainsi que la
politique sur les doublons certains sont disponibles.

**La CLI exécute le parcours complet** : découverte, quatre analyseurs de
production, décodage Google Fonts depuis HTML et CSS, moteur puis rapport
terminal ou JSON. `--fail-on-duplicates` échoue uniquement sur les répétitions
strictes de confiance certaine. Le même parcours est disponible avec `audit()`.

Les lots #1 à #8 sont livrés sur `main`. Les PR #11 à #16 ont été fusionnées
ensemble via la [PR #17](https://github.com/dokor/web-font-optimizer/pull/17),
et le parcours complet via la [PR #18](https://github.com/dokor/web-font-optimizer/pull/18).
La CI a validé les 114 tests et le paquet installé sur ses quatre environnements.
La [recette finale du MVP](docs/recette-mvp.md) relie les critères de livraison
aux tests et aux résultats sur React/Vite et Next.js. Les sections ci-dessous
décrivent les capacités et limites de chaque module.

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
npm run test:package
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
rapport synthétique ; les tests de production lancent aussi le vrai binaire
sur les fixtures React/Vite et Next, avec les statuts 0, 1 et 2.

## Parcours de production (#8)

```ts
import { audit, productionAnalyzers, scan } from 'web-font-optimizer';

const report = await audit('./mon-projet');
const result = await scan('./mon-projet', productionAnalyzers);
console.log(report.version, result.root);
```

`audit(chemin)` retourne le rapport v1 et utilise la même liste d’analyseurs que
la CLI. `productionAnalyzers` est une liste en lecture seule. `scan()` reste
l’API de bas niveau avec un registre vide par défaut ; lui fournir explicitement
les analyseurs souhaités. Son résultat contient maintenant `root`, la racine
absolue à transmettre au moteur, y compris pour le scan d’un fichier seul.

Deux projets statiques sont inclus dans `test/fixtures/integration/react-vite`
et `test/fixtures/integration/next`. Leurs dépendances ne sont pas installées.
Les fichiers de police sont des octets synthétiques destinés à la vérification
des métadonnées, pas des polices à rendre dans un navigateur.

```sh
npm exec --offline -- web-font-optimizer scan ./test/fixtures/integration/react-vite --report json --fail-on-duplicates
```

Cette commande écrit un rapport JSON complet et retourne **1** : les lignes 1
et 2 de `duplicates.css` répètent le même import. En retirant l’option CI, le
même rapport retourne 0. Le scan de `shared.css` seul avec cette option retourne
0 : les deux faces Atlas ont des plages Unicode complémentaires, une plage
variable de graisses et un usage via une variable CSS simple. La fixture Next
ajoute le chevauchement Inter entre CDN et `next/font`, avec les deux emplacements.

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
Les imports ne sont ni téléchargés ni exécutés. Les URL Google Fonts des
`@import` sont décodées après interprétation des échappements CSS : familles,
variantes et valeurs partiellement comprises produisent les mêmes observations
que le HTML. L’URL brute, la position de la directive et ses conditions restent
conservées. L’analyseur est enregistré dans la CLI et dans `audit()`.

## Analyser React et Vite (#4)

```js
import { reactAnalyzer, scan } from 'web-font-optimizer';

const { files, observations } = await scan('./mon-app-vite', [reactAnalyzer]);
```

`reactAnalyzer` accepte JS, JSX (également dans `.js`), TS et TSX. Il analyse le
texte en mémoire, sans lire de configuration, résoudre les imports, installer
React/Vite/Next, exécuter l’application ou accéder au réseau. La fixture
`test/fixtures/react-vite` s’analyse sans installer ses dépendances.
L’analyseur fait partie du registre de production de la CLI et de `audit()`.

Les imports ES locaux `.css` et `.scss`, dont les CSS Modules, produisent des
ressources `react:stylesheet-import`. `source.value` est normalisé relativement
au fichier qui importe la feuille, sans suffixe de requête ou fragment. Les
références `cssModule.stylesheet` restent relatives à la racine du scan. L’analyseur ne parcourt
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

## Adaptateur Next.js (opt-in)

```ts
import { scan } from 'web-font-optimizer';
import { nextAnalyzer } from 'web-font-optimizer/analyzers/next';

const result = await scan('./src', [nextAnalyzer]);
```

L’adaptateur analyse JS, JSX, TS et TSX qui importent `next/font/google` ou
`next/font/local`. Il suit les alias d’import, les imports namespace, les alias
`const` des chargeurs et des instances, ainsi que les propriétés déstructurées.
Les portées lexicales empêchent de confondre une instance avec un paramètre de
même nom. Il n’exécute aucun code et ne lit ni modules importés ni fichiers de
polices. Next.js n’a pas besoin d’être installé dans le projet analysé.

Les options explicites `weight`, `style`, `subsets`, `display`, `src` et `variable`
sont conservées. Les expressions dynamiques, propriétés abrégées et spreads
non résolus produisent des observations `indeterminate` positionnées. Un spread
invalide les options précédentes qu’il pourrait remplacer ; les options
explicites suivantes restent connues. Les assertions de type et `satisfies`
n’empêchent pas de lire un objet littéral. Les constantes d’options externes
et les imports d’instances depuis un autre fichier ne sont pas résolus.

Une famille Google conserve son nom public (`Roboto_Mono` → `Roboto Mono`),
comparable au nom décodé dans une URL Google Fonts. Aucune URL CDN n’est inventée :
Next héberge lui-même les fichiers générés. Une famille locale inconnue reçoit
l’identité `local:<fichier>:<ligne>:<colonne>` du chargeur. Chaque fichier local
conserve son chemin relatif et sa variante dans une déclaration et une ressource
distinctes ; toutes les sources d’un chargeur partagent cette identité et son
`context`.

Les applications JSX de `.className` et `.style` émettent des usages liés à
l’instance. L’option `variable` définit une correspondance nom CSS → famille ;
son application JSX via `.variable` produit une référence d’origine
`next/font/variable`, sans usage de famille. Une consommation dans une propriété
JSX `style={{ fontFamily: 'var(--font-...)' }}` produit une référence d’origine
`font-family`. Les références des feuilles CSS/SCSS externes appartiennent à
l’analyseur CSS ; elles peuvent être rapprochées de la définition par le nom de
variable. Le moteur ignore l’exposition `.variable` lorsqu’il recense les usages.
Une définition Next exposée et unique peut résoudre une consommation de même
nom dans une feuille CSS externe ou un style React. Plusieurs instances exposées
avec ce nom ou une définition CSS concurrente restent ambiguës. Le contexte de l’instance est conservé pour le
rapprochement ; cela ne prouve ni héritage DOM ni rendu navigateur. L’adaptateur
fait partie du registre de production.

Les fixtures `test/fixtures/next/` et les tests `test/next.test.js` couvrent les
alias Google, les sources locales multiples, l’exposition et la consommation
des variables, les options dynamiques, l’absence d’import Next et un scan sans
écriture ni exécution du projet.

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
| [CSS / SCSS (#2)](https://github.com/dokor/web-font-optimizer/issues/2), livré ([PR #11](https://github.com/dokor/web-font-optimizer/pull/11)) | `src/analyzers/css/` | Feuilles et CSS Modules synthétiques |
| [HTML / Google Fonts (#3)](https://github.com/dokor/web-font-optimizer/issues/3), livré ([PR #12](https://github.com/dokor/web-font-optimizer/pull/12)) | `src/analyzers/html/`, `src/sources/google-fonts.ts` | HTML et décodage pur des URL |
| [React (#4)](https://github.com/dokor/web-font-optimizer/issues/4), livré ([PR #13](https://github.com/dokor/web-font-optimizer/pull/13)) | `src/analyzers/react/` | JS, JSX, TS et TSX sans Next.js |
| [Next (#5)](https://github.com/dokor/web-font-optimizer/issues/5), livré ([PR #14](https://github.com/dokor/web-font-optimizer/pull/14)) | `src/analyzers/next/` | Texte contenant des appels à `next/font` |
| [Moteur (#6)](https://github.com/dokor/web-font-optimizer/issues/6), livré ([PR #16](https://github.com/dokor/web-font-optimizer/pull/16)) | `src/engine/` | Observations synthétiques → rapport v1 |
| [Sorties et politique CI (#7)](https://github.com/dokor/web-font-optimizer/issues/7), livré ([PR #15](https://github.com/dokor/web-font-optimizer/pull/15)) | `src/reporters/` | Rapport v1 → terminal, JSON et statut |
| [Intégration (#8)](https://github.com/dokor/web-font-optimizer/issues/8), livré ([PR #18](https://github.com/dokor/web-font-optimizer/pull/18)) | `src/audit.ts`, `src/cli.ts` et registre de production | Binaire empaqueté sur les deux projets de référence |

Les modules restent testables isolément. `src/audit.ts` fournit leur registre
commun et le pipeline utilisé par la CLI ; les mêmes cas de recette sont lancés
sur le binaire construit puis sur le paquet installé.

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

### Conventions de rapprochement

Le champ optionnel `scope: 'global'` distingue une déclaration CSS globale ou
un alias `:root` inconditionnel de son `context` de preuve. Une face globale
peut ainsi servir les usages des sélecteurs. Les contextes conditionnels restent
conservateurs : le moteur n’évalue ni la cascade ni les media queries. Les
faces et imports CSS globaux sont comparés dans leur fichier et contexte.

Une ressource associée à une déclaration porte `declarationLocation` ; elle
reste dans l’inventaire et peut être mesurée, mais ne devient pas un second
chargement. Les imports React restent des références statiques et ne sont pas
comptés comme des chargements répétés. Les sources locales sont relatives au
fichier de preuve ; les emplacements et références CSS Modules sont relatifs
à la racine du scan. Les liaisons absentes ou ambiguës restent consultatives.

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

Le HTML et les imports CSS utilisent le même décodeur dans le parcours de
production. Le parseur CSS interprète ses propres échappements et conserve
la preuve originale ; aucun import distant n’est parcouru.

Références de syntaxe : [API CSS](https://developers.google.com/fonts/docs/getting_started)
et [API CSS2](https://developers.google.com/fonts/docs/css2). Les cas d’acceptation
sont dans `test/html.test.js`, `test/google-fonts.test.js` et
`test/fixtures/html/vite/index.html`.

## Rapprocher les observations (#6)

`buildAuditReport` est exporté depuis `web-font-optimizer`. Il accepte les
observations du contrat partagé, y compris des entrées synthétiques, sans
registre d’analyseurs ni exécution du projet. Cet exemple réutilise l’analyseur
`example` défini plus haut :

```ts
import { buildAuditReport, scan } from 'web-font-optimizer';

const scanResult = await scan('./mon-projet', [example]);
const report = await buildAuditReport(scanResult.observations, { root: scanResult.root });
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

Les portées sont des identités opaques : une déclaration sans contexte ou avec
`scope: 'global'` peut
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

## CI du dépôt

Le workflow `.github/workflows/ci.yml` s’exécute sur les PR, les push vers `main`
et à la demande. Il utilise npm et `package-lock.json`, avec Node.js 22 et 24
sous Linux et Windows : installation propre (`npm ci`), contrôle TypeScript,
compilation et tous les tests (`npm test`), puis `npm run test:package`.

Ce dernier contrôle construit une archive avec `npm pack`, l’installe dans un
projet temporaire avec les seules dépendances de production, vérifie tous les
exports JavaScript et leurs déclarations de types, appelle les analyseurs, le
moteur et les reporters, puis lance le binaire installé. React, Vite et Next.js
ne sont pas installés. L’installation des dépendances nécessite le réseau ;
les scans ne téléchargent aucune ressource. Le test est indépendant de la
publication npm et ne publie aucun paquet.

Les dépendances d’exécution sont PostCSS, `postcss-scss`,
`postcss-value-parser`, `parse5` et TypeScript (parseur des sources React/Next).
Les types Node sont une dépendance de développement. Les actions GitHub sont
figées sur un commit et le workflow dispose uniquement de la lecture du dépôt.
La recette des deux projets est exécutée avec `npm test`, puis répétée par
`npm run test:package` contre le binaire réellement installé : terminal, JSON,
codes 0/1/2, plages Unicode, variables et chevauchement CDN/Next. Les accès HTTP,
HTTPS, fetch et sockets sont bloqués pendant ces scans ; les chemins, contenus
et dates de modification des fixtures sont comparés avant et après.
