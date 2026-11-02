# Publication de @alelouet/web-font-optimizer

Le paquet public est préparé sous `@alelouet/web-font-optimizer`, version 0.1.0,
avec la licence MIT. Le binaire reste `web-font-optimizer`. La publication est
effectuée par [GitHub Actions](https://github.com/dokor/web-font-optimizer/actions/workflows/publish.yml).
La présence de ces fichiers ne signifie pas que le paquet est déjà publié.

## Vérifier le paquet

Depuis le dépôt, après `npm ci` :

```sh
npm run validate
npm run release:check -- --dry-run
npm publish --dry-run --access public
```

`validate` vérifie les types, les tests et une archive installée dans un projet
vierge. Le contrôle de l’archive inclut les exports JavaScript/types, le nom
avec scope, le binaire, la licence et la documentation. Aucune de ces commandes
ne publie de version.

Le workflow **Publish to npm** peut aussi être lancé depuis GitHub Actions,
sur `main`, en laissant `dry_run` coché. Il exécute la même matrice CI, construit
le paquet et effectue une simulation de publication.

## Première publication depuis GitHub

Un nouveau paquet doit être créé sur npm avant de disposer de ses propres
réglages de trusted publishing. Pour amorcer cette première publication depuis
GitHub, sans connexion npm sur le poste local :

1. Avec le compte npm `alelouet`, créer un **granular access token** temporaire
   depuis [Access Tokens](https://www.npmjs.com/settings/alelouet/tokens).
   Accorder la publication dans le scope `@alelouet`, en lecture/écriture, et
   activer **Bypass 2FA** pour cette publication non interactive. Une expiration
   courte suffit. Ne pas donner de permission d’administration d’organisation.
2. Enregistrer sa valeur uniquement dans le secret GitHub Actions
   `NPM_BOOTSTRAP_TOKEN`, dans les
   [secrets du dépôt](https://github.com/dokor/web-font-optimizer/settings/secrets/actions).
   Ne placer cette valeur ni dans un commit ni dans une conversation.
3. Préparer une GitHub Release au tag **v0.1.0**, sur le commit validé de `main`,
   avec les notes de `CHANGELOG.md`. La conserver en brouillon tant que le
   secret n’est pas prêt. Un brouillon ne publie rien sur npm.
4. Publier cette GitHub Release. `publish.yml` exécute les quatre jobs CI, vérifie
   que le tag correspond exactement à `package.json` et que le commit appartient
   à `main`, puis publie le paquet avec sa provenance. Il teste ensuite le binaire
   depuis le registre, dans un répertoire vierge.
5. Vérifier le résultat de l’action et la
   [page npm du paquet](https://www.npmjs.com/package/@alelouet/web-font-optimizer).

Le secret d’amorçage est facultatif pour les publications OIDC. Le workflow
utilise npm 11.21.1 et Node.js 24 ; les contrôles du paquet restent exécutés
avec Node.js 22 et 24 sur Linux et Windows.

## Relier npm au dépôt par OIDC

Dans les **Settings → Trusted publishing** du nouveau paquet npm, ajouter un
publisher **GitHub Actions** avec ces valeurs exactes :

| Champ npm | Valeur |
| --- | --- |
| Organization or user | `dokor` |
| Repository | `web-font-optimizer` |
| Workflow filename | `publish.yml` |
| Environment name | Laisser vide |
| Allowed actions | Autoriser `npm publish` |

Le compte npm est `alelouet` ; le propriétaire GitHub à renseigner reste
`dokor`. Le nom du workflow comprend l’extension, sans le chemin
`.github/workflows/`. La permission `id-token: write` est portée uniquement
par le job de publication.

Une nouvelle configuration npm doit réussir une publication OIDC dans les
deux jours pour être validée. La configurer au moment de la prochaine version
à publier ; si elle a expiré, la recréer. Après vérification de cette publication
OIDC, supprimer `NPM_BOOTSTRAP_TOKEN` et révoquer le token d’amorçage sur npm.

## Versions suivantes

1. Modifier ensemble `version` dans `package.json` et `package-lock.json`,
   ajouter les notes au `CHANGELOG.md` et mettre le README à jour dans une PR.
2. Fusionner après la CI, puis créer une GitHub Release depuis `main` avec
   le tag `vX.Y.Z` correspondant à cette version.
3. Publier la GitHub Release : OIDC autorise la publication npm ; aucune
   connexion npm locale ni secret npm permanent n’est nécessaire.

Le workflow gère les versions stables uniquement. Une simulation peut partir
de `main` ; une publication réelle exige un tag exact. Une simple fusion sur
`main`, une PR ou la création isolée d’un tag ne publie pas de paquet.
Relancer une publication déjà réussie ne remplace pas une version existante.

Références : [trusted publishing npm](https://docs.npmjs.com/trusted-publishers/),
[tokens granulaires](https://docs.npmjs.com/creating-and-viewing-access-tokens/)
et [publication et 2FA](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).
