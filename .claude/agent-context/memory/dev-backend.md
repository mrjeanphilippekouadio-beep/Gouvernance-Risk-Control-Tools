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
