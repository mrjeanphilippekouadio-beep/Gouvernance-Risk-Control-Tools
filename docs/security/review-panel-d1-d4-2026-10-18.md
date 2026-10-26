# Revue sécurité A10 — panel de gouvernance, lots D1 à D4 (2026-10-18)

- **Escalade HUMAN : aucune.** Aucun finding n'atteint CVSS 7. Le score le plus élevé est 4,3 (SEC-PNL-01, MEDIUM).
- Périmètre : `git diff 84d64b2..037314d -- backend database` (21 commits). Lots couverts : D1 (066), D2a (067 `last_seen_at`), D2d (068), D2b (069), D4 (auto-validation et double confirmation, sans migration), D2c (070, désignations et passation du dernier Risk Manager), D3 (071, profil d'organisation).
- Méthode : revue statique de tout le diff. PoC avec les **vrais services et repositories** sur un PostgreSQL 16 jetable (`/tmp/a10_pnl`, port 5541, migrations 001 à 071 appliquées, attaques SQL sous `grc_app_runtime`). Suite vitest : 2170 tests verts, 127 ignorés. Suites `-pg` D2c, D3, D4 et D2d sur la base jetable : 18 tests verts, 5 ignorés.
- **Verdict global : PASS avec réserves.** Feu vert pour staging. SEC-PNL-01 doit être corrigé avant la production. Les points 1 et 2 de D3 et le point 1 de D2c restent des décisions à prendre par HUMAN, avec les recommandations ci-dessous.

## Synthèse des findings

| ID | Sévérité | CVSS 3.1 | Confiance | Titre | Porteur |
|---|---|---|---|---|---|
| SEC-PNL-01 | MEDIUM | 4,3 | CONFIRMED (PoC) | Une auto-validation peut être appliquée sans aucune trace ni marqueur : un octet NUL dans `governanceConfirmation.reason` fait échouer l'audit, qui est écrit hors transaction, et l'objet s'affiche alors « INDEPENDENT ». La même chose vaut pour le motif de `PUT /config/self-validation-policy` | A06 |
| SEC-PNL-02 | LOW | 2,6 | CONFIRMED (code) | `orgprofile.approve` est accordé au groupe Audit et ajouté à la liste blanche `isAuditGroupPermission` : l'Audit décide alors d'une baisse des exigences qu'il contrôlera ensuite | HUMAN, A13, A14, puis A06 |
| SEC-PNL-03 | LOW | 2,7 | CONFIRMED (PoC) | Une baisse de taille *déclarée* est masquée par les faits observés : elle s'applique sans seconde confirmation ni marqueur, puis prend effet quand les comptes changent | A06 |
| SEC-PNL-04 | LOW | 2,7 | CONFIRMED (code) | Un administrateur seul peut fabriquer « aucun tiers » : départ du dernier RM avec `confirmEmptyGroup`, retraits Audit et Comité. Cela ouvre `orgprofile.adminAlone` et la double confirmation. Tout est tracé, mais aucune notification n'est émise | A06, HUMAN (q149) |
| SEC-PNL-05 | LOW | 2,2 | CONFIRMED (code) | La politique d'auto-validation est assouplie par un administrateur seul, même quand un tiers existe (pas de circuit à deux personnes) | HUMAN, A14, puis A06 |
| SEC-PNL-06 | LOW | 2,2 | CONFIRMED (SQL runtime) | Gardes en base incomplètes. Un profil peut être inséré directement ACTIVE et CONFIRMED par un tiers forgé, y compris d'un autre tenant. Sur `governance_designations` : aucune immuabilité, DELETE accordé, FK inter-tenant. Le runtime peut déclarer le régime « une personne » | A07 |
| SEC-PNL-I01…I11 | INFO | — | — | Voir la section INFO | divers |

---

## Verdicts sur les 7 points demandés

### Point 1 — D3 : `orgprofile.approve` au groupe Audit. **Verdict : NON compatible avec « l'Audit ne décide jamais » (SEC-PNL-02).**

Ce qu'on observe :
- Le groupe AUDIT reçoit `orgprofile.approve` dans `FIXED_GROUP_PERMISSIONS` et dans la migration 071 (l. 120-122).
- `isAuditGroupPermission` accepte désormais `orgprofile.approve` (`fixedGroupPermissions.ts` l. 55). C'est la liste blanche « lecture seule » qui ferme F-B8b-01.
- `approve()` ne se limite pas à un avis : elle fait passer la version PENDING en ACTIVE et remplace l'ancienne. C'est une décision de gestion, qui abaisse les niveaux d'exigence (q136) appliqués à toute l'organisation.

Pourquoi c'est un problème :
- L'Audit approuve une baisse du référentiel d'exigences qu'il utilisera ensuite pour juger la gouvernance. C'est une menace d'auto-révision (indépendance de l'audit interne). Elle contredit q42 et la position F-B8b-01.
- Le précédent `rolegroup.audit.validate` était une exception étroite, qui portait sur les droits du groupe Audit lui-même. Ce n'est pas une raison pour élargir la liste blanche à une décision métier. Chaque exception ajoutée à `isAuditGroupPermission` affaiblit le garde-fou : la règle « `.read` / `.download` seulement » devient une liste à maintenir.

Alternative recommandée (la plus simple) :
1. Retirer `orgprofile.approve` du groupe AUDIT (constante + migration de rattrapage) et le retirer de `isAuditGroupPermission`.
2. Retirer aussi l'Audit du décompte des tiers (`countOtherGovernanceMembers` : RM + Comité seulement). Sinon, un tenant dont le seul tiers est l'Audit resterait bloqué en PENDING sans personne pour approuver.
3. En compensation, l'Audit **voit** et **revoit** sans décider : notification obligatoire aux membres Audit à chaque baisse (PENDING ou ALONE), et revue a posteriori par `governanceexception.review` (D5), qui est un constat et non une décision.

Si HUMAN maintient l'attribution, le consigner au Decision Log comme exception explicite à q42, et garder le test de garde `isAuditGroupPermission` avec cette seule entrée nommée.

CVSS 3.1 : AV:N/AC:H/PR:L/UI:R/S:U/C:N/I:L/A:N = **2,6**. Il faut un soumetteur tiers. L'Audit seul ne peut rien soumettre.

### Point 2 — D3 : une baisse sans tiers s'applique avec `orgprofile.adminAlone`. **Verdict : contournable de deux façons. L'une est tracée (SEC-PNL-04), l'autre ne laisse aucun marqueur (SEC-PNL-03).**

a) **Fabriquer l'absence de tiers (tracé).** `countOtherGovernanceMembers` ne lit que l'état courant : membres actifs RM, Audit et Comité autres que le soumetteur. Un administrateur (`role.assign`, `user.delete`) peut :
   - retirer les rôles Audit et Comité des autres (le maker-checker n'interdit que soi-même) ;
   - depuis D2c, retirer le **dernier RM** avec `confirmEmptyGroup: true`. Avant D2c, c'était impossible ;
   - soumettre la baisse (ALONE + marqueur), puis tout réattribuer.

   Chaque étape est auditée (`ROLE_CHANGE`, `riskManager.vacancy`, `orgprofile.adminAlone`), mais aucune notification n'est émise vers les tiers retirés. La notification q144 à l'arrivée d'un membre Audit ou Comité (R-6.3) compensera quand D5 sera livré. Détails dans SEC-PNL-04.

b) **Masquer la baisse derrière l'observé (sans marqueur) — SEC-PNL-03.** `submit()` mesure la baisse avec `classifyOrganization(answers, observed)`. Le résultat vaut « le plus exigeant de déclaré et observé », donc tant que l'observé tient la taille, une baisse des réponses *déclarées* n'est pas une baisse. Elle passe ACTIVE, sans PENDING ni marqueur. Quand l'observé baisse ensuite (départ, retrait de rôle), la taille tombe sur une déclaration que personne n'a confirmée.

PoC (vrai `OrganizationProfileService`, repository factice, `poc_mask.mts`) :
```
observé : 120 comptes, 2 RM, 1 Audit ; tiers existants = 3
v1 = {Q1:120, Q2:2, Q5:YES, Q7:YES, Q8:NO, Q11:YES}  -> GRANDE_ENTREPRISE
v2 = {Q1:120, Q2:1, Q5:NO,  Q7:YES, Q8:NO, Q11:YES}  -> statut ACTIVE, marqueur null
taille sur le seul déclaré v1 -> v2 : GRANDE_ENTREPRISE -> PME
après départ d'un RM et de l'auditeur : taille = PME (aucune seconde confirmation)
```

Correctif SEC-PNL-03 : il y a baisse si le rang baisse **soit** sur `classify(answers, observed)`, **soit** sur `classify(answers, ZERO_OBSERVED)` (déclaré seul). Test de régression : le scénario ci-dessus doit donner PENDING, ou ALONE avec marqueur.

CVSS SEC-PNL-03 : AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N = **2,7**.

### Point 3 — D2c : `designation.manage` dans `ADMIN_PERMISSIONS`. **Verdict : pas d'escalade nouvelle. Le maker-checker est respecté. Réserve sur la vacance (SEC-PNL-04).**

- Avant D2c, un administrateur `role.assign` pouvait déjà attribuer le rôle RM à n'importe qui (q63 : motif + notification du cumul), puis retirer l'ancien RM, qui n'était plus le dernier. Désigner un intérimaire puis retirer le RM aboutit au **même état final** : aucun nouveau pouvoir.
- L'attribution est forcée côté serveur. `designatedBy`, `endedBy` et `grantedBy` valent `actor.userId`. Le corps n'est pas strict, mais les champs inconnus sont retirés et ne sont jamais lus.
- Personne ne se désigne soi-même : service (`actor.userId === userId`, ids canonisés par le middleware puis par `canonicalId`) et CHECK `designated_by <> user_id`.
- À la passation, l'intérimaire ne peut pas être l'acteur (`usableInterim`). Les règles de cumul (RM + Audit interdit, q94, cumul admin) sont **rejouées sous verrou** par `assertCumulRules`. Le cumul admin + RM est notifié comme un `assignToUser`.
- Ce que D2c ajoute vraiment : la **vacance** (groupe RM vide), décidée par un seul administrateur avec un booléen. C'est le levier du point 2a (SEC-PNL-04).

### Point 4 — D2c : passation, `riskManager.vacancy`, suspension. **Verdict : PASS sur la passation. Réserves INFO sur la vacance.**

- **Transaction de passation** (`PostgresRoleRepository.handOverLastRiskManager`) :
  - ordre des verrous `users` (les deux comptes, `ORDER BY id`), puis `roles`, puis `tenants FOR NO KEY UPDATE`, puis la désignation `FOR UPDATE`. C'est cohérent avec `assignToUser`/`update` (users → roles), `suspend` (users en tête, F-EVD2b-01) et les triggers 062 et 068 (tenants en NO KEY UPDATE). `GovernanceDesignationService.end` ne verrouille que la désignation. Aucun cycle trouvé ;
  - revérification sous verrou : intérimaire actif, désignation encore utilisable (`ended_at`, `activated_at`, `valid_until > now()`), le partant reste le seul membre actif (sinon 409 et retour au chemin ordinaire), cumuls rejoués ;
  - **retrait avant attribution**, donc le trigger 062 ne voit jamais 2 RM et ne clôt pas l'amorçage à tort ;
  - contrôle « exactement 1 membre » avant COMMIT, audit des deux `ROLE_CHANGE` dans la transaction ;
  - les suites `D2c-pg` sont vertes sur la base jetable.
- **`riskManager.vacancy`** : le marqueur est écrit dans la transaction du retrait (`auditEvents`). C'est bon, et SEC-PNL-01 ne s'applique pas ici. Réserves :
  - la décision « vacance » est prise **sans verrou**. Si un RM est ajouté en même temps, le marqueur dit « groupe vide » à tort. C'est un faux positif, sans danger (I04) ;
  - la « seconde confirmation » de q149 est un booléen envoyé par le **même** administrateur. Si le PO entendait une seconde personne, le circuit n'est pas construit (à trancher avec la ligne « D2c — choix à confirmer ») ;
  - aucune notification n'est émise (Audit, Comité, administrateurs).
- **Suspension du dernier RM non couverte par la passation** : la suspension reste refusée (garde B-8 dans `suspend`), ce qui échoue fermé. Pour faire partir le dernier RM, l'administrateur retire d'abord le rôle (passation ou vacance), puis suspend. Acceptable du point de vue sécurité.
- **Intérimaire périmé** (`valid_until` dépassé) : il n'est pas utilisé et on tombe sur la vacance avec confirmation, ce qui échoue fermé. En revanche, `valid_until` n'a pas de borne haute (9999 accepté) : la « date de fin obligatoire » est symbolique (I05).

### Point 5 — D4 : `governanceConfirmation`, politique, services hors gate. **Verdict : la règle n'est pas contournable par le corps de la requête. Elle l'est par la trace (SEC-PNL-01). Politique modifiable par l'admin seul : SEC-PNL-05. Services hors gate : PASS.**

- **Le corps est-il falsifiable ?** Les deux conditions qui comptent sont décidées par le serveur : `policy` est relue dans `configs` pour le tenant de l'acteur, et `otherValidatorExists` vient de `existsOther`. `governanceConfirmation` n'est qu'une déclaration d'intention de l'acteur lui-même. Le fournir dès la première requête, sans attendre le 409, ne contourne rien. `existsOther` prend la même union que le résolveur d'identité (`users.roles` + `user_roles` non révoqués, rôle non supprimé, compte actif), exclut les auteurs (`makerIds`) et ignore la portée par département : il surcompte, donc échoue fermé. Les 9 appels de la gate passent une permission identique au `requirePermission` de la méthode (vérifié un par un).
- **Mais la trace est contournable : SEC-PNL-01.**
- **Politique modifiable par l'admin seul (SEC-PNL-05).** C'est contraire à ma position DECISION-055 : un assouplissement se gouverne comme une attribution de rôle (maker-checker). L'effet reste borné, car la double confirmation n'est ouverte que si personne d'autre ne peut valider. Le marqueur `direct` ou `adminAlone` est posé, sauf dans le cas de SEC-PNL-01.
- **Services laissés hors gate** (rejets, proposition de décision de traitement N+1, `RoleService`, `RiskFrameworkService`, `RiskService`) : ils continuent de **refuser** l'auto-validation comme avant (échec fermé). Ce n'est pas un affaiblissement : PASS.

### Point 6 — D2a : `last_seen_at`. **Verdict : PASS.**

- Pas de DoS en écriture. Un filtre mémoire par processus limite à au plus 1 UPDATE par heure et par utilisateur et par instance, et l'UPDATE est conditionnel (`last_seen_at < now() - 1h`), donc au plus une écriture effective par heure. L'appel ne bloque jamais la requête (`void`, erreur journalisée). Sur `users`, seuls les triggers `AFTER UPDATE OF deleted_at` (062, 068) existent, et cette écriture ne les déclenche pas.
- Pas de fuite : aucune lecture exposée à ce jour (lot D6). Le log d'échec ne contient que `tenantId` et le type d'erreur. Seule la date est stockée (ni IP, ni user-agent).
- La `Map` n'est jamais purgée, mais elle est bornée par le nombre d'utilisateurs authentifiés (I09). Quand D6 exposera la donnée : `user.read` + masquage R-6.1.

### Point 7 — nouvelles routes : tenant, attribution, bornes. **Verdict : PASS, sauf la borne de contenu de `governanceConfirmation.reason` (SEC-PNL-01).**

| Route | Tenant | Attribution | Bornes |
|---|---|---|---|
| `GET/POST /organization-profile`, `/:id/approve`, `/:id/reject` | `actor.tenantId` partout (lecture, verrou consultatif, UPDATE `WHERE tenant_id`) | `submittedBy`/`decidedBy` = acteur ; maker-checker service + CHECK | `.strict()`, réponses bornées (Q1 ≤ MAX_HEADCOUNT…), motif ≤ 500, `z.guid()`, limiteur par utilisateur |
| `GET/POST /governance-designations`, `/:id/end` | idem (`getById(tenant)`, `end WHERE tenant_id`) | `designatedBy`/`endedBy` = acteur | motif ≤ 500, `z.guid()`, liste LIMIT 200 ; corps non strict (champs inconnus retirés), `validUntil` sans borne haute (I05), pas de limiteur (INFO) |
| `GET/PUT /processes/:id/responsibilities` | `WHERE tenant_id` + compte vérifié dans le tenant | aucun `…By` ; pas d'auto-désignation (I-R1) | `.strict()`, `z.guid().nullable().optional()` ; `buildUpdateSet` (omis ≠ null) |
| `PUT /config/self-validation-policy` | tenant de l'acteur | `updatedBy` = acteur | enum + motif ≤ 500 ; **NUL accepté** (SEC-PNL-01 b) |
| `POST /roles/:id/revoke` (`confirmEmptyGroup`) | inchangé | inchangé | booléen |
| `governanceConfirmation` (8 routes de validation) | — | — | `rule` littéral, motif 1..500 ; **NUL accepté** (SEC-PNL-01) |

---

## Findings détaillés

### SEC-PNL-01 — Une auto-validation est appliquée sans trace ni marqueur (NUL dans le motif, audit hors transaction)

- **ASSET / COMPONENT** : piste d'audit, statut q142 `validationIndependence`. `SelfValidationGate` + `ControlExecutionService`, `ControlEffectivenessService`, `RiskEvaluationService` (×2), `TreatmentDecisionService`, `ActionPlanService`, `FindingService`, `GovernanceService`, `ConfigService.setSelfValidationPolicy`.
- **ENDPOINTS** : `PATCH /executions/:id/validate`, `/risk-evaluations/:id/validate` (et committee), treatment decision committee, `/action-plans/:id/close`, `/findings/:id/close`, review cycles close, effectiveness validate ; `PUT /config/self-validation-policy`.
- **PRECONDITION** : politique `DOUBLE_CONFIRMATION` et aucun autre validateur. C'est l'état normal des TPE visées par la fonctionnalité. Variante (b) : administrateur avec `config.selfvalidation.set`.
- **CAUSE RACINE** :
  1. Ces services écrivent l'effet métier (`recordValidation`, `close`…), **puis** appellent `audit.record` **hors transaction** (classe F-D044-03).
  2. `governanceConfirmation.reason` n'est stocké **que** dans l'audit (`newValue.selfValidation.reason`, jsonb).
  3. Le schéma accepte `\u0000`, que PostgreSQL refuse en jsonb (22P05) comme en text (22021).
  4. L'écriture métier réussit, l'audit échoue, le client reçoit un 500 mais la validation est committée. `GovernanceExceptionLookup.forEntities` ne trouve pas de marqueur et renvoie **`INDEPENDENT` par défaut**.
- **OBSERVED** (PoC `poc_nul.mts`, vrais services et repositories, rôle `grc_app_runtime`) :
  ```
  validate(actor=exécutant, governanceConfirmation={rule:"noSelfValidation", reason:"seul\u0000"})
  -> {"outcome":"THROWN 22P05 unsupported Unicode escape sequence","validatedBy":"SELF","validated":true,
      "audits":{"n":0,"marked":0},"independence":"INDEPENDENT"}
  ```
  Variante (b), `poc_nul_cfg.mts` : `setSelfValidationPolicy("DOUBLE_CONFIRMATION", "motif\u0000")` → `THROWN 22021`, politique = `DOUBLE_CONFIRMATION`, 0 ligne d'audit. **Un contrôle est assoupli sans trace.**
- **EXPECTED** : soit tout est refusé, soit l'effet et l'audit marqué sont écrits ensemble.
- **IMPACT** : un acte qui contourne le maker-checker est affiché « Validé » (indépendant). Il est absent du panel D6, des revues D5 et de la notification q144. Répudiation, et q142 est vidé de son sens. `ProcessEvaluationModeRequestService.validate` (audit dans la transaction depuis F-SWP-01), la vacance RM, la passation et D3 ne sont **pas** affectés par construction (audit écrit dans la transaction de l'effet : un échec annule tout ; vérifié en lecture de code, PoC rejoué seulement sur ControlExecution et Config).
- **CVSS 3.1** : AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N = **4,3 MEDIUM**. On tombe à 3,1 si l'on cote la précondition de politique en AC:H. Variante (b) PR:H = 2,7.
- **RECOMMANDATION** (dans l'ordre, la plus simple d'abord) :
  1. `GovernanceConfirmationBody.reason` et le motif de `UpdateSelfValidationPolicyBody` : refuser les caractères de contrôle (`.regex(/^[^\u0000-\u001f\u007f]*$/)` ou `.refine`). Mieux encore, un filtre unique des NUL au parseur JSON (`express.json` avec un `reviver`, ou un middleware qui rejette en 400 tout corps contenant `\u0000`), qui ferme la classe entière ;
  2. pour les 8 services gardés, écrire l'effet et l'audit marqué **dans la même transaction** (modèle q90 / `auditsInTransaction`), au moins quand `selfValidated` est non nul ;
  3. `ConfigService.setSelfValidationPolicy` : même transaction (même correctif que F-SWP-02 pour les toggles).
- **REGRESSION_TEST** : rejouer les deux PoC. On attend un 400, ou bien effet + audit marqué. On ne doit jamais voir « effet sans audit ». Ajouter un test de garde : aucun schéma de motif sans filtre NUL.
- **STATUS** : REMEDIATION_REQUIRED (A06), avant production.

### SEC-PNL-02 — L'Audit approuve une baisse de taille (`orgprofile.approve`)
Voir le point 1. **CVSS 2,6 LOW.** Correctif : retirer la permission du groupe AUDIT et de `isAuditGroupPermission`, retirer l'Audit du décompte des tiers, et ajouter une notification obligatoire à l'Audit. Test : `changeAuditGroupPermissions(["orgprofile.approve"])` → refus ; approbation par un membre Audit seul → 403. STATUS : REVIEW_REQUIRED (HUMAN, A13, A14).

### SEC-PNL-03 — Baisse déclarée masquée par l'observé
Voir le point 2b. **CVSS 2,7 LOW.** STATUS : REMEDIATION_REQUIRED (A06).

### SEC-PNL-04 — Fabrication de l'absence de tiers ; vacance RM décidée par un seul administrateur, sans notification
- Scénario : l'admin A (pas RM) retire les rôles Audit et Comité des autres membres, retire le dernier RM avec `confirmEmptyGroup: true` (motif obligatoire), soumet une baisse de profil (ALONE + `orgprofile.adminAlone`), puis réattribue les rôles (RM : motif + notification de cumul seulement si la cible est admin).
- Effets : `countOtherGovernanceMembers = 0` (D3), `existsGovernanceThirdParty = false` (le marqueur de la politique passe de `direct` à `adminAlone`), et pour les validations détenues par les seuls groupes, `existsOther = false`, donc la double confirmation est ouverte.
- Contrôles existants : chaque étape est auditée et marquée. Il manque la notification des retirés et des tiers.
- **CVSS** AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N = **2,7 LOW**.
- Recos :
  1. notification obligatoire (non désactivable) à tous les administrateurs et aux membres Audit et Comité restants lors d'une vacance RM, et au(x) RM retiré(s) ;
  2. pour D3 et la gate, compter comme tiers tout membre retiré ou suspendu depuis moins de N jours (fenêtre à arbitrer par A13), **ou** exiger que l'acte ALONE soit précédé d'au moins N jours sans tiers. C'est l'option la plus simple et la plus robuste contre le « retirer, agir, remettre » ;
  3. D5 (R-6.3) doit notifier, au retour d'un membre Audit ou Comité, les actes marqués non revus. C'est la compensation déjà prévue.
- STATUS : REVIEW_REQUIRED (HUMAN pour q149 « seconde confirmation » = même personne ?), puis A06.

### SEC-PNL-05 — Assouplissement de la politique d'auto-validation par un administrateur seul
- `setSelfValidationPolicy` ne consulte le tiers que pour choisir le marqueur. Aucun circuit à deux personnes, même quand un RM, un Comité ou un Audit existe.
- **CVSS** AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N = **2,2 LOW**.
- Reco (DECISION-055) : durcir (REFUSE) prend effet immédiatement et ne doit **pas** porter de marqueur d'exception (I07). Assouplir passe en PENDING quand un tiers existe, approuvé par un tiers ≠ demandeur (même mécanisme que D3). Sans tiers, application immédiate avec `adminAlone`.
- STATUS : REVIEW_REQUIRED (ligne « D4 — choix à confirmer », A14), puis A06.

### SEC-PNL-06 — Gardes en base des nouvelles tables (A07)
PoC SQL sous `grc_app_runtime` (`poc_insert.sql`) :
- `organization_profiles` : `INSERT` direct `status='ACTIVE', regime='CONFIRMED', decided_by=<utilisateur d'un AUTRE tenant>` **accepté**. Il n'y a pas de trigger `BEFORE INSERT` : on peut « naître forgé », comme dans les leçons F-B6a-09 et F-B6b-06. Les FK `submitted_by` et `decided_by` sont simples, donc inter-tenant. Le trigger UPDATE/DELETE/TRUNCATE et `REVOKE DELETE` sont corrects, et `search_path` est épinglé sur les deux fonctions.
- `governance_designations` : `user_id` d'un autre tenant accepté. Un `UPDATE` qui remet `activated_at = NULL` et `valid_until = +100 ans` est accepté : on peut ré-armer un intérimaire déjà utilisé. **`DELETE` est accordé et fonctionne**, ce qui contredit le soft delete. Aucun trigger d'immuabilité (`kind`, `user_id`, `designated_by`, `created_at`, `activated_*` set-once, `ended_*` set-once).
- `processes.owner_user_id` / `risk_champion_user_id` / `deputy_user_id` : FK simples, donc inter-tenant au niveau de la base (le service le vérifie).
- `tenants.single_person_regime_declared_at` : le runtime **peut déclarer** le régime (UPDATE accepté), alors que q117 le réserve à l'éditeur hors API. Aucun écrivain applicatif n'existe aujourd'hui.
- `audit_log` : l'UPDATE du marqueur est refusé au runtime (`permission denied`). C'est bon.
- **CVSS 2,2 LOW** (aucun chemin API, SQL direct seulement).
- Recos (migration 072+, `SET search_path = pg_catalog, public, pg_temp` dans chaque définition) :
  - trigger `BEFORE INSERT` sur `organization_profiles` : PENDING, ou ACTIVE avec `regime IN (NULL, 'ALONE')` et `decided_*` NULL ;
  - FK composites `(tenant_id, user)` sur toutes les nouvelles colonnes utilisateur ;
  - `REVOKE DELETE, TRUNCATE` + garde d'immuabilité sur `governance_designations` ;
  - colonne de déclaration de `tenants` réservée à un rôle d'exploitation (trigger qui refuse le changement sous `grc_app_runtime`, ou colonne dans une table sans GRANT runtime).
- STATUS : REMEDIATION_REQUIRED (A07), non bloquant pour staging.

---

## INFO

- **I01** — D3 `approve()` enregistre `reason: null`. R-2 dit « approuve […] ou rejette, motif obligatoire ». Aligner ou corriger la spec (A05).
- **I02** — D3 : le contrôle « PENDING déjà présent » et le calcul « baisse » se font hors du verrou consultatif. Deux soumissions concurrentes peuvent donner PENDING + ACTIVE, et l'approbation remplace alors la version ACTIVE plus récente. Reco : relire PENDING et ACTIVE sous `lockTenant`.
- **I03** — D3 : l'auteur ne peut pas retirer sa version PENDING, et toute nouvelle soumission est bloquée tant qu'un tiers n'a pas statué. Si les groupes perdent `orgprofile.approve`, le profil est gelé (échec fermé).
- **I04** — D2c : vacance décidée sans verrou, donc un marqueur peut être faux positif. Aucune notification (voir SEC-PNL-04).
- **I05** — D2c : `valid_until` sans borne haute ; `end` passe par la même permission `designation.manage`. Acceptable, puisque les deux actions sont réservées à l'admin et que ni l'une ni l'autre n'est une permission générique `*.update`. Option : `designation.end`.
- **I06** — Audit hors transaction dans `GovernanceDesignationService` (create et end) et `ProcessService.setResponsibilities`. Pas exploitable par NUL, car le motif est d'abord stocké en text et la requête échoue avant. Reste la classe F-D044-03.
- **I07** — `setSelfValidationPolicy` pose un marqueur d'exception aussi sur un **durcissement** (REFUSE), ce qui fait du bruit dans le panel. Il appelle aussi `get()`, qui exige `config.read` : un admin qui n'a que `config.selfvalidation.set` reçoit un 403.
- **I08** — `GET /organization-profile` expose les uuid `submittedBy`/`decidedBy` aux porteurs de `orgprofile.read` (Comité, RM) sans `audit.read`. Ce ne sont pas des noms, mais le masquage R-6.1 n'est pas appliqué (A15, à traiter avec D6).
- **I09** — D2a : la `Map` en mémoire n'est jamais purgée (bornée par le nombre d'utilisateurs).
- **I10** — D2c : l'exclusion « intérimaire Audit » ne regarde que `systemGroup` (classe F-D044-08). Les `audit.*` hérités via `users.roles` ne sont pas vus.
- **I11** — 068 : le trigger de levée ignore `UPDATE user_roles SET role_id/user_id` (classe F-B6d-07). Le régime peut rester déclaré à tort, c'est-à-dire assoupli, mais seulement par SQL direct.
- **D2b** — PASS. Permission dédiée hors `ADMIN_PERMISSIONS` (justifié), `.strict()`, comptes actifs vérifiés dans le tenant, ids canonisés par le middleware (clés `…Id`), pas d'auto-désignation, `buildUpdateSet`, `owner` hérité jamais écrasé, candidats limités aux assignateurs (id + nom). Quand une règle d'autorisation lira ces colonnes (DECISION-064), elle devra vérifier que le compte est **actif** (I-R2 conserve les comptes suspendus).
- **D1 / 066** — PASS. Colonne nullable posée à l'INSERT seulement (UPDATE `audit_log` refusé au runtime), aucune valeur de marqueur fournie par le client (9 écrivains, tous côté serveur), le filtre `search` n'est pas exposé en HTTP.
- **D2d / 068** — PASS sur les gardes : set-once, levée définitive, `FOR NO KEY UPDATE`, `search_path` épinglé (vérifié dans `pg_proc.proconfig`), pas de SECURITY DEFINER. Réserves : SEC-PNL-06 (déclaration par le runtime) et I11.

## Suivi (règle 7bis)

- A06 : SEC-PNL-01 (avant production), SEC-PNL-03, SEC-PNL-04 (notifications), I02, I07.
- A07 : SEC-PNL-06.
- HUMAN, A13, A14 : SEC-PNL-02 (ligne « D3 — choix à confirmer » (2)), SEC-PNL-04 (« seconde confirmation » de q149 : même personne ?), SEC-PNL-05 (ligne « D4 — choix à confirmer » (1)).
- A15 : I08 avec D6.

Artefacts PoC (hors dépôt) : `poc_nul.mts`, `poc_nul_cfg.mts`, `poc_mask.mts`, `poc_insert.sql` dans le scratchpad de session A10. Cluster jetable `/tmp/a10_pnl` arrêté et supprimé après la revue.
