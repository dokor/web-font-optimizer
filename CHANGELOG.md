# Historique des versions

## 0.1.0

Première version du MVP, préparée pour publication sous
`@alelouet/web-font-optimizer` (licence MIT).

- Audit statique en lecture seule des projets React/Vite et Next.js.
- Analyse CSS, SCSS, CSS Modules, HTML, Google Fonts, styles React et `next/font`.
- Inventaire des ressources, tailles locales connues et diagnostics localisés.
- Rapports terminal et JSON v1 ; option CI sur les doublons certains.
- API TypeScript/ESM, binaire `web-font-optimizer`, Node.js 22 ou ultérieur.
- Recette sur deux projets indépendants, paquet installé et CI Linux/Windows.
- Publication depuis GitHub Actions avec provenance et authentification OIDC,
  avec secret temporaire optionnel pour la toute première publication.

La présence de cette entrée ne signifie pas que la version est déjà sur npm.
Le workflow ne crée aucun correctif automatique et ne télécharge aucune police.
