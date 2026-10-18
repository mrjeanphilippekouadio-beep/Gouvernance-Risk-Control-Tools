# Consultation — produit configurable (DECISION-055) et réglages dans l'Administration (DECISION-054)

**Date** : 2026-10-18. **Demandée par** : le PO (q113 : « tout doit être modulable, défaut = gouvernance stricte ; produit commercial »).
**Consultés** : A13 Risk Manager, A05 Architecte, A06 Dev Backend, A10 Sécurité. Ce sont des recommandations, pas des décisions : tout point « à trancher » est une question au PO.

## A13 — Risk Manager

### I-D9 sous le principe configurable
- **Refus du faux tiers maintenu, non configurable** : un administrateur qui se désigne « administrateur sollicité » demande, atteste et décide seul, alors que le dossier montre une deuxième personne qui n'existe pas (invariant 5, « rien n'est auto-approuvé »).
- **À la place, un réglage honnête** : un régime « structure à une personne », désactivé par défaut. Déclaré à la création de l'espace client par le titulaire du compte (nom, date, motif tracés). Levé par le circuit normal dès qu'une deuxième personne existe, jamais rouvert (même logique que q102). Marquage : bandeau « régime à une personne » sur chaque décision, rapport et Cartographie, ligne d'audit, indicateur d'ancienneté.

### Réglage ou invariant (défaut strict)

| Règle | Statut | Défaut strict | Justification |
|---|---|---|---|
| Ne jamais valider ce qu'on a saisi ou exécuté (inv. 1) | Invariant | Appliqué | Sans cela, plus de contrôle (ISO 31000 6.4, IIA 3 lignes) ; le cas « une personne » passe par le régime marqué |
| Aucune auto-approbation, tout tracé (inv. 5) | Invariant | Appliqué | Minimum d'un produit de gouvernance |
| Audit append-only, attribution forcée côté serveur (inv. 7) | Invariant | Appliqué | La preuve ne se réécrit pas |
| Historique et cycles passés non modifiables (inv. 9) | Invariant | Appliqué | Comparabilité, défendabilité d'un audit |
| Un paramètre ne masque pas un dépassement d'appétence (inv. 8) | Invariant | Appliqué | COSO : on ne règle pas le seuil pour supprimer le dépassement |
| Pas de validation tacite (inv. 10, partie 1) | Invariant | Appliqué | Un silence n'est pas un accord |
| Cumul de rôles visible (inv. 6) | Invariant | Appliqué | Permis, jamais caché |
| Mode effectif jamais Hybride (inv. 4) | Règle technique | Appliqué | Cohérence du modèle |
| Qui saisit le Résiduel (inv. 3) | Réglage encadré | Équipe risque | La revue indépendante reste exigée |
| Quorum, règles du Comité A/B/C | Réglage | ≥ 2 éligibles ; repli marqué | Taille de l'organisation |
| Approbateur d'un changement | Réglage | Fonction risque, Audit notifié | Organisation |
| Cumul Risk Owner + Exécuteur ; seuil « faible » | Réglage | Jusqu'au seuil « faible » | Déjà au contrat |
| Délégué, durée de délégation | Réglage | Recommandé ; durée fixée par le client | Équipe réduite |
| Échelle, axes, appétence, seuil Comité | Réglage | Défauts du contrat | Visible, sans plafond (I-D8) |
| Auto-proposition de désignation | Réglage | Désactivée ; seul le Comité l'active | Déjà au contrat |

### Petite structure, une seule personne risque
- Sans le régime : pas d'amorçage par simple déclaration ; il faut un second utilisateur ou un autre administrateur → risque réel de compte fictif, pire qu'une exception déclarée.
- Avec le régime : fonctionne sans contournement, décisions marquées « sans second regard ». Option : relecteur externe invité en lecture seule.
- Compromis assumé : le régime abaisse l'invariant 1 pour ce client ; c'est la transparence qui compense.

### À trancher par le PO (A13)
1. Faut-il ce régime « une personne », et sous quelles conditions de levée ?
2. Qui peut le déclarer : le titulaire du compte, ou l'éditeur à l'onboarding ?
3. Le tableau ci-dessus est-il la liste retenue des invariants ?
Si oui : modifier le contrat (invariants 1 et 5), la spec B-6 §5.6 pt 6 et I-D9.
