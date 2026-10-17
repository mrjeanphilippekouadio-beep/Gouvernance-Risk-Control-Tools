# Revue sécurité A10 — référentiels, écran Dispositif, migration 061 (2026-10-17)

Périmètre : `60560c4` (backend), `94b3d9d` (frontend), extension orchestrateur `590b745` (migration 061 + down) et `8290648` (409 sur course d'insertion). Tête `590b745`/`8290648`. Aucun code applicatif modifié.

Méthode : revue statique, PoC tsx hors dépôt (service réel `RiskCategoryService` + faux repository asynchrone), vitest ciblé (41 verts : RiskCategoryService, DepartmentService, QA-B6bF), Postgres 16 jetable (001→061 appliquées, attaques sous `grc_app_runtime`, 061.down puis double réapplication).

Verdict global : **feu vert staging, aucune escalade HUMAN** (CVSS max 2,2 < 7).

## 1. F-CAT-02 (LOW 2,7) — RETEST_PASS, CLOSED

- Parent d'un autre tenant refusé en `update` : `assertValidParent` lit par `getById(actor.tenantId, …)`. PoC : `ValidationError: parentId "c1" does not exist for this tenant`.
- Oracle d'existence fermé : parent absent → message identique (même classe, même gabarit, seul l'identifiant fourni par l'appelant est répété). En base, la FK composite 061 rend le 23503 inatteignable par le chemin service.
- Cycle et profondeur, cas séquentiels : un parent qui est lui-même une sous-catégorie est refusé, une catégorie qui a des enfants ne peut pas devenir sous-catégorie, l'auto-parentage est refusé. La profondeur maximale de 2 rend tout cycle impossible en séquentiel.
- Partie DB (061) : `UPDATE parent_id` vers un autre tenant, `INSERT` avec un parent d'un autre tenant, et `UPDATE tenant_id` d'un enfant pour s'échapper : tous refusés (23503 `risk_categories_parent_tenant_fk`). La FK est `NOT VALID` : elle s'applique aux nouvelles écritures, et le `VALIDATE` est à jouer à part (déjà tracé dans ACTION_ITEMS).

### F-CAT-03 — LOW 2,2 (CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N), CONFIRMED, owner A06 + A07

- Course TOCTOU : `update(A, parent=B)` et `update(B, parent=A)` lancés en même temps passent tous les deux. Les contrôles lisent l'état avant écriture, sans verrou. PoC : `[OK, OK]`, état final `A->B, B->A`. En base, aucune garde ne l'empêche : le même cycle s'écrit directement sous le runtime.
- Effet observé : aucun lecteur ne parcourt la chaîne des parents, donc pas de boucle infinie. L'écran (`RiskCategoriesPage`, racines = `!parentId || parent absent`) rend en revanche les deux catégories invisibles. Il faut le privilège `config.manage` et deux requêtes concurrentes.
- Recommandation : un trigger `BEFORE INSERT OR UPDATE OF parent_id` (avec `SET search_path = pg_catalog, public, pg_temp`). Il verrouille la ligne parente (`FOR UPDATE`), exige `parent.parent_id IS NULL` et refuse si `NEW.id` a des enfants. Autre option côté service : contrôles et écriture dans une transaction sous `pg_advisory_xact_lock` par tenant. Régression : deux updates croisés concurrents, dont exactement un doit échouer.

## 2. QA-REF-02 attribution (`riskOwnerDesignatedBy`) — RETEST_PASS, CLOSED

- `CreateDepartmentBody` n'a plus le champ. zod en mode non strict retire la clé. `CreateDepartmentInput` ne la porte plus. `DepartmentService.create` construit l'input champ par champ et passe `actor.userId` au repository. Le test passe un `riskOwnerDesignatedBy: "ceo@x.com"` forgé et obtient `user-1`.
- Inventaire des écrivains SQL de `departments` : `create` (INSERT), `update` (`buildUpdateSet` sans colonne de désignation), `designateRiskOwner` (`actor.userId`), `softDelete`. Il n'existe aucun import ni autre chemin. `UpdateDepartmentInput` et `UpdateDepartmentBody` ne portent aucun champ `...By`. Côté frontend, `DepartmentCreateInput`/`DepartmentUpdateInput` n'en envoient pas (le champ n'existe que dans le type de lecture).
- Effet de bord fermé : avant le correctif, un client pouvait écrire `riskOwnerDesignatedBy = "Pilote par défaut…"` avec un Risk Owner explicite. Le prochain changement de manager écrasait alors ce Risk Owner sans événement ASSIGN audité. Ce n'est plus possible.
- INFO F-REF-01 : le commentaire de `UpdateDepartmentInput` (`Department.ts` l. 40) dit encore « present on CreateDepartmentInput ». Commentaire périmé, sans impact.

## 3. `DepartmentService.archive` — PASS (contrôle tenant-scopé, permission correcte)

- `processes.list(actor.tenantId)` est filtré par `tenant_id`, et l'archivage passe par `department.delete`, la permission dédiée à l'état terminal (inchangée, conforme SEC-013/014), puis par le motif obligatoire, l'audit `DELETE` et le soft delete.
- INFO F-REF-02 (A06/A08, intégrité, pas sécurité) : (i) `list` exclut les processus `active = false` non supprimés, qui peuvent donc rester rattachés à un département archivé ; (ii) le contrôle échoue ouvert si `ProcessRepository` n'est pas injecté (paramètre optionnel, câblé dans `server.ts`), à l'inverse de `ProcessService` qui échoue fermé ; (iii) TOCTOU avec une création de processus concurrente.

## 4. Frontend Dispositif (`94b3d9d`) — PASS

- Aucun `dangerouslySetInnerHTML` dans `frontend/src`. Aucun secret, aucune variable `VITE_*`, aucun stockage navigateur dans les fichiers revus.
- Aucun champ d'attribution envoyé : `DraftPatch` ne contient que des paramètres scalaires, `requestedBy`/`decidedBy` n'existent qu'en lecture, et `createDraft` n'envoie que `{fromVersionId}`.
- Maker-checker entièrement côté serveur : l'écran affiche Approuver, Refuser et Retirer à tout le monde. `RiskFrameworkService.decide` vérifie `riskframework.activate`, exclut le demandeur et les auteurs (`authorsOf`), et `withdraw` est réservé au demandeur. Aucun contrôle d'autorisation n'est confié au client.
- INFO F-REF-03 : les identifiants sont interpolés dans les chemins sans `encodeURIComponent`. Ils viennent du serveur (UUID), et l'autorisation reste celle du serveur. À aligner sur le reste du frontend.
- `withMasteryIndependence` (QA-B6bF-03) ne fait que décorer la réponse. Aucun effet sur l'autorisation.

## 5. Extension — migration 061 (`590b745`)

### F-B6b-06 — RETEST_PASS, CLOSED

Toutes ces tentatives ont été faites sous `grc_app_runtime` :

| Tentative | Résultat |
|---|---|
| INSERT nominal (instantané exact de la version ACTIVE) | accepté |
| Seuil Comité forgé à 1 | 42501 snapshot mismatch |
| Autre échelle du même tenant | 42501 |
| Libellé de version d'échelle faux | 42501 |
| Version DRAFT | 42501 not ACTIVE |
| Version ACTIVE d'un autre tenant | 42501 not ACTIVE / tenant |
| Ligne legacy avec seuil seul | 42501 snapshot requires version |
| Naître legacy puis rattacher une version par UPDATE | 42501 set at creation |
| Table temporaire `risk_framework_versions` qui ombre la vraie (DRAFT forcée ACTIVE) | 42501, `search_path` respecté |
| `DISABLE TRIGGER` | refusé (owner) |

- `proconfig` = `search_path=pg_catalog, public, pg_temp` sur les deux fonctions (insert guard et guard 060 redéfinie), après up, après down, et après une double réapplication. Le SET est à la fois inline et en ALTER.
- 061.down : retire la garde INSERT, les deux FK et les UNIQUE, restaure 060 avec son `search_path`, et supprime sa ligne `schema_migrations`. La FK 060 `framework_version_tenant_fk` est conservée. Up et double up sont idempotents.

### F-B6b-07 — RETEST_PASS, CLOSED

- FK composite `(tenant_id, rating_scale_id)` : un UPDATE vers l'échelle d'un autre tenant est refusé (23503). `rating_scale_version` est gelée une fois posée (42501 frozen).
- INFO F-061-01 (A07, non bloquant) : sur une évaluation legacy (sans Dispositif), le passage `rating_scale_id`/`rating_scale_version` de NULL à une valeur reste libre, ce que le nominal `recordInherentScoring` exige. Sous le runtime, on peut y poser une échelle du tenant avec un libellé de version arbitraire (`'forged'` accepté). Ce n'est pas un instantané de Dispositif, et ce n'est atteignable qu'avec les identifiants DB. On peut, si on le souhaite, contrôler `rating_scale_version = rating_scales.version` au passage de NULL à une valeur.

## 6. Extension — `8290648` (42501 → 409)

- Confirmé : seul le message du trigger 061 `framework version must be ACTIVE` devient `ConflictError`. Ce message n'apparaît qu'une fois dans les migrations. Un vrai défaut de privilège (`permission denied for table …`) et le mismatch d'instantané sont relancés tels quels, donc en 500. Le test unitaire couvre les deux cas.
- INFO F-REF-04 : le message du trigger couvre aussi « la version n'appartient pas au tenant ». Un défaut de code qui résoudrait une version d'un autre tenant deviendrait donc un 409 « retry » au lieu d'une 500 journalisée. Ce n'est pas atteignable aujourd'hui, car la version est résolue côté serveur et tenant-scopée. Recommandation : deux messages distincts dans le trigger, avec 409 seulement pour « not ACTIVE ».
- INFO F-REF-05 (antérieur, hors `8290648`) : `PostgresRiskFrameworkRepository.mapPgError` (`0a465fa`, l. 207) transforme tout 42501 en `ValidationError` « version figée ». La leçon QA-B6bF-02 n'y a pas été appliquée, et un vrai défaut de privilège y est masqué en 400. Recommandation (A06) : faire la correspondance sur les messages des triggers 055/056/057.

## Tracker (7bis)

- F-CAT-03 LOW 2,2 : A06 + A07 (avant prod)
- F-REF-02 : A06/A08
- F-REF-04, F-REF-05 : A06
- F-061-01 : A07
- F-REF-01, F-REF-03 : A06 / dev-frontend, cosmétique
