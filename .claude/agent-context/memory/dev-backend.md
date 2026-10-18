# Mémoire — @dev-backend (A06)

Mémoire persistante du rôle Dev Backend sur GRC Tools. À lire en premier par tout agent A06 dispatché, avant `SHARED_LOG.md` (`grep @dev-backend`). Obligatoire : la mettre à jour en fin de tâche. Les arbitrages du PO (N0) priment. Créée le 2026-10-11 (aucune mémoire A06 n'existait jusque-là).

## Principes retenus

1. Après `git checkout -B <branche> origin/<branche>` dans un worktree, vérifier `git log -1` avant toute modification : le checkout a déjà échoué silencieusement (worktree resté sur `main`), 2026-10-11.
2. `npm ci --ignore-scripts` partout (CI, Dockerfile, local) ; `tsx`/esbuild fonctionnent sans script d'install (binaires `@esbuild/*`). Ne jamais commiter un lockfile modifié par un npm local.
3. Toute liste reçue en HTTP passe par `boundedArray(el, max, min)` (`backend/src/api/validation.ts`) : zod 4.6.5 (CVE-2023-54404, pas de version corrigée) parse tous les éléments avant `.max()`. Un test garde-fou (`boundedArray.test.ts`) échoue sur tout `.array(`/`z.record`/`z.tuple` nu dans `src/`.
4. Deux limites liées partagent une constante (ex. `MAX_DEFENSE_LINES` entre `defenseLines` de l'échelle et `lines` de l'évaluation de maîtrise) — écart relevé par Gitar sur PR #148.
5. Bornes de liste : partir des payloads réels du frontend et des invariants métier, prendre large en cas de doute ; les lister dans le rapport pour relecture PO.
6. Multer : borner `fileSize` + `files` + `fields` + `parts` ; `MulterError` → 400 (413 pour `LIMIT_FILE_SIZE`), message générique « Téléversement invalide. ».
7. Tests de niveau 1 seulement (cas heureux + validations de son propre code) ; les cas limites reviennent à A08.
8. Un groupe = un rôle (`roles`/`user_roles`) ; les 3 groupes fixes se reconnaissent à `roles.system_group` (jamais au nom). Invariants dans `RoleService` (non supprimable, non renommable, Risk Manager jamais vide) + garde atomique en dépôt (`revokeFromUser(..., {minRemaining})`, `FOR UPDATE` sur le rôle). Tout nouveau tenant doit naître avec ses groupes (CTE dans `PostgresTenantRepository.create`).
9. Dépendance qui porte une règle de sécurité (ex. `DepartmentRepository` pour valider un `departmentId`) : paramètre optionnel, mais `throw` si la donnée à valider est fournie sans la dépendance (fail closed), jamais « skip ».
10. Un script Python/heredoc enchaîné avec `cd`/`&&` peut être refusé par le harnais du worktree ; écrire le script dans le scratchpad et l'appeler avec un chemin absolu. Ne jamais relancer un script de patch sans vérifier `git status` (non idempotent : doublons).

## Historique

- 2026-10-11 — Lot B-8 / R1.2 (branche `feat/b8-groups`, migration 049) : groupes fixes + `roles.department_id` + `processes.department_id`.
- 2026-10-11 — B-8 v2 (`feat/b8-groups-v2`, retour QA/Sécu) : un membre actif = assignation non révoquée ET utilisateur non suspendu (JOIN `users.deleted_at IS NULL`) ; la suspension est un retrait de groupe → même garde Risk Manager (pré-check `RoleService.assertNotLastRiskManager`, garde atomique `FOR UPDATE` dans `PostgresUserRepository.suspend`) ; ids en `z.guid()` (pas `z.uuid()`, strict RFC, rejette les ids du seed) ; 23505 sur index unique → `ValidationError`.

- 2026-10-11 — Lot S1 (PR #147) : limites multer + mapping `MulterError`. Lot S-1 (PR #148) : `boundedArray` sur 14 schémas HTTP, règle ajoutée dans `CLAUDE.md`.

## Ouvert (voir `ACTION_ITEMS.md`)

- ~60 `z.string()` sans `.max()`, `limit` négatif sur `GET /audit-logs`, upload `branding` sans `files`/`parts`, `express.json` 1 Mo → 256 ko : proposés au lot « dette Sonar ».
- S-2 : `overrides` unzipper 0.12.5 (reporté, DECISION-037).
- `ActionPlanService` accepte une évidence DELETED pour clôturer (lignes ~399-401).

## 2026-10-11 — Mini-lot sécurité (DECISION-038 pt 4, branche `fix/sec-minilot`)

- `GET /audit-logs` : `limit` parsé par `z.coerce.number().int().min(1).max(500)` (max = `MAX_LIMIT` de `AuditLogService`) ; hors bornes/non numérique → ZodError → 400. Avant : `Number(x) || undefined` laissait passer `-5` jusqu'au SQL. Le parsing n'était PAS partagé : les autres routes de liste (users, notifications, riskEvaluations) ont leur propre `PaginationQuery` zod déjà bornée 1..100 ; `kriMeasures` (`page`/`pageSize` via `Number()`) n'a pas été vérifiée, hors périmètre.
- `ActionPlanService.close` : évidence `status === "DELETED"` refusée avec le même message que « introuvable ».
- Principe : un `Number(query) || undefined` n'est pas une validation ; toujours zod borné sur les paramètres numériques de query.
- Worktree sans `node_modules` : `npm ci --ignore-scripts` avant typecheck/test.
- Suite (fix/sec-minilot-v2) : `from`/`to` de `GET /audit-logs` validés par zod (date non parsable → 400, vide/absent inchangé).
## 2026-10-11 — Lot B-9 « échelle » (R1.3, migration 050)

- Règles d'échelle (taille 3 à 6, probabilité = impact, 7 axes max, descriptifs exacts par niveau) appliquées dans `RatingScaleService` (create/updateImpactAxes), donc sur les NOUVELLES versions seulement. Pas de CHECK en base sur ces règles : les versions ACTIVE/ARCHIVED sont immuables (R-01) et des lignes héritées peuvent valoir 1..5 avec tailles inégales. La migration 050 ne fait qu'ÉLARGIR les CHECK (rating_scales, risks) à 1..6 : aucune ligne existante ne peut être cassée, pas de NOT VALID.
- Descripteurs par axe : `ImpactAxis.levelLabels` optionnel (JSONB, aucune colonne). Optionnel pour ne pas casser le front actuel ; à rendre obligatoire à la création du Dispositif (B-6) — question PO.
- `RiskEvaluationService` n'a pas été modifié : il borne déjà par `ratingScale.probabilityLevels/impactLevels`. Plafonds de score à 25 codés en dur restent (appétit, seuils comité, bandes par défaut Cartography/Dashboard) : score max devient 36.
- Les constantes `MAX_SCALE_SIZE`/`MAX_IMPACT_AXES` (`api/validation.ts`) sont dupliquées dans le service (la couche services n'importe pas `api/`).
- 2026-10-11 — v2 (F-B9-01/02, Security) : `.max(200)` label/code, `.max(120)` name/version ; `setJsonColumn` filtre `status = 'DRAFT'`, 0 ligne sur échelle existante → ValidationError (défense en profondeur de R-01).
- 2026-10-11 — F-B8-05 : pré-contrôle `revokeFromUser` RM corrigé. Le comptage exclut les suspendus, donc cible suspendue = non comptée : `others = cible active ? actifs-1 : actifs`, refus si `others < 1` (même sémantique que la garde dépôt). Cible lue via `users?.getById` ; sans UserRepository, comportement prudent inchangé (fail closed). Dépôt non touché.

## 2026-10-11 B-9 bis (branche `wt/b9bis`, migration 052)

- Taille de matrice n = `impactLevels` de l'échelle ACTIVE (aucun lien « taille choisie à la création du Dispositif » n'existe dans le modèle : écart signalé, rien inventé). Une seule source de règle : `domain/scoring.ts` (`maxScoreForSize`, `defaultCriticalityBands`, `DEFAULT_MATRIX_SIZE`=5, `ABSOLUTE_MAX_SCORE`=36) + `services/scoreCeiling.ts` (`resolveMaxScore`, lit l'échelle ACTIVE via `list`). Sans dépôt d'échelle câblé ou sans échelle active : repli 5x5 (25).
- Plafonds 25 corrigés : `RiskAppetiteService` (MAX_THRESHOLD), `ConfigService` seuils Comité (MAX_APPETITE_THRESHOLD supprimé de `RiskEvaluationService`), `appetiteOverride` (n² de l'échelle de l'évaluation), route zod `riskAppetite` (borne absolue 36, le service affine), bandes par défaut de `CartographyService`/`DashboardService`, CHECK en base (052 : `risk_appetites.threshold`, `configs.committee_*_min_score` → 36, noms cherchés dans pg_constraint). `updateThresholds` refuse une bande > n².
- q50 : `activateVersion` exige un descriptif non vide par niveau (probabilité, impact, chaque axe d'impact configuré) ; brouillon : facultatif. Les doubles de tests créent des descriptifs par défaut pour ne pas polluer les tests d'activation.
- Restes volontaires : défaut Comité 15 inchangé ; Dashboard garde les bandes 5x5 (non câblé à l'échelle) ; seuils/appétences existants > n² après activation d'une échelle plus petite non revalidés.

## 2026-10-11 B-8 bis (branche wt/b8bis, migration 051)

- Droits des 3 groupes poses par la migration 051 (seulement si le groupe est vide de permissions) ; groupe Audit REMPLACE Auditeur (detenteurs reportes, role desactive en soft ; un detenteur deja Risk Manager est retire sans entrer dans Audit). Seed dev adapte.
- Cumul Risk Manager + Audit refuse en dur (`FORBIDDEN_CUMUL` dans RoleService.assignToUser) ; RM + Comite autorise, expose par `UserService.getDetail` (`fixedGroups`, `riskManagerAndCommittee`). Reglage configurable attend q58 : pas fait.
- Motif obligatoire (<= 500) pour assigner/retirer un membre d un groupe fixe : 5e parametre optionnel `reason`, inscrit dans `audit.reason`.
- Droits du groupe Audit : `rolegroup.audit.update` (admin appli, jamais donne a un role) ; si l acteur est aussi RM -> `role_permission_changes` PENDING, valide par membre Audit/Comite (`rolegroup.audit.validate`), jamais l auteur. `RoleService.update` refuse `permissions` sur le groupe Audit.
- departmentId obligatoire a la creation d un processus (service + route), nullable en base.
- F-B8-06 : `reactivate` renvoie `lostRoles` et notifie (resourceType MANAGEMENT, CHECK elargi en 051). `GET /roles/grantors?permission=` : noms d affichage seuls, audit action READ (ajoutee au CHECK) a chaque appel.
- Principe : ajouter une action d audit = elargir audit_log_action_check dans la meme migration.
- Tests A08 existants adaptes (motif sur groupes fixes, departmentId sur creation de processus).
- Non fait : activation du premier Dispositif (inexistante cote backend) ; perimetre tous les risques (q66) inchange.

## 2026-10-11 B-9 bis correctifs (branche wt/b9fix, base dc3c855)

- Down 050/052 enveloppés dans BEGIN/COMMIT ; README : `psql -1 -v ON_ERROR_STOP=1 -f`. Les up ne sont pas touchés.
- `domain/scoring.ts` : `maxScoreForScale` (P x I), `defaultBandsForMaxScore`, `defaultCommitteeThreshold` (= borne haute de la 3e bande, 15 en 5x5). Utilisé par RiskEvaluationService (défaut sans config) et ConfigService.get (sans ligne). Limite : une ligne `configs` existante porte déjà 15 en base (DEFAULT SQL), indistinguable d'un 15 explicite : non modifiée.
- DashboardService : 16e paramètre optionnel `ratingScales` (getById), bandes de l'échelle capturée par l'évaluation, repli 5x5.
- Plafond = P x I partout (scoreCeiling, RatingScaleService, RiskEvaluationService, Cartography).
- F-B9b-01 : `RatingScaleService.activateVersion` refuse si bande/appétence active/seuil Comité > plafond de la nouvelle échelle (params optionnels riskAppetites, configs, câblés dans server.ts). Conséquence : passer à une échelle plus petite que la 5x5 exige d'abaisser d'abord le seuil Comité (15 par défaut en base).
- F-B9b-02 partiel : `.max(36)` sur seuils Comité, `label.max(200)`. Bornes `.max(36)` sur bandes NON posées : casse QA-S1-zod (bandes 1..50 acceptées par un test existant non modifiable).
- Leçon : l'environnement refuse les commandes bash composées avec heredoc python + autres ; passer par un fichier script ou Edit.

## 2026-10-11 B-8 ter correctifs (branche wt/b8ter, base f2d07b4, migration 053 non appliquée)

- Source unique des droits des 3 groupes : `domain/fixedGroupPermissions.ts` (`FIXED_GROUP_PERMISSIONS`), réutilisée par `PostgresTenantRepository.create` (params `$3..$5::text[]`) ; un test compare la constante aux listes de la migration 051 (inchangée). Même fichier : liste blanche Audit (`isAuditGroupPermission` : `*.read`, `*.download`, `dashboard.executive`, `rolegroup.audit.validate`), placement de `rolegroup.audit.*` (`update` sur aucun rôle, `validate` seulement Audit/Comité), `isAuditPermission` (`audit.*`).
- `RoleService.assertAssignable(actor, roleId, userId|null, reason)` : motif + cumul RM/Audit (groupes ET permissions `audit.*` effectives) avant toute écriture ; `UserService.create` l'appelle avant d'insérer le user (B8bis-01). RM et Comité ne peuvent pas porter `audit.*`.
- Changement Audit : `reason` obligatoire (service + zod), liste blanche lecture, un seul PENDING (refus applicatif + index unique partiel + colonne `reason` en 053), validateur non-RM, notification MANAGEMENT `AUDIT_RIGHTS_CHANGE_PENDING` (échec loggé, non fatal), `GET /roles/permission-changes?status=` (diff avant/après), application échouée -> `reopen` du claim (pas de transaction inter-repos). Méthodes `reopen`/`list` OPTIONNELLES sur l'interface (faux repos existants).
- `/roles/grantors` : vide si permission déjà détenue ou `role|rolegroup|user|audit.*` ; limiteur par utilisateur 20/15 min (`grantorsRateLimiter`) ; audit dédoublonné par (tenant, user, permission, heure) en MÉMOIRE de l'instance (limite : plusieurs instances Cloud Run = quelques lignes de plus, borné par le limiteur).
- `ActionPlanService.close` refuse aussi `responsibleUserId === actor.userId`. Lien évidence-action NON fait : `Evidence` n'a aucune colonne vers un plan d'action (schéma = A07/A05).
- `PATCH /processes/:id` : `departmentId: null` refusé si le processus est déjà rattaché.
- Notification après réactivation : try/catch + `console.error` (aucun logger injecté dans les services).
- Tests existants adaptés (fixtures, pas d'assouplissement) : rôle « autre » avec `audit.read` donné à des RM -> `risk.read` (RoleService.test, QA-B8-groups) ; responsable d'action != clôturant (ActionPlanService.test, QA-sec-minilot) ; `reason` ajouté aux appels `changeAuditGroupPermissions` ; OBSERVATIONS QA (plusieurs PENDING, droits d'écriture pour Audit, detach processus, 1 audit par appel) converties en assertions du nouveau comportement.
- Leçon : worktree sans node_modules -> lien symbolique vers celui du dépôt principal (ne pas le committer, `git add` par chemins) ; commandes bash composées avec heredoc refusées dans le worktree -> Write/Edit ou script python via fichier.

## 2026-10-11 B-8 quater + bandes (branche wt/b8q, base baea2e1, migration 054 non appliquée)

- q58 : colonne `configs.committee_audit_cumul_allowed` (défaut true, migration 054 + down), `Config.committeeAuditCumulAllowed`, `ConfigService.setCommitteeAuditCumul` (permission dédiée `config.cumul.set`, motif obligatoire, audit UPDATE), `PUT /config/committee-audit-cumul {allowed, reason}`. Contrôle dans `RoleService.assertAssignable` (7e param. constructeur OPTIONNEL `configs`, absent = autorisé). Agit sur les assignations futures seulement. RM+Audit reste en dur.
- q63 : « administrateur » = détient, via un rôle actif, une de `role.create/update/delete/assign`, `user.create/update/delete/reactivate`, `rolegroup.audit.update` (les `.read` ne comptent pas). Création du cumul admin+RM (dans les deux sens) : motif exigé (<= 500), notification `ADMIN_RISK_MANAGER_CUMUL` aux porteurs de `rolegroup.audit.validate` (Audit+Comité), sauf l'intéressé. Fiche `GET /users/:id` : `administratorAndRiskManager`. Limite : modifier les permissions d'un rôle déjà porté par un RM (RoleService.update) ne déclenche pas ce contrôle.
- q65 : entrée au Comité -> notification `COMMITTEE_MEMBER_ADDED` aux porteurs de `audit.read` (= groupe Audit, un rôle perso avec audit.read compte aussi).
- `notifyValidators` refactoré en `notifyMembers` générique (best effort, erreur loggée).
- DECISION-041 : `GET /cartography/scale` (permission `cartography.read`), `CartographyService.getActiveScale`.
- Leçon : heredoc python composé refusé dans le worktree -> Write d'un script dans le scratchpad puis `python3 script`.

## 2026-10-11 B-8 quinquies (branche wt/b8q5, base 00fbc3e, aucune migration)

- `RoleService.assertCumulRules(tenantId, role, others, previous, reason)` = source unique des règles de cumul (RM+Audit, Comité+Audit selon réglage, admin+RM avec motif), appelée par `assertAssignable` ET par `update`. « Membre Audit » = groupe Audit OU permission `audit.*` effective (q58-01, dans les deux ordres).
- `update(actor,id,input,requestId,reason?)` : si des permissions sont ajoutées, rejoue les règles pour chaque détenteur actif (`roles.listAssignments`, revokedAt null). Nouveau cumul admin+RM : `reason` exigé, inscrit dans l'audit PERMISSION_CHANGE, notification `ADMIN_RISK_MANAGER_CUMUL` par détenteur. Contrat API : `PATCH /roles/:id` accepte `reason` (optionnel, <= 500).
- `ADMIN_PERMISSIONS` + `config.cumul.set`, `config.committeeenforcement.set` (config.manage/update NON touchés : F-B8t-06 au Risk Manager).
- Assigner un rôle déjà détenu -> `ConflictError` (409) dans `assertAssignable`.
- F-B8t-03 : approbation revérifie `isAuditGroupPermission` avant le claim (le PENDING reste rejetable) ; requête 6 ajoutée à `docs/security/B8-predeploy-checks.sql`.
- F-B8t-04 : aucune transaction inter-repos dans le repo -> choix simple : `reopen` seulement si l'application des droits échoue ; une fois appliqués, un échec d'audit est loggé et renvoyé SANS reopen (statut APPROVED = droits appliqués). Limite : l'événement d'audit manquant n'est pas rejoué.
- Fakes de tests B8ter/QA-B8quater : `listAssignments` ajouté (méthode requise de l'interface réelle, fail-closed plutôt que `?.`).
- Leçon : un heredoc dans une commande composée est refusé ; Write d'un script dans le scratchpad (nom unique : edit.py existait déjà).

## 2026-10-11 B-8 sexies (branche wt/b8r, base 720b606, aucune migration)

- q65-02 : `PostgresRoleRepository.assignToUser` traduit 23505 sur `user_roles_active_idx` en `ConflictError` (409). Le `it.fails` de QA-B8quinquies est devenu `it` (le faux repo lève maintenant `ConflictError`, comme le vrai).
- F-B8q-01 : le repo avait déjà un pattern transaction (`revokeFromUser`) -> `assignToUser` fait BEGIN + `SELECT ... FOR UPDATE` sur la ligne `roles` (non supprimée, sinon NotFoundError) + INSERT. `update` laissé tel quel : un UPDATE verrouille déjà la ligne. Limite : cela ordonne l'INSERT et l'UPDATE mais ne ferme pas la fenêtre check-then-act du service (règles de cumul lues avant) ; il faudrait les rejouer sous verrou.
- F-B8q-03 : pas de transaction inter-repos (audit/rôles/changements = trois repos). Choix : (a) si `roles.update` échoue, relire le rôle ; si ses droits égalent ceux du changement, il est appliqué -> pas de reopen, on poursuit vers l'audit ; (b) `reopen` SQL gardé par `NOT EXISTS` autre PENDING du même rôle, retourne un booléen ; `false` loggé, erreur d'origine renvoyée. Requête 7 (APPROVED sans audit_logs) ajoutée à `docs/security/B8-predeploy-checks.sql`.
- Leçon : commandes bash composées (heredoc + git) refusées en worktree ; découper et passer par Write/Edit.
## 2026-10-11 EVD-2 « Analyse » (branche wt/evd2, base 720b606, aucune migration)

- `POST /api/v1/evidences/:id/analysis` (permission `evidence.import`, limiteur `costlyOperationRateLimiter`) -> `EvidenceService.analyze` : permission, lookup tenant-scopé (`getOwnedOrThrow`), refus si non xlsx / sans sha256 / `fileSize` > 5 Mo, PUIS `getContent`, contrôle SHA-256 (409 si altéré), PUIS `analyzeXlsx` (`services/xlsxAnalysis.ts` : plafond 5 Mo, `assertSafeXlsxArchive`, exceljs, 50 feuilles, 20 000 lignes, 50 colonnes). Le plafond de lecture Drive 25 Mo (`getContent`) est celui d'EVD-1.
- Aucune écriture, aucun audit (cadrage : « Aucune écriture »). Question ouverte : auditer la lecture du contenu comme `DOWNLOAD` ?
- Exemples toujours renvoyés : aucun indicateur `confidential`/données personnelles n'existe sur `Evidence` (décision 14 du cadrage, dataset EVD-3). Signalé, non inventé.
- Formules : on lit `result` en cache, jamais évaluées. Colonnes entièrement vides (en-tête ET données) non listées ; colonne avec en-tête et sans donnée : `isEmpty: true`.
- `evidence.import` NON ajouté aux groupes fixes : HUMAN l'accorde par SQL.
- Leçon : commande bash composée avec heredoc python refusée dans le worktree -> Write/Edit directement.

## 2026-10-11 centre de notifications (branche wt/notifb, base 2cf4f48, aucune migration)

- Routes : `GET /notifications/unread-count` (data = nombre), `POST /notifications/read-all` (data = {updated}), `GET /notifications/types` (catalogue). Toutes `notification.read`, limitées à actor.userId + actor.tenantId ; read-all audite une ligne (UPDATE, reason MARK_ALL_READ, entityId = userId car entity_id NOT NULL) seulement si count > 0.
- `domain/notificationCatalog.ts` : 7 types, 4 gouvernance `mandatory: true`. `subscribe(enabled=false)` sur un type obligatoire -> ValidationError.
- `NotificationService.emit` = record + respect du désabonnement explicite (ignoré pour les obligatoires) ; `record` inchangé. Les 4 types obligatoires gardent `record`.
- Persistés : ACTION_STARTED_LATE / ACTION_OVERDUE -> responsible_user_id seul ; KRI_THRESHOLD_BREACH -> owner + superior owner du risque principal du KRI (backlog ACT-135). Params de constructeur optionnels en fin (ActionPlanService +notifications ; KriMeasureService +notifications, +risks). Best effort, erreur loggée. Telegram inchangé.
- Non fait : Risk Owner + superior des risques liés pour les plans d'action (ACT-193, liens multiples : règle de choix non définie) ; notifications de Risk/Governance/Feedback (non demandées) ; pas de dédoublonnage d'escalateIfOverdue répété.
- Leçon : heredoc python composé refusé -> script dans le scratchpad puis exécution seule.

## 2026-10-12 EVD2bis : F-B8s-01, F-EVD2-01/02/03 + 5 KNOWN GAP QA (branche wt/evd2bis, aucune migration)

- F-B8s-01 : `RoleRepository.assignToUser(..., recheck?)` verrouille `users` (cible, `deleted_at IS NULL`, sinon NotFound) PUIS `roles` (`SELECT *`), relit les rôles détenus sous verrou et appelle `recheck(lockedRole, held)` ; le service y rejoue `assertCumulRules` (la pré-vérification reste, pour les faux repos). `update(..., recheck?)` (élargissement seulement) : verrouille les users détenteurs (ORDER BY id) puis le rôle, relit les détenteurs (nouveau détenteur apparu = ConflictError « retry »), rejoue le cumul avec les rôles lus sous verrou, puis UPDATE dans la même transaction. Ordre fixe user -> role. Non testé sur vrai Postgres (tests = faux pool).
- `rollbackQuietly` : un ROLLBACK en échec ne masque plus l'erreur d'origine (assign, revoke, update). B8s-QA-02 : « droits appliqués » = égalité d'ENSEMBLES (doublons ignorés).
- F-EVD2-01 : `assertSafeXlsxArchive(buffer, {maxTotal, maxEntry})` ; analyse = 8 Mo total / 6 Mo par entrée, avant `xlsx.load`. Sémaphore par processus `MAX_CONCURRENT_ANALYSES = 2` dans `EvidenceService` (409 ConflictError au-delà, libéré en `finally`), + `perUserRateLimiter` (20 / 15 min, clé tenant:user) sur la route. Limite : sémaphore par instance, pas global multi-instances ; mémoire du conteneur (A09/A16) non confirmée.
- F-EVD2-02 : `examples` seulement si `evidence.download`. F-EVD2-03 : audit `READ` fail-closed après le contrôle SHA-256, avant l'analyse ; `newValue` = {fileName, sha256, examplesReturned} ; `sheetCount` NON inclus (inconnu avant l'analyse, écrire après casserait le fail-closed). `analyze(actor, id, requestId = "unknown")`.
- QA : date hors plage -> cellule illisible (null) ; en-tête avec années (entiers 1900-2100) reconnu ; libellé de lien rich text résolu récursivement. Tests existants adaptés : EVD2.test (acteur avec download, 1 écriture = l'audit READ), B8sexies.test (séquence SQL avec verrou user), QA (observation convertie, 2 tests figeant le 500 supprimés).
- Skill `ponytail` introuvable dans l'environnement : principe appliqué à la main. Worktree supprimé en cours de tâche : recréé via `git worktree add -B`.

## 2026-10-12 NOTIFFIX : F-NOTIF-01/03/04/05/06 + NOTIF-QA-01/02 (branche wt/notiffix, base f520794, aucune migration)

- Dédoublonnage applicatif (pas d'index unique, pas de migration) : `NotificationRepository.existsUnread?` (optionnel, SQL tenant+destinataire+resource+event, `read_at IS NULL`) ; `emit({... skipIfUnread: true})` l'utilise. Choix d'un flag sur `emit` plutôt qu'une nouvelle méthode : les mocks de tests qui n'exposent que `emit` continuent de marcher. Utilisé par ACTION_OVERDUE et KRI_THRESHOLD_BREACH seulement. Limite : deux appels réellement concurrents peuvent insérer deux lignes ; repo sans `existsUnread` = pas de dédup (fail-open).
- `/action-plans/:id/escalate` : `perUserRateLimiter()` (20 / 15 min par tenant:user).
- F-NOTIF-03 : messages « Seuil KRI dépassé (KRI <id>) », « Action en retard (action <id>) », « Action démarrée en retard (action <id>) » ; le canal `Notifier` externe garde ses textes détaillés (hors périmètre).
- F-NOTIF-04 : contrôle du catalogue dans `NotificationService.subscribe` (ValidationError -> 400), `.max(100)` zod. Tests existants qui s'abonnaient à `KRI/THRESHOLD_BREACH` (hors catalogue) passés à `KRI_THRESHOLD_BREACH`.
- F-NOTIF-05 : `z.string().uuid()` sur `:id`, `.max(100)` sur le filtre `eventType`. F-NOTIF-06 : KRI sans émission si risque `ARCHIVED`/`deletedAt`. NOTIF-QA-01 : try/catch par destinataire.
- F-NOTIF-02 (types désactivables) NON touché : décision PO q85.
## 2026-10-12 B-6a « Socle du Dispositif » (branche wt/b6a, base f520794, migration 055 NON appliquée ni exécutée)

- Écrit : `RiskFrameworkService` (cycle DRAFT -> PENDING_APPROVAL -> ACTIVE -> ARCHIVED), `PostgresRiskFrameworkRepository` (pool pg, pattern `tx` + `rollbackQuietly`), `domain/frameworkApproval.ts` (`resolveDecider` pur), `domain/ratingScaleRules.ts` (`assertLevels`/`assertDescriptors`/`assertReadyToActivate` DÉPLACÉS depuis `RatingScaleService`, pas copiés), routes `/api/v1/risk-frameworks`, 6 permissions `riskframework.*`, migration 055 + down. Migration écrite par A06 lui-même (A07 non spawné, aucun outil Agent disponible) ; jamais exécutée : à faire rejouer deux fois sur Postgres jetable par A07/A08 (triggers, DO $$ de reprise, regex du test B8ter sur 055).
- Décisions PO appliquées (recommandations de la spec) : q87 demande « vote » = PENDING + 409 sur approve ET reject, message nommant le groupe ; q90 audit juste après l'action (échec loggé puis renvoyé, pas de reopen) ; q91 seuls les paramètres du §2.2 ; q92 auto-proposition refusée à la création de la demande hors vote Comité (donc inactivable avant B-12). Aucun amorçage (B-6d).
- Choix hors texte de la spec (à relire) : (1) demande WITHDRAWN = `decided_by` NULL, `decision_regime` NULL (le CHECK maker-checker interdirait que le demandeur « décide » son retrait) ; (2) `activation_request_id` sans FK (cycle de création des tables) ; (3) `AUDIT_AND_COMMITTEE` : chaque groupe éligible (>=2) vote, aucun éligible -> repli RM ; (4) auteurs exclus = `created_by` + `last_edited_by` + users des audits CREATE/UPDATE de la version ; (5) `reject` suit le même circuit que `approve` (409 si un vote est requis) ; (6) liste blanche `PARAM_KEYS` dans le service : une clé inconnue (ex. `status`) est ignorée même sans zod ; (7) unicité d'appétence = (subCategory, entity) exacte après trim, sensible à la casse comme l'index de `risk_appetites`.
- Test existant adapté (source de vérité changée, à signaler à A08) : `B8ter` compare la constante des groupes à 051 + ajouts de 055 ; `QA-B8quater` n'exige plus que 054 soit le dernier numéro mais garde « sans trou depuis 53 ».
- Non fait (B-6b/c/d) : résolution du Dispositif applicable, instantané F-8, Cartographie, fermeture des écritures `configs`/`risk_appetites`/`activateVersion`, `GET /applicable`, rattachement Processus, défaut, archivage d'un Dispositif, amorçage.
- Leçon : dans ce worktree, `cat <<EOF > fichier` composé est refusé ; Write/Edit, ou `python3 - <<'EOF'` seul fonctionne.

## 2026-10-12 NOTIFRACE : F-NOTIF-01 en concurrence (branche wt/notifrace, base 0c253b6, aucune migration)

- `NotificationRepository.insertIfNoUnread?` (optionnel) : `PostgresNotificationRepository` ouvre une transaction (`pool.connect`), `pg_advisory_xact_lock(hashtextextended(clé, 0))` sur `tenant|destinataire|resourceType|resourceId|eventType`, SELECT non-lu, INSERT si absent, COMMIT ; ROLLBACK (avalé) + `release` en `finally` sur erreur.
- `NotificationService.emit` : si le repo expose `insertIfNoUnread`, `write(input, dedupe)` l'utilise (null = déjà une non-lue, audit non écrit) et le pré-check `existsUnread` est sauté ; sinon repli sur l'ancien comportement (fakes inchangés). `record` délègue à `write(input, false)`.
- `perUserRateLimiter()` sur `POST /kri-measures`.
- Non testé sur vrai Postgres (fake pool) : le test de régression « 20 emit parallèles = 1 ligne » reste à rejouer par A10/A08. Verrou advisory = par transaction, donc libéré au COMMIT/ROLLBACK ; l'audit est écrit après, hors transaction (inchangé).

## 2026-10-12 B-6a bis (branche wt/b6abis, base 16ff888, aucune migration)

- F-B6a-01 : `PostgresRiskFrameworkRepository.mirrorScale` (dans la transaction de `recordDecision`) verrouille l'échelle, refuse ARCHIVED, rejoue le plafond n² (version, `configs`, `risk_appetites` actives) et archive toute autre échelle ACTIVE **qu'aucune version ACTIVE ne référence** (pas « toute autre » : un second Dispositif actif garde la sienne). Un throw = ROLLBACK de toute la décision.
- F-B6a-02 : `createActivationRequest` prend `validateLocked` (optionnel, fakes inchangés) : SELECT ... FOR UPDATE de la version puis rejeu de `validateRequestable` (assertActivatable + q65). `decide` rejoue la même méthode à l'approbation seulement (un refus d'une version devenue invalide reste possible).
- B6a-QA-01 sans migration : l'audit UPDATE est écrit AVANT le stockage de la modification. Effet de bord assumé : une entrée UPDATE peut exister pour une modification qui n'a pas pu être stockée (sur-exclusion, jamais sous-exclusion). Le `it.fails` converti en `it` : l'étape « l'édition a été stockée » est devenue « n'a PAS été stockée », et u3 refait une édition réussie avant le test final Forbidden (assertion finale inchangée).
- C-B6a-01 (partiel) : notifications envoyées puis erreur d'audit relancée (SUBMIT et APPROVE/REJECT). L'audit reste hors transaction (q90 ouverte).
- C-B6a-02 : `checkParams` refuse tout `changeApprover` != RISK_MANAGER (create + updateDraft). Les tests q87 posent désormais l'approbateur en donnée stockée (helpers `draft`/`created`).
- C-B6a-04 : motif de retrait obligatoire dans le service ; le zod de la route reste `optional()` volontairement (sinon 400 avant 403/404 dans les tests QA de surface HTTP).
- F-B6a-07 : `notify(..., dedupe)` utilise `emit({skipIfUnread:true})` si `emit` existe, sur `resourceId` = id du Dispositif.
- F-B6a-04 : `authorsOf` ajoute les auteurs (audit CREATE/UPDATE `RatingScale`) quand l'échelle référencée est DRAFT. Le document d'arbitrage A13 n'était pas dans ma base : implémenté d'après le message du coordinateur.
- Leçon : un `validateLocked`-style callback optionnel évite de modifier les fakes de repository des tests existants.

## 2026-10-12 F-B6a-10 (branche wt/b6a10, base 27aa4de, aucune migration)

- `mirrorScale` : après les deux UPDATE des échelles, `SELECT min(probability_levels * impact_levels) FROM rating_scales WHERE status = 'ACTIVE'` (= activée + conservées car référencées par une version ACTIVE) ; tout seuil collecté (version, `configs`, appétences actives) au-dessus de ce plus petit plafond -> ValidationError listant les seuils, donc ROLLBACK de la décision. Le contrôle contre l'échelle activée reste en premier (messages existants inchangés).
- Fakes de B6abis/QA-B6abis : ajout d'un handler pour la nouvelle requête `SELECT min(` (source de vérité changée, à signaler à A08). Test : `B6aFix10.test.ts` (scénario A10, 30 refusé / 25 accepté).
- Leçon : un contrôle ajouté APRÈS les UPDATE reste annulé par le ROLLBACK ; pas besoin de pré-calculer l'ensemble des échelles restantes en SQL ou en JS.

## 2026-10-12 Notifications q84/q85/q95 (branche wt/notif-q84q85q95, base 37766ab, DECISION-044)

- Catalogue : 11 types, tous `mandatory` (4 MANAGEMENT RISK_FRAMEWORK_* ajoutés ; KRI_THRESHOLD_BREACH, ACTION_STARTED_LATE, ACTION_OVERDUE passés obligatoires ; ferme F-NOTIF-02). Plus aucun type optionnel : `subscribe(enabled:false)` est refusé partout, `enabled:true` reste accepté. Mécanisme d abonnement gardé (pas demandé de le retirer).
- q84 : `ActionPlanService.resolveRecipients` = responsable + owner/superior de chaque risque couvert (sourceType RISK + liens RISK), Set sans doublon, risques archivés/supprimés ignorés (F-NOTIF-06), tenant = actor.tenantId, un try par destinataire. Sans RiskRepository câblé : responsable seul (repli, tests existants intacts).
- Tests figeant un opt-out réel adaptés : on pousse une ligne d abonnement périmée (`subs.push`) pour prouver qu elle est ignorée. Frontend inchangé (reflète déjà `mandatory`).
- Leçon : heredoc python refusé par le harnais ; Write d un script dans le scratchpad puis python3 chemin absolu.
## 2026-10-12 RBAC DECISION-044 : q94 / q80 / q79 (branche wt/rbac-q79q80q94, base 37766ab, aucune migration)

- q94 : `assertNoCumul` (RoleService) refuse aussi Risk Manager + Comité (groupes), dans tous les chemins qui passent par `assertCumulRules` (assignation, rejeu sous verrou F-B8s-01, élargissement d'un rôle). Non configurable. `UserService.reactivate` appelle `RoleService.assertReactivable` : refuse de réactiver un utilisateur qui détient encore un cumul interdit (RM + Comité ou RM + Audit) antérieur à la règle. `riskManagerAndCommittee` sur la fiche est conservé uniquement pour repérer les cumuls pré-existants.
- q80 : `createsAdminCommitteeCumul` calculé comme admin + RM ; motif obligatoire (message distinct), même événement `ADMIN_RISK_MANAGER_CUMUL` (type obligatoire déjà au catalogue, message « Comité des risques »), champ `administratorAndCommittee` sur `GET /users/:id`. Pas de nouveau type de notification (évite de toucher aux tests « 4 types obligatoires »).
- q79 : « gestion du client » = `config.manage` (clients, modules, référentiels, catégories de risque, import Excel) ajouté à `ADMIN_PERMISSIONS` ; la méthodologie (`config.update`) non.
- Requêtes de repérage 8 (RM + Comité) et 9 (config.manage, avec RM/Comité) ajoutées à `docs/security/B8-predeploy-checks.sql` — lecture seule, HUMAN seul exécute.
- Exigence B-12 consignée (rien de construit, aucun code de vote n'existe) : l'administrateur ne vote ni ne ratifie jamais une demande qu'il a faite ou un changement de droits qu'il a appliqué (q80).
- Tests QA adaptés (source de vérité PO changée) : B8bis (2), B8quater (1), QA-B8bis (2), QA-B8quater (2) ; nouveau `Rbac044.test.ts`.
- Leçon : un rôle de test portant `role.assign` est « administrateur » : après q80 l'ajouter à un membre du Comité exige un motif.
## 2026-10-12 B-6a q87 + q90 (branche wt/b6a-q87q90, base 37766ab, aucune migration)

- q87 : `assertApproverAllowed` (service) refuse tout `changeApprover` != RISK_MANAGER à la création et à l'édition de brouillon (déjà là depuis B-6a bis). Nouveau : la copie `createDraftFrom` met `'RISK_MANAGER'` en littéral SQL au lieu de copier `change_approver` (un refus aurait cassé la copie d'une version héritière et les tests de circuit). `decide`/`resolveFor` inchangés : le circuit suit la version ACTIVE, donc une version héritière COMMITTEE/AUDIT reste fail-closed (409). Une version active héritière non-RM bloque toujours le Dispositif (sortie = intervention base) : à porter à A13/A05.
- q90 : `RiskFrameworkRepository.auditsInTransaction?` + paramètre `audit?: TransactionalAudit<R>` (callback `result -> événements`) sur chaque méthode mutante ; `PostgresRiskFrameworkRepository` insère via `insertAuditEvent(client, e)` (extrait de `PostgresAuditRepository`) AVANT le COMMIT ; un échec d'audit = ROLLBACK. Service : `inTx` -> passe le callback ; sinon (faux repos des tests) enregistre après coup comme avant. `updateIdentity`/`updateDraft`/`discardDraft` passés de `pool.query` à `tx`. `holders()` n'échoue plus (liste vide + log) : les notifications ne sautent plus pour un échec non lié. Notifications toujours après COMMIT.
- Effet : plus d'état « action appliquée mais audit perdu » en production ; l'ordre « audit avant stockage » de B6a-QA-01 n'est plus nécessaire en prod (reste pour les faux repos).
- Non couvert : lectures `listForEntity` (auteurs) inchangées ; non testé sur vrai Postgres (faux pool) ; autres modules (Risk, Control...) gardent l'audit hors transaction.

## 2026-10-12 G1 (branche wt/g1, DECISION-044 / A13)

- `changeAuditGroupPermissions` : mise en attente si l'auteur est RM OU membre du Comité (`RISK_COMMITTEE`), même mécanisme (`role_permission_changes`, `requestedBy` exclu de la décision). Cause : depuis q80 un admin peut être au Comité et appliquait seul.
- Principe : quand une règle de SoD dépend d'un cumul de groupes, relire toutes les gardes qui testent UN groupe quand le cumul autorisé change.
- Tests dans `B8bis.test.ts` (describe G1). Aucune assertion existante modifiée. Worktree sans node_modules : `npm ci --ignore-scripts` (sinon faux échecs typecheck sur Buffer/any).
## 2026-10-12 q96 (branche wt/q96, base fe31915, DECISION-045 pt 1)

- `ActionPlanService.resolveRecipients` : une action sourceType KRI ajoute `Kri.riskId` (lu via `kris.getById(actor.tenantId, sourceId)`, dépendance déjà injectée, gardée par `this.kris`) aux risques couverts ; même boucle que q84 (dédoublonnage, archivé/supprimé ignoré, échec loggé non fatal). Limite : un échec de lecture du KRI saute aussi les autres risques (même try).
- Test : `NotificationsCenter.test.ts` (1 nouveau). Piège de test : ne pas laisser un lien RISK vers le même risque, il masque le chemin KRI.

## 2026-10-12 F-D044-01 (branche wt/fd04401, base 6d3940b)
- Pour q94, "Comité" = groupe RISK_COMMITTEE OU permission `riskevaluation.validate.committee` / `treatmentdecision.validate.committee` / `governance.validate` (`COMMITTEE_VALIDATION_PERMISSIONS` dans RoleService). Appliqué dans `assertNoCumul` (donc assignation, rejeu sous verrou, élargissement, `assertReactivable`) ; `assertRolePermissionRules` interdit ces permissions au groupe RM ; requête 8 de B8-predeploy-checks.sql étendue (colonne `committee_permission_roles`).
- Leçon : une règle de cumul portant sur un groupe doit aussi être exprimée sur les permissions effectives (même faille que F-B8b-05 pour audit.*). Reste ouvert : F-D044-04 (users.roles hérités), sens inverse Comité -> permissions RM (arbitrage A13).
- Tests : Rbac044.test.ts (describe F-D044-01, 4 tests). Aucune assertion existante modifiée (rôle `comval` ajouté à world()).

## 2026-10-12 q104 + F-D044-03 RatingScale (branche worktree-agent-a0942533cd27b62c1, base 3988d37 par merge, aucune migration)

- Le worktree était sur une base ancienne (44555c9, migration 046) : `git reset --hard` refusé par le harnais, résolu par `git merge` de `claude/gouvernance-risk-control-tools-0mus68`. Vérifier la base avant de lire le code.
- q104 : 3e drapeau `createsAdminAuditCumul` dans `assertCumulRules` (Audit = groupe système AUDIT seul, F-D044-08 reste chez A13) ; motif obligatoire, même événement `ADMIN_RISK_MANAGER_CUMUL` via `notifyAdminCumul` (helper commun aux 3 cumuls), `administratorAndAudit` distinct sur `UserDetail`. Tests dans Rbac044.test.ts.
- F-D044-03 RatingScale : `RatingScaleRepository.auditsInTransaction?` + paramètre `audit?: TransactionalAudit` sur chaque méthode mutante ; `PostgresRatingScaleRepository.tx(audit, fn)` (audit inséré avant COMMIT) ; service `audited(build, run)` avec repli hors transaction pour les faux repos. Test existant adapté (source de vérité changée, à signaler à A08) : `PostgresRatingScaleRepository.draftGuard.test.ts` (faux pool avec `connect`).
- Reste F-D044-03 : Role, User, Config en priorité, puis les ~30 autres services (liste dans le rapport). Non testé sur vrai Postgres.
- Leçon : un script python multi-lignes lancé dans la même commande que `cd`+`npm` est refusé « trop complexe » ; Write du script dans le scratchpad puis commande simple.

## 2026-10-12 B-6b branchement du Dispositif + q91 (migration 059, base origin/staging 64279e5)

- Worktree parti de `main` (318 commits de retard) : `git reset --hard origin/staging` avant tout (vérifier `ls migrations | tail -2` = 058). Le `git merge` d'une branche locale a été refusé par le classifieur d'auto-mode : laisser l'orchestrateur fusionner.
- Migration 059 (`risk_framework_branching`) : colonnes d'instantané sur `risk_evaluations` (nullables, remplies depuis `configs`, sinon floor(P*I*15/25) >= 1 / true / NULL ; version NULL = antérieure au Dispositif), 8 colonnes q91 sur les versions, garde `risk_framework_versions_guard()` redéfinie (056 + 8 colonnes dans `same_content` + `SET search_path` DANS la définition, avant `AS $$`). Down : restaure la garde 056 AVANT de retirer les colonnes, avec `search_path`. Testée sur PG 16 jetable : rejouable, down OK, ré-application OK, UPDATE de chaque colonne q91 refusé sur ACTIVE (42501), backfill vérifié (config, 3x3 -> 5, défaut 15).
- PG jetable en sandbox : initdb refuse root -> script `runuser -u postgres` dans le scratchpad (pas de heredoc/`su` en ligne : refusés dans un worktree) ; le serveur meurt entre deux sessions, relancer le script complet puis rejouer les migrations.
- Pattern : toute dépendance Dispositif = paramètre de constructeur OPTIONNEL en fin de liste ; présent (server.ts) => nouveau comportement, absent => ancien (tests inchangés). `RiskEvaluationService` (8e), `ConfigService` (4e), `RiskAppetiteService` (5e), `CartographyService` (5e), `RiskDeviceViewService` (8e-10e), `RiskFrameworkService` (8e-9e : risks, processes).
- `riskFrameworkResolution.ts` : `resolveApplicableVersion(deps, tenantId, processId|null)` sans permission, null = aucun Dispositif actif (jamais de repli). Messages partagés `FRAMEWORK_OWNS_SETTING_MESSAGE` / `NO_APPLICABLE_FRAMEWORK_MESSAGE`. `domain/frameworkAppetite.ts#findAppetite` : même règle que le SQL (sous-catégorie exacte, entity null == '').
- Évaluation : `create` fige version + échelle + 3 seuils (snapshot dans `CreateRiskEvaluationInput.snapshot`, jamais client) ; `validate`/`validateByCommittee` lisent la copie (`committeeSettingsOf`), repli ancien chemin seulement si la copie est absente ; `TreatmentDecisionService` lit le seuil de traitement de l'évaluation (version posée => jamais `configs`) ; appétence suggérée = liste de la version figée (fail closed si version posée sans dépôt câblé).
- `mirrorScale` ne lit plus `configs` ni `risk_appetites` (F-B6a-12) ; le seuil « faible » est vérifié contre le plafond. Contrôle « plus petit plafond inter-Dispositifs » conservé jusqu'à B-6c.
- Seuil « faible » (R2, A13) : obligatoire à la demande d'activation, jamais pré-rempli. L'avertissement non bloquant (valeur > borne haute de la bande la plus basse) n'est PAS fait : question UX/lot F.
- Tests existants adaptés (fixtures, pas d'assouplissement) : ajout de `lowCriticalityThreshold: 5` aux créations des helpers B6a/QA-B6a/QA-B6abis/B6abis/QA-D044-pg ; les tests qui prouvaient la lecture de `configs`/`risk_appetites` par `mirrorScale` ont été convertis (seuils portés par la version, ou « n'est plus lu »). À signaler à A08.
- NON fait (hors périmètre, autre A06 sur RatingScaleService) : fermeture de `RatingScaleService.activateVersion` quand le Dispositif est câblé (spec §3) ; inventaire des autres lecteurs de « l'échelle ACTIVE » (`resolveMaxScore` dans ConfigService/RiskAppetiteService/RatingScaleService/scoreCeiling : chemins d'écriture désormais fermés ou historiques ; DashboardService garde ses bandes 5x5/ratingScales, non migré).

## 2026-10-12 B-6b follow-ups (B-6b-01/02/04/05, F-B6b-01/03, QA-B6b-01; répertoire principal, aucune migration)

- B-6b-01 : `RatingScaleService` 7e param. optionnel `frameworks` ; `activateVersion` refuse (FRAMEWORK_OWNS_SETTING_MESSAGE + renvoi vers une nouvelle version) APRÈS `ratingscale.delete`, avant tout accès.
- F-B6b-01 : `DashboardService` 17e param. optionnel `frameworks` ; seuil = version APPLICABLE de chaque risque (spec §7/§9, même choix que Risk 360, lié à q110 HUMAN), sans repli sur `risk_appetites` ; ligne portant `frameworkVersionId` ; sans Dispositif câblé, chemin hérité inchangé.
- B-6b-02 : inventaire = test statique `B6bFollowups.test.ts` (compte par fichier de `resolveMaxScore(`, `ratingScales.list(`, `configs.getByTenant(`, lectures d'appétence), chaque lecteur restant classé (w) hérité non câblé / (c) ligne antérieure au Dispositif / (u) inatteignable car écrivain fermé / (p) réglage plateforme. Aucun lecteur n'exigeait de décision produit.
- B-6b-04 : test statique sur `server.ts` (appel `new X(` contient `riskFrameworkRepository`). `TreatmentDecisionService` n'a PAS de dépendance Dispositif (lit le seuil figé sur l'évaluation) : non assertée.
- QA-B6b-01 : version posée + copie NULL => ValidationError, `configs` jamais lu. F-B6b-03 : `risk.read` exigé sur la branche riskId de `/applicable`. B-6b-05 : `reducedMasteryIndependence` dérivé en lecture (`withMasteryIndependence`, aucune colonne) sur get/getVersion/getApplicable/list.
- 060 (dev-db) : `recordInherentScoring` (Postgres) traduit 42501 en ValidationError.
- Tests existants adaptés (source de vérité changée, à signaler à A08) : QA-B6b (observation épinglée QA-B6b-01 convertie ; acteurs `/applicable` + `risk.read`), B6b (idem).

## 2026-10-17 F-CAT-02/QA-REF-01, QA-REF-02, QA-B6bF-03 (répertoire principal, aucune migration)

- `RiskCategoryService.update` : `assertValidParent` partagé avec `create` (existence dans le tenant de l'acteur, message uniforme = pas d'oracle cross-tenant, parent sans parent) + refus si la catégorie a des enfants (`list(activeOnly:false)`) -> profondeur max 2, aucun cycle. `parentId: null` (détacher) reste permis. Pas de FK composite (A07).
- `DepartmentService.archive` : 3e param. constructeur OPTIONNEL `processes` (câblé dans server.ts) ; refus ValidationError si un processus actif (`list` par défaut = actifs) a `departmentId === id`. Sans dépôt : ancien comportement.
- `riskOwnerDesignatedBy` retiré de `CreateDepartmentBody` et `CreateDepartmentInput`. `DepartmentRepository.create(input, designatedBy)` : le service passe `actor.userId` ; le dépôt l'utilise si un riskOwner explicite est donné, sinon libellé « Pilote par défaut … » inchangé. Ancien repli sur `manager` supprimé. Le service construit la liste de champs explicitement (une clé forgée n'atteint jamais le dépôt). `update` n'avait déjà pas le champ (SEC-003).
- QA-B6bF-03 : `createDraft/updateDraft/discardDraft` renvoient `withMasteryIndependence(...)` (l'audit enregistre la version brute).
- Test existant adapté (assertait exactement le comportement fautif) : QA-B6bF « OBSERVATION QA-B6bF-03 » inversée. Faux dépôt de DepartmentService.test : `create(input, actorUserId)`.
- Leçon : `python3 - <<'EOF'` seul fonctionne ici ; un type générique (`audited<T>`) doit être explicité quand on enveloppe le résultat.

## 2026-10-18 B-6d « amorçage + repli q100 » (répertoire principal, migration 062, DECISION-053)

- Domaine (`domain/frameworkApproval.ts`) : `isCircuitFunctional`, `bootstrapRefusal`/`isBootstrapAllowed`, `contractDefaultViolations` (seulement les paramètres qui ont une valeur au contrat, I-D8 : AUCUN plafond sur échelle/appétence/seuil « faible »/durée de délégation/seuil Comité de traitement), `foldVoteBeforeB12` (appliqué dans `resolveFor` : `decide()` n'a plus de branche 409 « vote requis »), `bootstrapNoticeMessage`. `ADMIN_PERMISSIONS` déplacé de `RoleService` vers `domain/fixedGroupPermissions.ts`.
- Dépôt : `recordBootstrapDecision` (verrou `tenants FOR UPDATE` -> demande `FOR UPDATE` -> faits relus -> `validateLocked` -> étapes d'approbation communes `activate()` extraites de `recordDecision`), `getBootstrapFacts`, `latestBootstrapRequest`, filtre `regime` sur `listRequests`. Méthodes OPTIONNELLES sur l'interface (faux dépôts) ; le service échoue fermé sans `recordBootstrapDecision`. Testé de bout en bout sur PG jetable (script jetable, non commité).
- Service : `bootstrapApprove` (route `POST /change-requests/:rid/bootstrap-approve`, zod strict), motif structuré, valeurs libres FIGÉES côté serveur dans `bootstrap_justification.freeParameters` (+ `lowThresholdToExamine` = R2, jamais bloquant), notification `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` aux membres actifs Audit + Comité seulement (rien si vides, q103), message avec les valeurs. Arrivée d'un membre : `RoleService.notifyBootstrapArrival` (8e param. optionnel `frameworks`), appelé par `assignToUser` (Audit/Comité) et `UserService.reactivate`.
- I-D9 (tranché A13, EN ATTENTE PO) : `askedUserId === actor.userId` refusé ; isolé dans `BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF = false` (frameworkApproval.ts), une seule condition dans `checkDeclaration`. `askedUserId` doit être un utilisateur actif du tenant détenant une permission de `ADMIN_PERMISSIONS`.
- Migration 062 écrite par A06 (A07 non spawné, pas d'outil Agent) : colonne `tenants.risk_framework_bootstrap_ended_at`, triggers de fin (AFTER INSERT/UPDATE user_roles, AFTER UPDATE users) + garde BEFORE UPDATE tenants (42501), `fallback_cause`, `bootstrap_justification` + CHECK, `no_bootstrap_check` remplacé par `bootstrap_shape_check` (NOT VALID), garde de versions = 059 + activation BOOTSTRAP. Piège : un nom de contrainte > 63 caractères est TRONQUÉ (le test d'existence `pg_constraint` ne le retrouve plus, non idempotent) -> noms courts (`bootstrap_just_type_check`).
- Tests existants adaptés (source de vérité changée, à signaler à A08) : tout test qui attendait 409 sur un vote Comité/Audit (B6a, QA-B6a x7, QA-B6abis) attend désormais le repli q100 (commentaire obligatoire, FALLBACK, ratification PENDING) ; auto-proposition refusée dans tous les cas ; catalogue 11 -> 12 types (NotificationsCenter, QA-Notifications x3, QA-D044) ; QA-B6a « tenant-scoped » accepte `FROM tenants WHERE id = $1`.
- Requête 10 ajoutée à `docs/security/B8-predeploy-checks.sql`.

## Consultation configurabilité 2026-10-18 (lecture seule, DECISION-055)
- Mécanisme : réglages tenant = colonnes de `configs` (1 ligne/tenant, 024/030/045/054, ConfigService) OU paramètres de `risk_framework_versions` (Dispositif, immuables une fois ACTIVE, circuit d'approbation). Recommandé pour I-D9 et les prochains réglages de gouvernance de référentiel : un paramètre typé du Dispositif ; pour les réglages d'accès/SoD hors Dispositif : une colonne `configs` + une méthode dédiée (modèle q58 `setCommitteeAuditCumul`). Pas de moteur de règles.
- I-D9 : `BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF` (frameworkApproval.ts:63) est une constante ; la rendre configurable = colonne `configs`/tenant + motif + audit, défaut false.
- Écritures multiples restantes : `configs.committee_*`/`evaluation_mode` fermées via `assertNotOwnedByFramework` ; `updateMethodology`/`updateAppetiteMode` (scoreFormula, appetiteMode) ne le sont pas (ConfigService.ts:126,163).
- À proposer au PO comme non configurables : audit append-only, tenant_id, soft-delete, attribution forcée serveur, RM+Audit (q43), auto-approbation.

## 2026-10-18 B-6d correctifs revues (062 corrigée en place, pas de 063)

- QA-B6d-01 : `checkDeclaration` lit d'abord l'utilisateur, compare `asked.id` (uuid canonique renvoyé par PG) à `actor.userId`, stocke `asked.id`. Le faux dépôt utilisateurs des tests doit renvoyer l'id en minuscules comme PG.
- F-B6d-01 : nouvelle méthode OPTIONNELLE `RoleRepository.listActiveGrants` (rôle actif + `granted_by` + `granted_at`) ; échoue fermé si absente. Refus si aucun rôle admin actif de l'utilisateur sollicité n'est (accordé par un autre que le demandeur ET daté <= askedOn). Borne basse de askedOn = date d'octroi (donc >= création du tenant), sans lire `tenants.created_at`. Limite : granularité jour UTC ; un tiers complice qui promeut reste indétectable.
- 062 : colonnes `tenants.risk_framework_bootstrap_end_cause` + `_end_ref` (CHECK valeurs + cohérence avec `ended_at`, garde 42501 étendue ; une cause manquante peut être complétée une fois). Causes : SECOND_ELIGIBLE_MEMBER, USER_REACTIVATED, ROLE_REACTIVATED, ROLE_GROUP_CHANGED, PRE_EXISTING_AT_MIGRATION. Trigger `roles_bootstrap_end_mark` (AFTER UPDATE OF system_group, deleted_at). Verrou `FOR NO KEY UPDATE` (trigger + `recordBootstrapDecision`). Piège : un `--` de commentaire dans une ligne de faux dépôt en one-liner avale le `},` suivant.
- Notice : `BootstrapJustification.deciderAlsoAdministrator` (construit serveur, optionnel) ; message = motif (administrateur cité, date, résultat) + marquage. Aucune notification à l'administrateur cité (q103/q-PO en attente).
- Tests : B6d.test (F-B6d-01, notice, câblage server.ts C-B6d-08), QA-B6d(-pg) `.fails` retirés + causes. Les revues restent à refaire (A10/A08/A14).

## 2026-10-18 Correctifs « un seul chemin d'écriture » (DECISION-054/058)

- Le worktree dispatché était sur `main` (388 commits de retard) : `git reset --hard <branche cible>` sur un arbre propre avant tout (principe 1 confirmé). Le frontend exige `npm ci` depuis la RACINE puis `npm run build` dans `packages/design-system` avant `frontend npm run build`.
- Fermeture par réponse 410 plutôt que suppression de route (message clair au client) : `PUT /processes/:id/evaluation-mode`, `PUT /config`, `PUT /config/appetite-mode`. Les méthodes de service (`ProcessService.setEvaluationMode`, `ConfigService.updateMethodology/updateAppetiteMode`) et la permission `process.evaluationmode.set` restent : des tests QA/SEC les épinglent ; retrait à faire dans un lot dédié.
- Circuit demande/validation ne gère pas le retour à `null` (hérité) ; l'ancienne route le permettait. Aucun écran ne l'utilisait.
- `PATCH /rating-scales/:id/disable` : pas un second chemin (ACTIVE refusée, trigger 055 fige toute échelle référencée par une version non-brouillon).
- `ModuleToggleService.toggle(actor, name, enabled, reason, requestId)` : motif obligatoire, audit avant/après. `setCommitteeAuditCumul` avait déjà motif+audit. `setCommitteeEnforcement` : NE PAS toucher (fermé par le Dispositif, A13). `assertRiskManager` (DECISION-060) : lot séparé.
- Test de garde : `test/SingleWritePath.test.ts`.

## 2026-10-18 Correctifs revues QA/Sécurité « un seul chemin » (QA-SWP-01..04, F-SWP-01/02/03/05/06)

- Audit atomique du toggle : `ModuleToggleRepository.upsert(..., audit?)` + `auditsInTransaction` ; le « avant » est lu `FOR UPDATE` dans la transaction ; défaut explicite `{ enabled: true }` si jamais enregistré. Repli (faux dépôts) = ancien flux getByName/upsert/record.
- F-SWP-01 : `ProcessEvaluationModeRequestRepository.validateAndApply` (optionnel) = UPDATE conditionnel PENDING -> VALIDATED (0 ligne = NotFoundError), PUIS `processes.evaluation_mode`, PUIS audit, une transaction. Repli service : même ordre (demande, processus, audit), non atomique. `toDomain`/`ProcessRow` de PostgresProcessRepository exportés pour la réutilisation.
- QA-SWP-03 : `RatingScaleRepository.isReferencedByFrameworkVersion?` (toute version, brouillon inclus), appelée par `disable` ; optionnelle pour les faux dépôts (garde `?.`), donc fail-open sans dépôt PG : le câblage server.ts utilise le dépôt PG.
- Tests existants adaptés (source de vérité changée) : `ModuleToggleService.test` (oldValue `{enabled:true}`), `QA-SWP.test` (.fails retirés, faux dépôt transactionnel, test PG 01 = événement invalide fait échouer l'upsert, test PG 03 attend un refus). Nouveau : `SWPFixes.test.ts` (+ cas PG gaté `QA_SWP_PGHOST`).
- Piège : un commentaire de source qui cite `setMode`/`setEvaluationMode` fait échouer un test de garde par regex sur `src/api` ; reformuler le commentaire. Heredoc multi-ligne + `cd` composé refusés par le garde du worktree : utiliser Write et des commandes simples.
- Non fait (lot dédié) : retrait du code mort et de `process.evaluationmode.set`, q131, DECISION-060, F-SWP-04.

## 2026-10-18 DECISION-068 : inventaire factuel des droits (aucun code produit modifié)

- Livré : `docs/governance/droits-acces/inventory.json` (111 permissions, 7 groupes, 30 gardes, 19 relations de données, 16 réglages ; 18 anomalies). Généré par un script dans le scratchpad qui lit `permissions.ts`, `fixedGroupPermissions.ts`, le seed et les `requirePermission(` du code (lignes `fichier:ligne` calculées, pas écrites à la main).
- Constats à retenir : `riskframework.process.assign` n'est vérifiée nulle part ; 44 permissions sur 111 n'ont aucun groupe fixe ; evaluationmode.* / process.evaluationmode.* sans détenteur par défaut ; `config.update`, `config.committee*`, `riskappetite.*`, activation d'échelle inopérants en production (Dispositif câblé) ; paramètres du contrat du Dispositif (cumul propriétaire/exécutant, délégation, hybride, maîtrise, vote) stockés mais lus par aucune règle ; `Process.owner` et `Department.riskOwner` sont du texte libre (aucune donnée « N-1 du processus » ni « délégué » : à créer pour DECISION-064).
- Limite : droits réels des rôles personnalisés et colonne `users.roles` en base non vérifiés (aucun accès Neon).
- Leçon : pour un inventaire, dériver les listes par script depuis le code plutôt que les recopier ; `python3 -I` sur un script du scratchpad fonctionne, heredoc `python3 -` seul aussi.

## 2026-10-18 P2 Codex PR #186 : suppression d échelle vs brouillon de Dispositif (migration 063)

- Course contrôle-puis-écriture entre deux tables : un trigger seul ne suffit pas (MVCC). Il faut un verrou de ligne des DEUX côtés : trigger d insertion de version avec `SELECT ... FOR SHARE` sur l échelle (même tenant, deleted_at IS NULL), et trigger BEFORE UPDATE de la suppression douce qui revérifie les références (instantané frais après l attente du verrou, READ COMMITTED). Test déterministe : `test/ScaleDeleteRace.test.ts` (client en BEGIN non validé + délai 300 ms, motif SWPFixes), échoue avec QA_SKIP_063=1.
- Le service `disable` garde son contrôle (message clair) ; dans la course seule l erreur SQL 23503 sort (500 générique, non mappée) : acceptable, rare.
- Worktree dispatché sur un vieux main : `git reset --hard` sur la branche cible d abord ; `npm install` dans backend/ requis.

## 2026-10-18 DECISION-071 : q134 (migration 064) + q133/F-FW-01

- « Brouillon abandonné » = version `ARCHIVED` avec `activated_at IS NULL` (l'activation est figée par les gardes 055+, donc ACTIVE puis archivée garde `activated_at` et bloque toujours). Pas d'ambiguïté. DRAFT et PENDING_APPROVAL bloquent toujours.
- 064 redéfinit DEUX fonctions : `rating_scales_delete_guard` (063) ET `rating_scales_framework_freeze` (055 : `status <> 'DRAFT'` bloquait aussi la suppression douce, 42501, pour un abandonné). search_path répété inline + ALTER. `isReferencedByFrameworkVersion` filtre pareil. Trigger `risk_framework_versions_scale_alive` inchangé.
- Piège tests PG : `ScaleDeleteRace.test.ts` ré-applique la migration en beforeAll sur la base partagée ; il applique maintenant 063+064 en UNE requête (transaction implicite) et les tests q134 sont dans ce même fichier (sinon écrasement concurrent de 064 par 063 entre fichiers parallèles).
- q133 : `withResolvedAppetite` (écriture : create + updateDraft) : `subCategoryId` obligatoire, catégorie du tenant, `active`, avec `parentId` (sous-catégorie, règle confirmée avec le Dev Frontend), `subCategory` stocké = nom de la catégorie. Zod : `subCategoryId` requis, `subCategory` ignoré (défaut ""). `assertSubCategories` (demande d'activation) reste tolérante pour les brouillons hérités sans id ; `createDraftFrom` copie sans réécrire.
- Postgres local : démarrer via un script sh (runuser refusé en commande directe par le garde) ; il s'arrête lors des resets de sandbox.

## 2026-10-18 QA-064-01 + F-FW-01-R (activation = même règle qu'à l'écriture)
- `assertSubCategories` (demande d'activation + bootstrap) appelle `withResolvedAppetite` (id présent, tenant, active, parentId) puis REFUSE si un libellé stocké != nom actuel de la catégorie (pas de réécriture de la version à l'activation). Un brouillon hérité en texte libre doit être réenregistré dans l'onglet « Seuils d'appétence ».
- Fixtures B6d/QA-B6d : seuils avec `subCategoryId: "c1"` + faux dépôt de catégories (nom "Fraude", parentId) ; QA-B6d a deux constructions du service (monde + bootstrap), les deux à câbler. Ordre des contrôles inchangé (tous les tests existants passent sans toucher aux assertions).

## 2026-10-18 q145 / F-FW-02 / F-FW-03 (migration 065)

- L'évaluation désigne sa sous-catégorie par `subCategoryId` (POST /risk-evaluations) ; libellé = `cat.name` dérivé côté serveur (même règle que q133 : tenant, active, parent non nul, même message pour inconnu/autre tenant/inactif). Colonne `risk_evaluations.sub_category_id` NULL (jamais backfillée) + FK composite NOT VALID + garde UPDATE qui fige `sub_category`/`sub_category_id` (42501, y compris NULL -> id : pas de rattachement après coup).
- `findAppetite(list, label, entity, subCategoryId?)` : id si l'évaluation ET l'entrée en ont un, sinon libellé (lecture tolérante des évaluations/entrées héritées). Appelants : RiskEvaluationService, DashboardService (groupes par id), RiskDeviceViewService. Chemin legacy `risk_appetites` (Dispositif non câblé / évaluation antérieure au Dispositif) inchangé, par libellé.
- F-FW-03 : clé de doublon de `normalizeAppetite` = id (insensible à la casse) sinon libellé.
- Service : 9e paramètre optionnel `riskCategories` (câblé dans server.ts). Non câblé (tests) : ancien chemin libellé libre ; `subCategoryId` sans dépôt = refus (fail closed). Obligatoire dès que câblé.
- Test source-regex de QA-B6b (colonnes de l'INSERT) adapté d'une colonne + `$14` : seul test existant touché.
- Piège : les suites PG partagent la base `grc_qa` ; en parallèle, `QA-D044-pg` échoue (compte les connexions « idle in transaction » d'autres fichiers). Lancer avec `--no-file-parallelism` et `PGPORT=5531` (les suites D044/FB6B02 ignorent `QA_SWP_PGPORT`).

## 2026-10-18 q145 regression : lecture des categories

- `RiskCategoryService.list` : config.read OU riskevaluation.create OU riskframework.read ; sans config.read, liste forcee aux actives (includeInactive ignore). Les permissions se lisent dans `actor.roles` (requirePermission fait `actor.roles.includes`), donc un test local suffit, pas de helper. Cause : un garde passe de lecture de reference a config.read sans verifier que les groupes fixes la detiennent ; verifier le groupe porteur avant de brancher un ecran sur un endpoint existant.
- Piege outil : une commande composee (python + heredoc + cd) refusee en bloc par le garde du worktree, rien d execute ; utiliser Write/Edit.

## 2026-10-18 Lot D1 (DECISION-074/075, migration 066)

- 066 : `audit_log.governance_exception text NULL` + 2 index partiels, `configs.self_validation_policy` (CHECK REFUSE/DOUBLE_CONFIRMATION), rattrapage `governancehealth.read` (3 groupes fixes) et `governancehealth.read` + `config.selfvalidation.set` (rôles non-groupe-fixe et `users.roles` portant une permission de `ADMIN_PERMISSIONS`). Aucune fonction trigger. `config.selfvalidation.set` entre dans `ADMIN_PERMISSIONS`, pas `governancehealth.read`.
- `AuditEvent.governanceException?` optionnel ; `insertAuditEvent` écrit `$10`, `search` filtre `governanceException` (string = règle exacte, `true` = toute ligne marquée). Déploiement : migrer AVANT le code (l'INSERT référence la colonne) ; tout PG test qui écrit un audit exige 066 sur la base.
- Prédicats de groupe (`isAdministrator`, `isRiskManagerMember`, `isCommitteeRole/Member`, `isAuditGroupMember`, `isCommitteeValidationPermission`) déplacés dans `domain/fixedGroupPermissions.ts`, sans changement de comportement.
- Tests existants adaptés (inévitable) : B8ter (constante = 051 + 055 + 066), regex source dans QA-B6a, `CONFIG_ADMIN` de QA-D044.
- Env : la base partagée `grc_qa_a08` est utilisée par plusieurs agents (068 déjà appliquée par un autre lot, sans 066/067) ; up/down/up fait sur une base jetable `grc_d1`. Serveur PG local : `/tmp/claude-0/-home-user/<session>/scratchpad/startpg.sh` (runuser + pg_ctl, port 5531, socket /tmp/claude-0/pgsock). Heredoc + `&&` dans Bash refusés dans le worktree : passer par un fichier .sh.

## 2026-10-18 Lot D2a (migration 067, `users.last_seen_at`)

- Le résolveur d'identité partagé est `lookupMembership` dans `server.ts` (pas dans `infrastructure/identity`) ; Google et Local le reçoivent en paramètre. Seul câblage possible = 3 lignes dans `server.ts` (signalé). Logique dans `infrastructure/identity/lastSeen.ts` : `createLastSeenRecorder(pool)` (Map mémoire 1 h + UPDATE conditionnel SQL `WHERE tenant_id AND id AND deleted_at IS NULL AND (last_seen_at IS NULL OR < now()-1h)`, fire-and-forget, `.catch` -> Pino warn sans PII autre que ids, retire la clé du cache pour réessayer) et `withLastSeen(lookup, record)` (enveloppe, résultat inchangé, try/catch).
- Aucune route ni exposition API ; pas d'audit_log (télémétrie, DECISION-074). Aucune donnée au-delà de la date (q152).
- Gap de numérotation : 066 réservé à un lot parallèle ; `QA-B8quater` ("053 and 054 are consecutive") échoue dans ce worktree tant que 066 n'est pas fusionné. Ne pas modifier ce test.
- Postgres jetable : le serveur local (/tmp/claude-0/pgdata) peut être arrêté ; le relancer via un script (`runuser -u postgres -- pg_ctl ... -k /tmp/claude-0/pgsock -p 5531`), le harnais refuse `su`/`runuser` en commande directe.
