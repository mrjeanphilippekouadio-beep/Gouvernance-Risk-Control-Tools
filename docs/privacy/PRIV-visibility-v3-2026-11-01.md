# PRIV-VIS-V3 — Revue Privacy du lot V3 (comptage « non visibles » et liste des ressources restreintes)

Date : 2026-11-01. Assesseur : A15 Privacy (A24). Branche `feat/r1-visibility-v3`.
Statut global : **UNDER_REVIEW, OK AVEC RÉSERVES** (un constat à corriger avant fusion : PRIV-V3-01). Aucun PRIVACY_BLOCK.

## Périmètre, cadre, limites

- Lu : `PostgresResourceAccessRepository` (`hiddenCounts`, `listRestricted`), `services/resourceVisibility.ts`, `HiddenCountNotice.tsx`, `RestrictedResourcesPage.tsx`, catalogue de notifications, migration 083 (`visibility_sees_everything`).
- **Limite** : la spec §6 sur `origin/chore/suivi-r1-f7s3` n'a pas pu être lue (aucun accès git dans cette session). Les décisions PO (q196, q198, q205, q209) ont été prises telles que transmises. À rapprocher de la spec par l'orchestrateur.
- Cadre : RGPD NOT_ESTABLISHED ; loi n° 2013-450 / ARTCI à confirmer par les juristes de Djamo ; aucun article cité. Données : titres/descriptions de ressources GRC, motifs libres, identifiants d'auteurs (collaborateurs / prestataires).

## Constats

**PRIV-V3-01 — Garde de `listRestricted` plus large que « voit tout » (CONFIRMED, à corriger).**
`resourceVisibility.listRestricted` autorise `resourcevisibility.set` **ou** `seesEverything`. Or `visibility_sees_everything` ne vaut que pour les groupes système RISK_MANAGER, RISK_COMMITTEE, AUDIT (migration 083). Un rôle personnalisé portant la permission sans être dans ces groupes recevrait libellés, motifs et auteurs de ressources NOMINATIF qu'il ne peut pas lire : contournement de q198 (ne pas révéler une enquête). Action (Dev Backend, A06) : exiger `seesEverything` (la permission seule ne suffit pas) ; test avec un rôle personnalisé. Revalidation Privacy après correctif.

**PRIV-V3-02 — Comptage `hiddenCounts` : minimisation respectée (CONFIRMED, OK).**
Un nombre par type, tout le client, sans ventilation ni lien ; NOMINATIF jamais compté (clause `visibility = 'PERIMETRE'`, avec héritage pour anomalies et plans) ; `null` pour les groupes qui voient tout ; type absent sans droit de lecture du type ; 0 et erreur non affichés. Réserve faible (OPEN) : le nombre varie quand une ressource passe de PERIMETRE à NOMINATIF ou inversement ; un lecteur attentif peut déduire un changement, pas son objet. Résiduel faible, à accepter par le Risk Manager. Le comptage 1 révèle l'existence d'une ressource restreinte : voulu par le PO (q196).

**PRIV-V3-03 — Libellés de la liste (PROBABLE, réserve).**
`left(description,160)` pour risques et anomalies, titre pour plans : contenu métier pouvant citer une personne. Les trois groupes lecteurs voient déjà ces contenus : pas de donnée nouvelle, mais la liste est une vue d'agrégation (découverte rapide de tout le restreint). Proportionné si PRIV-V3-01 est corrigé ; pas de masquage requis, pas de journal de lecture en V3 (à rouvrir si export ajouté).

**PRIV-V3-04 — Motif libre `lastChange.reason` (PROBABLE, question PO n°1).**
500 caractères libres, jusqu'ici lus dans `audit_log` sous `audit.read`. La liste le montre aussi au Comité (nouveau lecteur du motif). Le motif sert à justifier une restriction, donc il peut nommer la personne visée. Le masquer au Comité donnerait une fausse protection (il lit la ressource elle-même) ; le tronquer n'enlève pas le nom. Le vrai risque est l'écriture : une donnée nominative entre dans un journal append-only (principe 2). Recommandation : **conserver l'affichage aux trois groupes**, et agir à la source : consigne sous le champ motif (« ne nommez pas la personne concernée, décrivez la catégorie de raison »), longueur affichée en liste limitée à 140 caractères avec texte complet au détail, texte d'information R5.

**PRIV-V3-05 — `lastChange.userId` renvoyé par l'API (CONFIRMED, mineur).**
L'identifiant de l'auteur est dans la réponse alors que la page ne l'affiche pas (donnée exposée sans usage). Un Comité sans `audit.read` obtiendrait l'auteur de chaque changement. Action : retirer `userId` de la réponse, ou le réserver aux détenteurs de `audit.read` / RM. Principe 4.

**PRIV-V3-06 — Notifications (CONFIRMED, OK).**
Messages fixes (« Le responsable d'un plan d'action a élargi sa visibilité », etc.), sans titre, sans nom, sans motif. Elles portent `resourceId` (lien), destinataires = groupe `resourcevisibility.set` hors auteur. Même réserve que PRIV-V3-01 : si la permission est portée par un rôle hors groupes « voit tout », le lien pointerait vers une ressource illisible (à vérifier, non bloquant).

**PRIV-V3-07 — q205 « être nommé est visible de ceux qui lisent » (OK).**
Cohérent : `accessCount` seul est listé, pas les noms. Information des personnes nommées : à ajouter au texte R5 (la nomination est visible des lecteurs de la ressource).

**PRIV-V3-08 — Conservation (OPEN).**
Aucune durée pour les motifs d'`audit_log` (dépendance PO + juriste, comme D2a R3). Sauvegardes et PITR inclus dans toute promesse d'effacement.

## Questions au PO

1. Motif visible du Comité ? **Recommandé : oui**, avec consigne de saisie, aperçu 140 caractères et texte complet au détail (PRIV-V3-04). Alternative : réserver le motif au RM et à l'Audit.
2. Identité de l'auteur du changement visible du Comité ? **Recommandé : non** (RM et Audit seulement) (PRIV-V3-05).

## Revalidation (2026-11-01)

Lu : `ResourceVisibilityManager.listRestricted` (`backend/src/services/resourceVisibility.ts`), relecture du code uniquement (tests non exécutés par A15).
- **PRIV-V3-01 : LEVÉ (CONFIRMED).** La garde exige `seesEverything` seul (groupes fixes RM/Comité/Audit) ; la permission `resourcevisibility.set` ne suffit plus. Une preuve de test avec un rôle personnalisé porteur de la permission reste à joindre (EVIDENCE_REQUIRED, A08).
- **PRIV-V3-05 : LEVÉ (CONFIRMED).** `userId` et `byName` ne sont rendus qu'avec `resourcevisibility.set` ou `audit.read` ; pour le Comité, `lastChange` ne garde que date, motif et sens. Réserve mineure : un membre du Comité qui porterait aussi `audit.read` voit l'auteur, ce qui est cohérent avec son droit d'audit.
- **Restent ouverts** : q215 (motif visible du Comité : A recommandé) et q217 (durée de conservation des motifs, juriste/DPO dans D6) = PRIV-V3-04 et V3-08, non bloquants pour V3.
- Statut V3 après revalidation : **COMPLIANT_FOR_SCOPE** pour le comptage et la garde de la liste ; **PARTIALLY_COMPLIANT** tant que q215/q217 ne sont pas arbitrés.

## Verdict

**OK AVEC RÉSERVES, non bloquant pour V3 sous condition de corriger PRIV-V3-01 avant fusion.** Comptage conforme à q196/q198 ; liste proportionnée une fois la garde alignée. Revalidation Privacy requise après PRIV-V3-01 et PRIV-V3-05. Revue Security (A10) du point V3-01 recommandée ; la cotation du risque revient au Risk Manager.
