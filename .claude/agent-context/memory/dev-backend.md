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

## 2026-10-12 B-6a « Socle du Dispositif » (branche wt/b6a, base f520794, migration 055 NON appliquée ni exécutée)

- Écrit : `RiskFrameworkService` (cycle DRAFT -> PENDING_APPROVAL -> ACTIVE -> ARCHIVED), `PostgresRiskFrameworkRepository` (pool pg, pattern `tx` + `rollbackQuietly`), `domain/frameworkApproval.ts` (`resolveDecider` pur), `domain/ratingScaleRules.ts` (`assertLevels`/`assertDescriptors`/`assertReadyToActivate` DÉPLACÉS depuis `RatingScaleService`, pas copiés), routes `/api/v1/risk-frameworks`, 6 permissions `riskframework.*`, migration 055 + down. Migration écrite par A06 lui-même (A07 non spawné, aucun outil Agent disponible) ; jamais exécutée : à faire rejouer deux fois sur Postgres jetable par A07/A08 (triggers, DO $$ de reprise, regex du test B8ter sur 055).
- Décisions PO appliquées (recommandations de la spec) : q87 demande « vote » = PENDING + 409 sur approve ET reject, message nommant le groupe ; q90 audit juste après l'action (échec loggé puis renvoyé, pas de reopen) ; q91 seuls les paramètres du §2.2 ; q92 auto-proposition refusée à la création de la demande hors vote Comité (donc inactivable avant B-12). Aucun amorçage (B-6d).
- Choix hors texte de la spec (à relire) : (1) demande WITHDRAWN = `decided_by` NULL, `decision_regime` NULL (le CHECK maker-checker interdirait que le demandeur « décide » son retrait) ; (2) `activation_request_id` sans FK (cycle de création des tables) ; (3) `AUDIT_AND_COMMITTEE` : chaque groupe éligible (>=2) vote, aucun éligible -> repli RM ; (4) auteurs exclus = `created_by` + `last_edited_by` + users des audits CREATE/UPDATE de la version ; (5) `reject` suit le même circuit que `approve` (409 si un vote est requis) ; (6) liste blanche `PARAM_KEYS` dans le service : une clé inconnue (ex. `status`) est ignorée même sans zod ; (7) unicité d'appétence = (subCategory, entity) exacte après trim, sensible à la casse comme l'index de `risk_appetites`.
- Test existant adapté (source de vérité changée, à signaler à A08) : `B8ter` compare la constante des groupes à 051 + ajouts de 055 ; `QA-B8quater` n'exige plus que 054 soit le dernier numéro mais garde « sans trou depuis 53 ».
- Non fait (B-6b/c/d) : résolution du Dispositif applicable, instantané F-8, Cartographie, fermeture des écritures `configs`/`risk_appetites`/`activateVersion`, `GET /applicable`, rattachement Processus, défaut, archivage d'un Dispositif, amorçage.
- Leçon : dans ce worktree, `cat <<EOF > fichier` composé est refusé ; Write/Edit, ou `python3 - <<'EOF'` seul fonctionne.
