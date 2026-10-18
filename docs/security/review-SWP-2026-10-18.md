# Revue sécurité A10 : « un seul chemin d'écriture » (DECISION-054/058/062), 2026-10-18

Cible : commit `5b35762`, fusionné en `ebbc70d` (branche `claude/grc-tools-orchestrator-handoff-epk0y5`). Aucun code applicatif n'a été modifié.

Méthode : revue statique du diff et des chemins d'écriture restants, puis PoC sur la base dédiée PG16 `grc_qa_a10` (socket `/tmp/claude-0/pgsock`, port 5531), jamais Neon :
- l'application réelle (`src/server.ts`, auth locale, rôle `grc_app_runtime`) pour les routes, le circuit et le toggle (script `scratchpad/b6d/swp_http.sh`, fixtures `swp_fixture.sql`, tag `swp`) ;
- les vrais services et dépôts Postgres sous `grc_app_runtime` pour les deux constats d'intégrité (`swp_race.mts`, `swp_toggle_audit.mts`).

Les vitest ciblés (`SingleWritePath`, `ModuleToggleService`) passent : 8/8. L'état modifié par les PoC a été remis en place : mode du processus à NULL, module AUDIT réactivé. L'application a été arrêtée.

Rappel : DECISION-058 est un risque accepté par le PO. Un administrateur seul peut assouplir un réglage hors Dispositif, avec un motif obligatoire et un audit avant/après. Ce n'est pas un constat ici.

## Verdict

**Feu vert staging, aucune escalade HUMAN (CVSS max 2,2).** Les trois routes fermées n'ont plus de chemin d'écriture. Le circuit de demande tient pour les permissions, le maker-checker et le tenant, et il ne contient aucune comparaison de la classe SEC-ID-01. Le motif du toggle est bien obligatoire côté service. Deux constats LOW portent sur l'intégrité (non-atomicité) et ne bloquent pas staging. Il faut les corriger avant la production, avec F-D044-03.

## 1. Routes passées en 410 : PASS

| Requête (admin portant `process.evaluationmode.set` + `config.update`) | Résultat |
|---|---|
| `PUT /processes/:id/evaluation-mode`, avec `/` final, `/PROCESSES/:id/Evaluation-Mode`, id en MAJUSCULES | 410 |
| `PATCH` / `POST` sur la même URL, `//:id`, `%2F` final | 404 |
| `PATCH /processes/:id` avec `evaluationMode` dans le corps | 200, mais `evaluation_mode` reste NULL (zod non strict retire la clé) |
| `PUT /config`, `/config/`, `/CONFIG`, `/config/appetite-mode`, `/config/appetite-mode/` | 410, aucune ligne `configs` créée |
| `PATCH`/`POST /config` | 404 |
| `PUT /config/evaluation-mode` (défaut tenant, encore monté) | 400, « porté par le Dispositif » (`assertNotOwnedByFramework`, frameworks toujours injecté dans `server.ts:395`) |

Montage : `/api/v1/processes` (`server.ts:529`) et `/api/v1/config` (`server.ts:591`) ne sont montés qu'une fois. Aucun routeur monté avant eux ne capte ces préfixes : seul le limiteur d'authentification est monté sur `/api/v1`. Dans `processes.routes.ts`, `PATCH /:id` n'entre pas en conflit avec `PUT /:id/evaluation-mode`. Il n'y a pas de middleware de surcharge de méthode.

Autres écrivains de `processes.evaluation_mode` : `ProcessService.create`/`update` reçoivent un corps zod sans `evaluationMode`. Le seul autre appelant de `processes.update` avec ce champ est `ProcessEvaluationModeRequestService.validate`. Les deux méthodes mortes sont traitées au §4. Côté frontend, aucun appel restant ne vise les routes fermées, ni `PUT /appetite`, `/appetite/:id/archive` ou `/rating-scales/:id/activate`. Côté backend, ces trois routes sont déjà fermées quand le Dispositif est branché (B-6b).

`PATCH /rating-scales/:id/disable` (à vérifier, A05) exige `ratingscale.delete` et un motif. Il refuse l'échelle ACTIVE et une échelle référencée par une évaluation. Le trigger `rating_scales_framework_freeze` (055/058) refuse en base la suppression logique d'une échelle référencée par une version non DRAFT. Reste un cas : une échelle référencée seulement par un brouillon peut être désactivée. Ce cas n'a pas été testé, voir F-SWP-06.

## 2. Circuit `/process-evaluation-mode-requests` : PASS, plus F-SWP-01

| Cas | Résultat |
|---|---|
| x1 (`propose` + `validate`) propose un processus d'un autre tenant | 404 |
| x1 propose avec un `processId` en MAJUSCULES | 201 ; `requested_by` = id canonique de x1 |
| x1 valide sa propre demande (id en minuscules puis en MAJUSCULES), x1 la rejette | 403 maker-checker ×3 |
| x2 sans rôle propose | 403 `process.evaluationmode.propose` |
| x1 liste les demandes d'un processus d'un autre tenant | 200 `[]` |
| admin (tiers) valide, puis rejoue | 200, puis 400 « already decided » ; le mode passe à PARTICIPATIF |

- **Permissions.** `propose` = `process.evaluationmode.propose`, `validate`/`reject`/`get` = `evaluationmode.validate`, lecture de liste = `process.read`. Aucune de ces permissions n'est dans `FIXED_GROUP_PERMISSIONS`, ni dans les migrations ou le seed : elles s'accordent explicitement.
- **Tenant.** Toutes les lectures et écritures passent `actor.tenantId`.
- **Classe SEC-ID-01 : aucune occurrence.** La seule comparaison d'identité (`request.requestedBy === actor.userId`) oppose deux valeurs issues du serveur : la colonne uuid relue en base et l'acteur. `getRiskOwners` compare `r.processId` à `request.processId`, lu en base lui aussi. `canonicalIdsMiddleware` met de toute façon le `processId` du corps en minuscules.
- Le maker-checker n'exclut ni le Risk Owner du processus, ni une personne « concernée ». DECISION-006 ne l'exige pas, et ce point n'est donc pas un constat.

### F-SWP-01 : `validate()` non atomique ; une validation concurrente d'un rejet applique le mode sans trace d'audit

**LOW. CVSS 3.1 = 2,2 (`CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N`). CONFIRMED (PoC). Owner : A06.**

- **Cause.** `ProcessEvaluationModeRequestService.validate` lit la demande et vérifie `PENDING`. Il écrit `processes.evaluation_mode` **avant** le `UPDATE … WHERE status = 'PENDING_VALIDATION'` conditionnel de la demande. Il écrit l'audit ensuite, et rien de tout cela n'est dans une transaction. La fenêtre contient quatre appels DB, dont `risks.list` sur tout le tenant.
- **PoC** (`swp_race.mts`, vrais dépôts, `grc_app_runtime` ; seul artifice : une porte sur `processes.update` qui maintient la fenêtre). V1 valide pendant que V2 rejette. On obtient `reject` = REJECTED, et `validate` = NotFoundError. **État final : demande REJECTED, `processes.evaluation_mode` = PARTICIPATIF.** L'audit ne contient que `Request/CREATE` et `Request/REJECT`, **aucune ligne `Process/UPDATE`**.
- **Impact.** Le mode en vigueur contredit la décision enregistrée (un refus). Le journal ne permet plus de savoir qui a changé le mode : un contrôle de gouvernance est désormais le seul chemin, et sa trace est fausse. Le même état apparaît sans aucune course si l'`UPDATE` de la demande échoue pour toute autre raison.
- **Exploitabilité.** Il faut deux valideurs distincts qui agissent sur la même demande dans la même fenêtre. Un attaquant seul ne gagne rien qu'il n'aurait pas en validant simplement avant.
- **Correctif.** Une transaction. Faire d'abord la transition conditionnelle de la demande (`UPDATE … WHERE status='PENDING_VALIDATION' RETURNING`, ou `SELECT … FOR UPDATE`), puis la mise à jour du processus, puis les deux lignes d'audit, dans la même transaction (modèle `auditsInTransaction` de F-D044-03). Ce code n'a pas été introduit par `5b35762`, mais il en devient le chemin unique.
- **Régression.** Validation et rejet entrelacés sur la même demande : soit le mode reste inchangé et la demande est REJECTED, soit le mode change, la demande est VALIDATED et la ligne `Process/UPDATE` existe. Jamais un état mixte.

## 3. `PATCH /modules/:name/toggle`

| Cas | Résultat |
|---|---|
| x1 sans `config.manage` | 403 |
| admin sans `reason` / `reason: null` / `reason: "   "` | 400 / 400 / 400 (refus du service : `trim`) |
| nom en minuscules `audit` | 400 module inconnu |
| admin désactive AUDIT avec motif | 200 ; audit `STATUS_CHANGE` avec motif, `oldValue`/`newValue` |
| ensuite : `GET /audit-missions`, `GET /findings` | 403 « Module AUDIT disabled » |
| ensuite : `GET /audit-log?entityType=ModuleToggle` (auditeur) | **200** : la désactivation et son motif restent lisibles |

- **Motif obligatoire.** Il est vérifié côté service (`!reason?.trim()`), pas seulement par zod. Conforme à DECISION-058.
- **Désactivation du module AUDIT.** Elle bloque uniquement `/audit-missions` et `/findings`. `/audit-log` n'est pas gardé par le module : le journal reste lisible et la désactivation y est visible. Aucun service ne lit `module_toggles` hors de `moduleGuard`. Les gardes ne sont donc pas touchées : groupe Audit dans `RoleService`, approbateur Audit des Dispositifs, marqueur d'amorçage 062.
- **Permission dédiée.** Voir F-SWP-04 : pas de violation de la règle de CLAUDE.md.

### F-SWP-02 : toggle écrit hors de la transaction de son audit ; module désactivable sans trace

**LOW. CVSS 3.1 = 2,2 (`CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N`). CONFIRMED (PoC). Owner : A06, à rattacher à F-D044-03.**

- **Cause.** `upsert` est exécuté, puis `audit.record`, sans transaction commune.
- **PoC** (`swp_toggle_audit.mts`, vrai `PostgresModuleToggleRepository` sous `grc_app_runtime`, audit qui échoue). L'appel renvoie une erreur, mais **AUDIT reste désactivé en base, avec 0 ligne d'audit.**
- **Impact.** Une désactivation de module sans trace, alors que la trace avant/après est justement la contrepartie exigée par DECISION-058 pour accepter un seul administrateur. La lecture de `before` hors verrou peut aussi enregistrer un « avant » périmé en cas de toggles concurrents (INFO).
- **Correctif.** Patron `audited()`/`auditsInTransaction` de `RatingScaleService` (F-D044-03).

### F-SWP-03 (INFO) : « avant » vide au premier toggle

Quand aucune ligne n'existe, `oldValue` est enregistré en JSON `null`, et non comme l'état implicite `{enabled: true}`. L'audit reste juste, mais le lecteur doit savoir que l'absence de ligne signifie « activé ». Suggestion : enregistrer l'état par défaut explicite.

### F-SWP-04 (INFO) : `config.manage` n'est pas une permission dédiée au toggle

La règle de CLAUDE.md vise une transition **terminale**. La désactivation d'un module n'en est pas une :
- elle est réversible par le même acteur ;
- aucune donnée n'est touchée ;
- le seul lecteur est un garde d'accès ;
- le journal reste lisible.

Il n'y a donc pas de violation de SEC-013/014. En revanche, `config.manage` regroupe aussi les catégories de risque, les référentiels, les tenants et l'import Excel. Quiconque reçoit ce droit pour importer peut couper le module AUDIT. Selon q79, ce détenteur est un administrateur, ce qui reste dans le risque accepté par DECISION-058. Si le PO veut séparer « gérer les référentiels » et « couper un contre-pouvoir », la piste est une permission `config.module.toggle`. Le groupe Audit n'est pas notifié quand son module est coupé ; DECISION-058 ne l'exige pas.

## 4. Code mort : non exploitable, acceptable en attendant le lot de retrait

- `ProcessService.setEvaluationMode`, `ProcessEvaluationModeRequestService.setMode`, `ConfigService.updateMethodology` et `updateAppetiteMode` ne sont référencés par aucun fichier de `src/api/`, ni par aucun autre service.
- Les colonnes qu'écrivaient `updateMethodology`/`updateAppetiteMode` (`scoreFormula`, `levelThresholds`, `impactRetenuRule`, `appetiteMode`) ne sont lues par aucun code hors de Config. Même réactivées, elles resteraient inertes.
- `process.evaluationmode.set` n'est accordée par aucune migration, aucun seed, ni `FIXED_GROUP_PERMISSIONS`. La seule occurrence en base est le rôle de fixture A10. Elle reste cependant attribuable par l'éditeur de rôles.

### F-SWP-05 (INFO) : risque de réintroduction

- Le commentaire de `processEvaluationModeRequests.routes.ts` (l. 15-21) affirme que `PUT /processes/:id/evaluation-mode` expose `setMode`. C'est faux depuis `5b35762`, et cela invite à « rétablir » la route.
- `SingleWritePath.test.ts` monte les routeurs isolément. Le test prouve la réponse 410 du routeur, pas l'absence d'un autre appelant. Le PoC HTTP sur l'application réelle couvre ce point aujourd'hui.

Recommandations pour le lot de retrait (A06) :
- corriger le commentaire ;
- ajouter un test de garde statique : aucune référence à `setEvaluationMode|setMode|updateMethodology|updateAppetiteMode` dans `src/api/` ;
- retirer ensuite les méthodes, puis `process.evaluationmode.set` de l'union `Permission` (`filterKnownPermissions` la fera disparaître des rôles existants).

### F-SWP-06 (INFO, non testé) : désactivation d'une échelle référencée par un brouillon

`RatingScaleService.disable` et le trigger 055 laissent supprimer une échelle référencée seulement par une version DRAFT. L'effet probable est un brouillon inactivable (disponibilité), pas un contournement. À vérifier par A08.

## Suivi (7bis)

| Id | Gravité | Owner | Échéance |
|---|---|---|---|
| F-SWP-01 | LOW 2,2 | A06 | avant production |
| F-SWP-02 | LOW 2,2 | A06 (avec F-D044-03) | avant production |
| F-SWP-03, F-SWP-05 | INFO | A06 | lot de retrait |
| F-SWP-04 | INFO | PO (option) | — |
| F-SWP-06 | INFO | A08 | — |

## Retest sur `07055f2` (2026-10-18) : RETEST_PASS

Rejoué sur la base dédiée `grc_qa_a10`, jamais Neon. Le conteneur avait redémarré : Postgres tournait sans `postmaster.pid`. Je l'ai arrêté proprement, puis relancé avec `pg_ctl` sur le même répertoire. Les fixtures `swp` et les scripts du scratchpad étaient intacts.

Les PoC d'origine ne s'appliquent plus tels quels : `validate()` ne passe plus par `processes.update`, et le toggle n'appelle plus `audit.record`. Ils sont donc remplacés par :
- `swp_race2.mts` : vrais dépôts sous `grc_app_runtime`. La porte met en pause une requête à l'intérieur de la transaction, ou avant elle.
- `swp_toggle2.mts` : vraie panne en base, par un trigger temporaire sur `audit_log`, supprimé ensuite.
- `swp_rt_http.sh` : application réelle.

Les fixtures sont dans `swp_rt_fixture.sql`. Vitest : `SWPFixes`, `QA-SWP`, `SingleWritePath`, `ModuleToggleService` donnent 34 verts et 5 ignorés (suites pg sans `QA_SWP_PGHOST`). L'état est restauré : mode du processus à NULL, modules AUDIT, KRI et KPI réactivés.

### F-SWP-01 : RETEST_PASS, CLOSED

| Ordre | Résultat | État final |
|---|---|---|
| A. `validate` dans sa transaction (verrou de ligne tenu) puis `reject` | `reject` **bloqué** sur le verrou, puis 0 ligne, donc NotFound | VALIDATED, PARTICIPATIF, `Process/UPDATE` + `VALIDATE` : cohérent |
| B. `reject` validé pendant que `validate` est après ses pré-contrôles | `validate` : 0 ligne, NotFound | REJECTED, mode NULL, pas de `Process/UPDATE` : cohérent |
| C. deux valideurs | le second : NotFound | une seule ligne `VALIDATE` : cohérent |
| D. échec de l'INSERT d'audit dans la transaction | `validate` en échec | demande encore PENDING, puis rejet possible : cohérent |

Aucun état mixte, dans aucun ordre. Résidu INFO (F-SWP-09) : le perdant reçoit un 404 « not found » au lieu de « already decided » (message seulement).

### F-SWP-02 : RETEST_PASS, CLOSED

Désactivation d'AUDIT avec une panne réelle de l'INSERT `audit_log` : erreur renvoyée, **aucune ligne `module_toggles`, 0 ligne d'audit**. Le toggle et l'audit sont bien dans la même transaction.

Deux toggles concurrents sur une ligne existante (`FOR UPDATE`) sont sérialisés et chaînés : `true→false`, puis `false→true`.

### F-SWP-03 : RETEST_PASS, CLOSED

Au premier toggle, `oldValue` vaut `{"enabled":true}`.

Nouveau résidu **F-SWP-07 (INFO, A06)** : deux *premiers* toggles concurrents d'un même module (aucune ligne à verrouiller) enregistrent tous deux `true→false`. L'« avant » du second est périmé, mais il n'y a ni perte de trace ni état faux. Correctif possible : relire sous verrou après l'`INSERT … ON CONFLICT`, ou utiliser `xmax` dans `RETURNING`.

### F-SWP-05 : RETEST_PASS, CLOSED

Le commentaire est réécrit et le test de garde est présent. Résidu INFO : la garde ne cherche pas `setMode` (`ProcessEvaluationModeRequestService.setMode`, mort lui aussi). Il faut l'ajouter au motif dans le lot de retrait.

### F-SWP-06 : RETEST_PASS, CLOSED

| `PATCH /rating-scales/:id/disable` (application réelle) | Résultat |
|---|---|
| échelle référencée par un brouillon du tenant : id en minuscules, MAJUSCULES, sans tirets, `{…}`, `%7B…%7D` MAJ, `%2D` | 400 « référencée par une version », échelle non supprimée ×6 |
| échelle d'un autre tenant | 404 |
| échelle propre non référencée (témoin) | 200 |
| échelle propre référencée **seulement** par un brouillon du tenant B, fabriqué en SQL | 200 (contrôle filtré par `tenant_id`) |

Le dernier cas ne contourne pas la protection. L'API refuse déjà qu'un brouillon référence une échelle d'un autre tenant (`RiskFrameworkService` l. 265 et 356). Cet état n'existe donc que par SQL direct.

Résidus INFO :
- **F-SWP-08 (A07)** : `risk_framework_versions.rating_scale_id` n'a qu'une FK simple, sans FK composite tenant, contrairement à `risk_evaluations` depuis 061.
- **TOCTOU (A06)** : le contrôle est fait hors transaction. Un `updateDraft` concurrent qui pointe l'échelle pendant sa désactivation pourrait laisser un brouillon sur une échelle supprimée. Non rejoué, et le trigger 055 couvre les versions non DRAFT.

### Bilan

F-SWP-01, -02, -03, -05 et -06 sont fermés côté Security. F-SWP-04 reste une option PO. Nouveaux INFO : F-SWP-07, F-SWP-08, F-SWP-09, ainsi que la garde `setMode` et le TOCTOU de `disable`. Aucune escalade.
