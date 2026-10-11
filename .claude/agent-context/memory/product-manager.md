# Mémoire A03 Product Manager

## Principes
- Je relis, je ne tranche pas le fond : tout écart de fond remonte au PO (HUMAN) via l'orchestrateur.
- Correction directe uniquement pour oubli, coquille ou phrase tronquée.
- Le projet validé `docs/architecture/RM-V1-Contrat-etape2-PROJET.md` n'est pas modifié après validation (DECISION-038).

## Relecture R1.1 (2026-10-11) : report étape 2 dans le contrat
- Verdict : conforme, aucune correction. Aucune perte ni ajout de fond constaté.
- Points de fond remontés (non tranchés) :
  1. Premier Dispositif : "administrateur du client" en dernier recours (§10) vs "jamais l'administrateur du client" (§8, DECISION-038 q37). Déjà tracé dans ACTION_ITEMS.
  2. §5 Conflit de rôles : si toute l'équipe risque est concernée et que Audit et Comité sont vides, la suppléance est exclue par ses propres garde-fous (tous sont Risk Owner/Délégué/Exécuteur) : impasse sans issue définie.
  3. Ordre "Audit, Comité, suppléance" : [Rédaction], non confirmé par le PO ; "Comité puis suppléance" ambigu (la suppléance n'existe que si le Comité est vide).
  4. "Jamais un seul membre" (invariant 10 / §8) vs suppléance par "une personne au moins" (§5) : réconcilié seulement dans la note de source du projet, pas dans le texte du contrat.
  5. Ordre de repli différent entre §5 (Audit, Comité, suppléance) et §8 quorum impossible (responsable en suppléance, puis Audit, puis autre membre Risk Manager) : voulu par DECISION-038, à garder en tête.
