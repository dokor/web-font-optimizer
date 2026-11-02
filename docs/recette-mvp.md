# Recette du MVP d’audit des polices — #9

Vérification du 2 novembre 2026 après fusion de l’intégration
[#18](https://github.com/dokor/web-font-optimizer/pull/18), qui clôt le lot
[#8](https://github.com/dokor/web-font-optimizer/issues/8). Les lots #1 à #8
sont livrés ; cette recette de pilotage vérifie leur résultat commun.

Le commit de `main` vérifié est `edd02d5346bda5121a557a569170d6575d0f7831`.
Son arbre Git `f63e51d8e41764ed88f3b7985757cbeb25708509` est identique à celui
testé localement et par la [CI de la PR #18](https://github.com/dokor/web-font-optimizer/actions/runs/41461409600).
La présente PR ajoute uniquement la documentation de livraison, sans changer
le code, les dépendances ou les options CLI.

## Critères et preuves

| Critère de livraison | Preuve reproductible | Résultat |
| --- | --- | --- |
| CLI complète et lecture seule | `src/audit.ts` et `src/cli.ts` partagent les quatre analyseurs, le moteur et les reporters ; les fixtures lèveraient une erreur si leur code était exécuté. | Conforme |
| React/Vite sans installation de Next | Fixture `test/fixtures/integration/react-vite`, aucun `node_modules` dans le projet audité ; installation du paquet avec les seules dépendances de production, sans React, Vite ou Next. | Conforme |
| Adaptateur Next et chevauchement CDN | Fixture `test/fixtures/integration/next` : usages de `.className`, exposition et consommation d’une variable ; diagnostic Inter entre `app/layout.tsx` et `index.html`. | Conforme, confiance consultative conservée |
| Polices et variantes CSS communes | `shared.css` identique dans les deux fixtures : alias simple, graisse variable 100–900, deux plages Unicode complémentaires et import Google Fonts échappé. | Aucun diagnostic sur ce fichier seul, code 0 avec option CI |
| Doublons certains | Les lignes 1 et 2 de `duplicates.css` répètent le même import dans chaque fixture. | Deux emplacements, confiance `certain`, code 1 uniquement avec option CI |
| JSON exploitable en CI | Même rapport avec ou sans option CI, parse JSON direct, stdout sans préambule ni couleur ; erreurs d’accès sur stderr. | Codes 0/1/2 vérifiés dans les deux formats |
| Sources retrouvables et conseil | Le terminal expose fichiers, lignes, colonnes, variantes, confiance et action ; chaque diagnostic JSON porte des emplacements et un conseil. | Conforme |
| Ressources locales | Racine retournée par `scan`, mesure depuis le fichier de preuve, feuille React partagée inventoriée une seule fois ; association déclaration/ressource sans second chargement fictif. | Conforme, y compris pour un scan de fichier seul |
| Aucun téléchargement ou changement du projet | Garde bloquant fetch, HTTP, HTTPS et sockets pendant les scans ; comparaison des chemins, contenus et dates avant/après. | Conforme |
| Binaire réellement distribué | `npm pack`, installation de l’archive dans un consommateur vierge avec `--omit=dev --ignore-scripts`, contrôle des exports JS et types puis même recette CLI. | Conforme sans publication npm |
| Vérification continue | Node.js 22 et 24, Linux et Windows : installation verrouillée, typecheck, 114 tests et recette du paquet installé. | Quatre jobs verts sur la PR #18 |

Les assertions partagées sont dans
[`scripts/test-support/production-cases.js`](../scripts/test-support/production-cases.js).
Elles sont appelées par [`test/integration.test.js`](../test/integration.test.js)
et [`scripts/check-package.mjs`](../scripts/check-package.mjs), ce qui vérifie
les mêmes attentes sur le binaire construit et sur le binaire installé.
Les règles, cas ambigus et permutations d’observations restent couverts par
[`test/engine.test.js`](../test/engine.test.js) et les tests des analyseurs.

## Résultats des projets de référence

| Projet | Observations | Ressources distinctes | Diagnostics sur le projet complet |
| --- | ---: | ---: | --- |
| React/Vite | 21 | 8 | 1 `duplicate-load` certain |
| Next.js | 27 | 8 | 1 `duplicate-load` certain et 1 `possible-overlap` consultatif |

Dans les deux cas, `--fail-on-duplicates` retourne 1 tout en conservant le
rapport complet ; sans cette option, le même audit retourne 0. Un chemin
inexistant retourne 2 sur stderr et laisse stdout vide. La taille des fichiers
de police synthétiques vérifie uniquement l’inventaire de métadonnées.

## Rejouer la recette

Depuis la racine du dépôt, avec Node.js 22 ou ultérieur :

```sh
npm ci
npm run typecheck
npm test
npm run test:package
npm exec --offline -- web-font-optimizer scan ./test/fixtures/integration/react-vite --report json
npm exec --offline -- web-font-optimizer scan ./test/fixtures/integration/next --report json
npm exec --offline -- web-font-optimizer scan ./test/fixtures/integration/react-vite/shared.css --fail-on-duplicates
```

Ces commandes retournent 0. Ajouter `--fail-on-duplicates` au scan d’un projet
complet retourne volontairement 1. L’installation des dépendances nécessite le
réseau ; les scans restent hors ligne. Les fixtures ne nécessitent pas
d’installation ni de lancement de leurs frameworks.

## Limites conservées

- Une observation statique ne prouve ni rendu navigateur ni téléchargement
  effectif. Les recommandations restent à vérifier avant toute suppression.
- Les expressions dynamiques, imports d’instances Next entre fichiers, bindings
  concurrents, cascade complète et coexistence des pages ne sont pas évalués.
- L’exposition d’une variable Next n’est pas un usage ; son rapprochement avec
  un consommateur suppose une définition exposée unique, sans priorité DOM déduite.
- Les sources distantes ne sont pas téléchargées et leur taille reste inconnue.
  Une taille locale ne mesure pas une économie réseau.
- Les correctifs automatiques, le rapport Markdown, les plugins de formatage
  et le score global restent hors du MVP. La recette ne publie aucun paquet.
