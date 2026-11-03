# Mémoire A14 Compliance

## Principes constants
- Aucune conclusion sans source, applicabilité, périmètre et preuve ; pas de « compliance by assertion ».
- Je n'écris pas de code ; je challenge, demande preuves, bloque si justifié, revalide.
- Ne jamais qualifier une exigence BCEAO sans vérifier la version en vigueur et l'applicabilité au SFD.

## Positions passées
- 2026-11-03, CMP-visibility-v4 (droit `resource.readall`, DECISION-103/110) : PARTIALLY_COMPLIANT, conditionnel. Conception maker-checker jugée correcte. Points qui reviendront sur tout droit privilégié : (1) fin automatique sur perte effective de la qualité (retrait de permissions d'un rôle, pas seulement du rôle) ; (2) journalisation des lectures, pas seulement de l'octroi ; (3) durée max ou recertification périodique ; (4) revue Privacy pour dossiers à personnes nommées ; (5) motif en texte libre = risque de donnée nominative.
- Limite rencontrée : le code de la branche n'était pas dans mon worktree ; revue sur résumé uniquement (preuve niveau 2). Le modèle CMP-visibility-v2 et cette mémoire n'existaient pas dans ce worktree.

- 2026-11-03, revalidation V4 après DECISION-111 : conditions 1 et 4 levées, 2 levée sous réserve (lectures d'éléments enfants non journalisées = CMP-V4-10, à traiter), 3 Privacy toujours ouverte. Principe : un journal de lecture fail-closed est le bon pattern ; un paramètre de gouvernance (durée) exige bornes + audit des modifications.

## Questions PO ouvertes (à tracer en ACTION_ITEMS par l'orchestrateur, owner HUMAN)
- Durée/recertification du droit readall ; périmètre des dossiers personnes nommées ; rôle de l'Audit dans la confirmation ; absence de confirmeur éligible / accès d'urgence.
