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
- 2026-10-18 : DECISION-068, `docs/governance/droits-acces/architecture.json` (pourquoi/objectif/granularité/
  configurabilité de chaque permission, groupe, garde, relation ; 15 domaines). Positions : 3 couches
  (permission = quoi / rôle-groupe = qui / relation = sur quoi) ; « ne jamais bloquer » = UN catalogue de règles
  de gouvernance + un point de contrôle unique (conforme | dérogation), 2e appel avec confirmation + motif,
  marqué « sans second regard », audit même transaction, compte désigné informé ou décidant, politique par
  client (mode, compte, condition de levée), amorçage/repli/structure à une personne/admin-RM en sont des cas.
  Invariants hors catalogue. Proposé (à arbitrer PO) : en dérogation I5, statut « appliqué sans validation
  indépendante », jamais « validé ». Auto-attribution de rôles : aucune dérogation. À retirer : ratingscale.
  create/update/delete, riskappetite.update/delete, process.evaluationmode.set. À scinder : anomaly.close,
  toggle de module hors config.manage. assertRiskManager à remplacer par riskframework.* (DECISION-060).
  Propriétaire / N-1 de processus : partir du RACI (A / R).

- 2026-10-18 : DECISION-073, `docs/architecture/RM-V1-Panel-Principes-Gouvernance.md`. `GovernanceHealthService`
  + `GET /api/v1/governance-health` (permission `governancehealth.read`, préfixe distinct de `governance.*` = cycles
  de revue ; HORS `ADMIN_PERMISSIONS`, sinon tout lecteur devient « admin » q63). Catalogue A13 recopié en code
  (`domain/governance/catalog.ts`, test de synchro avec le JSON de `docs/`, le serveur ne lit jamais `docs/`) +
  un détecteur TS pur par principe ; taille TPE/PME/GE = fonction pure, `null` tant que la règle A13 n'est pas
  validée (pas de surbrillance devinée). Marqueur « sans seconde validation » = colonne nullable
  `audit_log.governance_exception` posée à l'INSERT par le service (pas de trigger, pas de jsonb), seul point
  d'insertion `insertAuditEvent`. `config.self_validation_policy` REFUSE | DOUBLE_CONFIRMATION, permission dédiée
  `config.selfvalidation.set` (dans ADMIN_PERMISSIONS), auto-attribution de rôles exclue. Double confirmation sans
  état : 409 puis 2e appel avec `governanceConfirmation { rule, reason }`. Lots P0-P6 ; questions Q1 (double
  validation seulement faute d'autre validateur — recommandé), Q2 (pas de rétroactivité), Q3 (notifier le 1er
  Audit/Comité).

- 2026-10-18 : DECISION-074 (q135-q144), section « Révision DECISION-074 » du même fichier panel. Taille = questionnaire
  versionné `organization_profiles` (ajout seul, ACTIVE/PENDING, hybride : seul si aucun tiers RM/Audit/Comité, sinon
  approbation par un autre), classement recalculé à la lecture + `profileGaps`. Propriétaire/champion/N-1 = colonnes FK
  sur `processes` (position « RACI A/R » révisée : valeur unique, FK, champion hors RACI), permission
  `process.responsibility.assign`. Gérant + intérimaire RM = `governance_designations` (fin par `ended_at`).
  Dernier RM avec intérimaire : `handOverLastRiskManager`, **retrait puis attribution** (sinon le trigger 062 compte
  2 RM et termine l'amorçage à tort). « Appliqué sans validation indépendante » = marqueur `audit_log` + revues, aucun
  statut ajouté aux tables métier, `validationIndependence` calculé serveur. q141 : `EligibleValidatorQuery` (union
  RBAC + `users.roles`, portée). Acceptation : `governance_principle_acceptances`, snapshot des objets, expiration
  lue (pas de tâche). `last_seen_at` throttlé 1/h, sans audit. Lots D0-D7, migrations indicatives 066-073.
  Questions R-Q1 (dernier RM sans intérimaire), R-Q2 (deux comptes d'un humain), R-Q3 (données de fonctions non
  construites). Interprétations I-R1..I-R6.

- 2026-10-28 : DECISION-100, `docs/architecture/RM-V1-Visibilite-Ressources-spec.md`. Reco option A : `visibility`
  CLIENT (défaut, données existantes) | PERIMETRE sur les racines (risks, controls, anomalies, action_plans) ; enfants
  hérités (évaluations, décisions, escalades, KRI par risk_id principal) ; contrôle = réglage propre (N-N). Périmètre =
  groupe de département (pas `users.department_id`) + propriétaire/N+1/RACI/responsable processus + groupes fixes RM/Comité/
  Audit voient tout ; admin non ; aucun rôle ordinaire « voit tout ». Hors périmètre = 404. Agrégats filtrés en SQL, sans
  « N masqués ». `resourcevisibility.set` (RM), motif, audit même transaction. Intersection avec `dashboard_scope_mode`.
  Lots V0 (résolveur, zéro changement) → V4 (NOMINATIF si Q-1). Questions Q-1..Q-7.
- 2026-10-28 (bis) : révision DECISION-102 (q190-q196), même fichier. 3 niveaux CLIENT|PERIMETRE|NOMINATIF sur risks,
  controls, anomalies, action_plans, **kpis** (KPI = réglage propre, pas de risk_id ; `kpis.owner` est du TEXTE donc pas
  de propriétaire-compte). Table `resource_access_grants` (ajout seul, revoked_at, cible polymorphe vérifiée au service) :
  liste ajoutée au périmètre en PERIMETRE, seule source (avec le propriétaire) en NOMINATIF. Modification : RM
  (`resourcevisibility.set`) OU propriétaire par relation ; motif dans les deux sens ; audit même transaction ;
  `widening: true`. Admin : options A1 (technique, métadonnées seulement) / A2 (voit tout) / A3 (`resource.readall`, hors
  ADMIN_PERMISSIONS, confirmé par un tiers, badge, comme DECISION-101) ; **reco A3, défaut A1**. « X non visibles » :
  un nombre par type, global, indépendant des filtres, sans ventilation, NOMINATIF exclu (risque d'alerter la personne
  visée, CENTIF). Lots V0 3j, V1 7-8j, V2 5-6j, V3 3j, V4 2j (≈20-22 j). Questions Q-1 admin, Q-2 NOMINATIF dans le
  comptage, Q-3 notifier le RM quand le propriétaire élargit.

## Principe ajouté (2026-10-18)

12. **Un statut de gouvernance ne s'ajoute pas aux enums métier** quand ces enums sont lus par des calculs : on le
    porte à côté (marqueur + helper serveur), sinon chaque lecteur filtrant `VALIDATED` casse en silence.
13. **Un intérim/suppléance ne se désigne pas soi-même** dès que la désignation finit en attribution de rôle
    (`guard:noSelfRoleAssign` sans dérogation) — c'est ce qui rend le cas « admin seul » non soluble sans PO.

14. **Un droit de lecture restreint se pose en deux couches** : ce que j'ai le droit de voir (sur la ressource) ∩ ce que
    la vue choisit d'agréger (sur le rôle). Ne pas fusionner les deux ; la 2e/3e ligne ne doit jamais être restreignable.

15. **Un comptage d'éléments cachés fuit par différence** dès qu'il suit les filtres de la vue : le rendre global,
    indépendant des filtres et sans ventilation ; exclure les objets dont la seule existence est sensible (enquête).
16. **« Admin voit tout » se traite comme un droit de lecture distinct, explicite et confirmé par un tiers**, jamais
    comme une conséquence implicite du rôle d'administration (même logique que la matrice des lignes, DECISION-098/101).

## Pièges rencontrés

- `kpis.owner` est un texte libre (016), pas une FK `users` : aucune règle « propriétaire » n'est applicable aux KPI.

- La table des paramètres est `configs` (pluriel, 024), contrairement à `audit_log` (singulier).
- Les triggers AFTER INSERT de 062 comptent les membres de groupe ligne par ligne : tout échange de membre dans une
  transaction doit retirer avant d'ajouter.

- La table du journal s'appelle `audit_log` (singulier, migration 004), pas `audit_logs` comme dans CLAUDE.md.
- Les prédicats `isAdministrator` / `isRiskManagerMember` sont privés dans `RoleService.ts` : à déplacer dans
  `domain/fixedGroupPermissions.ts` avant de les réutiliser ailleurs, jamais les dupliquer.

- Le worktree fourni peut être sur un ancien commit sans Bash pour le corriger : lire les sources dans le
  checkout principal, écrire dans le worktree, et le signaler dans le rapport.
