# Mémoire architect (A05)

Créée le 2026-10-12 (aucune mémoire n'existait). À lire en premier à chaque dispatch A05.

## Principes (valables au-delà d'un lot)

1. **Pas de colonne sans contrat écrit, pas de défaut inventé.** Un paramètre prend le défaut écrit au contrat
   (`RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §10). S'il n'y en a pas : NULL + règle fail-closed côté lecteur
   + question listée. Jamais un nombre « raisonnable » choisi par l'architecte.
2. **Ne pas accepter un réglage qu'aucun code ne sait appliquer** quand il peut verrouiller la gouvernance
   (q87 : approbateur Audit/Comité interdit avant B-12 ; `committee_vote_rule = CUSTOM` refusé avant B-12).
   Un réglage inerte mais inoffensif (ex. politique Hybride avant B-2) peut être accepté s'il est approuvé.
3. **Toute fonction de trigger redéfinie reprend la totalité de la garde précédente et
   `SET search_path = pg_catalog, public, pg_temp`** ; et un `.down.sql` qui restaure une fonction la restaure
   avec son `search_path` (F-B6a-11 / F-B6a-14). Toute nouvelle colonne d'une table immuable doit entrer dans
   la liste `same_content` de la garde, sinon elle est modifiable sur une ligne ACTIVE.
4. **Numéros de migration : jamais fixés dans une spec.** Écrire « numéro suivant le dernier présent » ;
   plusieurs worktrees en parallèle en consomment (055 prévue pour B-6a a été suivie de 056-058 de durcissement,
   ce qui a décalé « 056 = B-6b » de la première spec).
5. **Réponse libre du PO = interprétation à faire confirmer**, listée explicitement point par point (I-xx),
   avec la conséquence concrète de chaque lecture (ex. q82 « fin dès un membre » ⇒ blocage si le groupe n'a
   qu'un membre, à cause de q72). Ne pas coder une lecture non confirmée.
6. **Quand le PO tranche contre une recommandation Compliance**, ne pas rouvrir : le noter comme information
   avec le moment où le risque devient réel (ex. q89 règle d'arrivée vs « plus exigeante » d'A14 : latent
   jusqu'à B-12).
7. **Contrôles transitoires liés au code hérité** (ex. plafond minimal inter-échelles F-B6a-10) : écrire
   explicitement quand et sous quelle précondition ils disparaissent (inventaire des lecteurs hérités vide).
8. **Audit dans la même transaction que l'action** (q90) est désormais le contrat du Dispositif ;
   notifications après commit, indépendantes de l'audit. Ne pas l'étendre d'office à d'autres modules
   (lot transverse Compliance B-8).
9. **Un état « définitif » se mémorise, il ne se recalcule pas** sur l'état courant (sinon révoquer/suspendre
   un tiers le rouvre). Marqueur posé par un trigger sur les événements qui le font naître (pas un appel dans
   chaque service : un chemin futur l'oublierait), sous un verrou unique (ligne `tenants`), plus un garde
   « set-once » ; vérifier l'ordre des verrous contre les chemins existants (users → roles → tenants).
10. **« Valeurs par défaut du contrat » ne couvre que les paramètres qui ont une valeur au contrat** ; ceux
    « fixés à la création / par le client » n'en ont pas : le dire et le lister (I-D8), ne pas en inventer.
11. **Un garde-fou transitoire réutilise un régime existant + une cause tracée** (q100 : repli FALLBACK +
    `fallback_cause`), jamais un nouveau régime ; écrire quand il disparaît (B-12).

## Positions prises

- 2026-10-11 : spec B-6 (`docs/architecture/RM-V1-B6-Dispositif-spec.md`), 4 sous-lots.
- 2026-10-12 : spec B-6 mise à jour avec DECISION-044 (q81-q83, q86-q93). Ordre de merge
  B-6b → B-6d → B-6c ; B-6d en production avant ou avec B-6b (un seul RM, q93). Paramètres q91 dans la
  migration de B-6b, sans copie sur l'évaluation (FK vers version immuable suffit). Lignes d'évaluation
  antérieures : affichées avec le Dispositif par défaut mais `frameworkVersionId: null`, jamais rattachées.
  Amorçage : route dédiée `bootstrap-approve`, base limitée au premier Dispositif du tenant, pas de
  ratification (q83, à confirmer A13). Questions résiduelles : spec §14.2 (I-D1..I-D6, R1..R5, I-C1..I-C3).
- 2026-10-12 (bis) : spec B-6 mise à jour avec DECISION-045 (q98, q99) et DECISION-046 (q100–q103) + revue A13.
  B-6d dispatchable après fusion de B-6b. Choix : fin d'amorçage = `tenants.risk_framework_bootstrap_ended_at`
  posée par trigger AFTER sur `user_roles`/`users` (réactivation) sous `FOR UPDATE` du tenant, garde BEFORE
  UPDATE set-once ; ouverture = marqueur NULL + aucun circuit fonctionnel (≥2 RM ou ≥2 Comité ou ≥2 Audit) +
  demandeur unique RM ; `bootstrapRefusal(ctx)` renvoie une raison. Motif structuré (`bootstrap_justification`
  jsonb : askedUserId admin, askedOn, outcome). q98 contrôlé au service seulement (`contractDefaultViolations`).
  q100 : `foldVoteBeforeB12` dans `resolveFor`, colonne `fallback_cause`, requête n° 10 du pré-déploiement.
  q103 : personne d'autre prévenu (PO contre A13). Ouverts non bloquants : I-D7 (seuil q103, A13), I-D8
  (paramètres sans défaut contractuel), I-D9 (RM admin qui se désigne comme sollicité), I-D10 (info).

- 2026-10-18 : consultation DECISION-054/055 (lecture seule). « Tout vit dans l'Administration » = la page
  d'édition du Dispositif (mêmes routes `/risk-frameworks`) est montée sous Administration, les autres
  sections n'ouvrent que ce brouillon ; l'approbation reste dans « À faire » (change-requests). Deux niveaux :
  réglage tenant (plateforme, effet immédiat, motif + audit) vs paramètre de version (approuvé, cycle suivant).
  Seconds chemins encore ouverts : `PUT /processes/:id/evaluation-mode` (permission retirée par §10),
  `PATCH /modules/:name/toggle` sans motif ni tiers (désactive AUDIT), 4 champs inertes `PUT /config`.

## Pièges rencontrés

- Le worktree fourni peut être sur un ancien commit sans Bash pour le corriger : lire les sources dans le
  checkout principal, écrire dans le worktree, et le signaler dans le rapport.
