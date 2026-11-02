# Documentation du MVP

La maintenance du README fait partie de chaque lot du MVP.

- Inclure dans chaque PR de lot la mise à jour de `README.md` qui décrit les
  capacités, l’API, les dépendances et les limites réellement ajoutées.
- Repartir de la version récente du README sur `main` et préserver les sections
  apportées par les autres lots lors de la résolution des conflits.
- Distinguer un module utilisable par l’API d’une fonctionnalité branchée dans
  la CLI. Ne documenter une option CLI comme disponible qu’après son intégration.
- Lors de chaque fusion de lot, vérifier et actualiser la section « État actuel »,
  le suivi des lots et les exemples concernés. Ne marquer un lot livré qu’une
  fois sa PR fusionnée.
- Vérifier les commandes et exemples modifiés ; mettre à jour les codes de
  sortie, les prérequis et les limites lorsque le comportement change.
- Si une fusion a laissé le README en retard, le corriger immédiatement dans
  un changement de documentation dédié, sans attendre le lot final.
- Le lot d’intégration #8 vérifie la cohérence finale du README ; il ne reporte
  pas à lui seul la documentation des lots précédents.
