# QA droits par ligne de défense (DECISION-098, -101, -103 : q188, q189, q200, migration 079)

- Date : 2026-10-28. Agent : A08 (QA). Branche `feat/r1-rights-lines`, tête revue `558fe68`. Pas un avis Security, Privacy ni Compliance. Aucun code de production modifié.
- Verdict : **PARTIAL_PASS**. 1 MAJOR (QA-RL-03), 3 MINOR (QA-RL-01, -02, -04), 3 observations. Aucun BLOCKER/CRITICAL. Les fuites de listes, d'ids de rôles et de comptes, le circuit de confirmation (auteur, bénéficiaire, expiration, double demande, tenant, audit) et la fermeture au retrait tiennent.
- Livrables : `backend/test/QA-rights-lines.test.ts` (81 tests : 75 PASS dont 7 sur PostgreSQL réel, 6 `it.fails` épinglant QA-RL-01 x5 et QA-RL-02), `tests/integration/qa-rights-lines-playwright.mjs` (54 vérifications : 51 PASS, 3 FAIL = QA-RL-01/-02/-03), `tests/integration/qa-rights-lines-setup.sh` (cluster PG16 jetable, migrations 001..079, 8 comptes + un autre tenant).

## 1. Environnement et commandes

PostgreSQL 16 local (`/var/tmp/qarl`, 127.0.0.1:55438, base `grc_qa_rl`), jamais Neon ni Google, `psql` par `/usr/bin/psql`. Backend `tsx --import tests/integration/qa-f7s1-test-preload.mjs src/server.ts` (AUTH_PROVIDER=local, port 8099), `vite --port 5199`, Chromium. `cd backend && npm run typecheck && npm test` : OK, 2609 passent, 294 ignorés (PG), 1 échec attendu ; avec `QA_RL_PGPORT=55438` : 81/81 (75 + 6 attendus). Build frontend OK. Cluster, backend et vite arrêtés et supprimés après le passage.

## 2. Oracles et résultats (écrits avant exécution, en tête des deux fichiers)

| Axe | Résultat |
|---|---|
| L1 listes : `/roles`, `/matrix`, `/accounts` sans Audit ni administrateurs (nom, id, droits) pour un lecteur restreint ; l'administrateur voit tout ; badge de ligne sur chaque ligne | PASS (service, HTTP, navigateur) |
| L2 ids : `/roles/:id`, `/users/:id/permissions`, `/users/:id/permission-sources` d'un caché = id inconnu (404, même corps hors id) ; compte suspendu caché = 404 (pas 200 + `suspended`) | PASS ; **exception** `/roles/users/:id` (QA-RL-02) |
| L3 cumul : le plus sensible gagne (RM+admin, Comité+Audit, RM+droit direct legacy, Audit+admin, 1re ligne+Comité) ; siège Audit révoqué ou rôle désactivé ne classe plus ; un seul droit d'administration suffit | PASS |
| L4 lecteurs non restreints : administrateur (rôle ou droit direct), membre Audit (sans autre droit), détenteur de `role.read.sensitive` ; sortie d'Audit = restreint ; `role.read.sensitive` jamais portable par un rôle (create/update) | PASS |
| C1 demande : `role.assign` seul, jamais pour soi (403), jamais hors groupe Risk Manager (400), compte suspendu/inconnu/autre tenant (404), 14 corps invalides (400, rien d'écrit), motif 500 accepté / 501 refusé, `requestedBy`/`status`/`tenantId`/`decidedBy` du client refusés (400), auteur forcé à l'appelant, expiration figée à la demande (`policyRequestExpiryDays`, null si absent) | PASS |
| C2 décision : auteur et bénéficiaire refusés (même avec tous les droits), tiers Comité ou Audit accepté, refus sans motif 400, rejeu approve/reject/après retrait 409, **expirée : approbation 409, rejet possible**, bornes +1 s / -1 ms, adhésion revérifiée à l'approbation | PASS |
| C3 double demande : 409 si PENDING ou APPROVED, nouvelle demande permise après REJECTED/REVOKED, 3 demandes simultanées -> 1 gagnante (index unique PG), 3 décisions simultanées -> 1 gagnante et 1 ligne d'audit | PASS |
| C4 effet : seulement APPROVED **et** membre du groupe Risk Manager, uniquement pour le bénéficiaire (rm2 reste restreint), source `GRANT` sur `role.read.sensitive` seul | PASS |
| C5 retrait : `role.assign` + motif, depuis PENDING ou APPROVED, terminal (409 ensuite), REJECTED non retirable, audit SUBMIT/APPROVE/UNASSIGN avec acteur, requestId, avant/après | PASS |
| C6 notification `SENSITIVE_VIEW_GRANT_PENDING` : Comité et Audit seulement, ni auteur ni bénéficiaire (service et PG réel) ; sans notifieur la demande réussit | PASS |
| C7 tenant : grant d'un autre tenant = 404/409, jamais modifié ni listé ; FK `(tenant_id, user_id)` refuse une ligne croisée en SQL brut | PASS |
| Base : CHECK auto-demande, maker-checker, motif vide, refus sans motif (23514) ; DELETE/TRUNCATE/édition de contenu/transition interdite (42501) ; échec d'audit = rollback complet (création, décision, retrait) | PASS |
| Navigateur : RM restreint (4 colonnes avec badges, liste sans Audit/admins, pas d'onglet élargi), admin (6 colonnes, badges, onglet) -> demande -> notification -> confirmation par un membre du Comité -> le RM voit tout (6 colonnes, droits de l'Auditeur, source « Vue élargie confirmée ») -> retrait avec motif -> il ne voit plus ; sortie du groupe | PASS (hors défauts ci-dessous) ; zéro erreur console sur les écrans restreint et élargi |

Mutations vérifiées (chacune fait échouer au moins un test) : retrait de l'exigence du groupe Risk Manager (3 échecs), retrait du refus auteur/bénéficiaire (2), exception Audit du lecteur restreint (2), retrait du contrôle d'adhésion à l'approbation (1), retrait du contrôle de visibilité des sources (3).

## 3. Défauts

| Id | Gravité QA | Où | Constat |
|---|---|---|---|
| QA-RL-03 | MAJOR | `frontend/src/App.tsx:94` (entrée `requires: "role.read"`), `backend/src/domain/fixedGroupPermissions.ts:33` (Comité) et `:44` (Audit) ; onglet `RightsMatrixPage.tsx:94,112` | Les confirmeurs prévus (groupes Comité et Audit) n'ont pas `role.read` : sans droit direct en plus, l'entrée « Matrice des droits » est absente du menu, donc **ni l'onglet « Vue élargie » ni le bouton Confirmer n'existent pour eux**. L'API les accepte (`rolegroup.audit.validate` suffit : liste 200). Le circuit n'est donc utilisable à l'écran que par un confirmeur à qui l'on a ajouté `role.read`. Attendu : un confirmeur atteint l'écran de décision. Constat navigateur 4.1 (com0 : menu sans l'entrée) ; le parcours 5 passe avec com qui a `role.read` direct. Décision de produit (donner `role.read` aux deux groupes, ou entrée de menu sur `rolegroup.audit.validate`) à prendre par le PO. |
| QA-RL-02 | MINOR (sécurité suspectée : à voir par Security) | `backend/src/services/RoleService.ts:802-810` (`listForUser`) | `GET /roles/users/:id` : un id inconnu répond 200 `[]`, un compte Audit/admin caché répond 404. Le 404 révèle donc « ce compte existe et appartient à une ligne sensible », contrairement à la consigne « identique à un id inconnu » (les deux autres routes `/users/:id/…` sont conformes : 404 des deux côtés). Test `it.fails` + contrôle 0.4. |
| QA-RL-01 | MINOR | `backend/src/api/v1/roles.routes.ts:233,252,263,272,282` | Les routes `GET/PATCH /roles/:id`, `POST /:id/disable|assign|revoke` ne valident pas l'identifiant : `not-a-uuid` atteint PostgreSQL (22P02) et répond **500** (même famille que QA-F7S3-01, corrigée seulement pour `/roles/users/:userId…`). Attendu : 400 ou 404. 5 tests `it.fails` PG + contrôle 0.5. |
| QA-RL-04 | MINOR | `frontend/src/features/admin/SensitiveViewsCard.tsx:67` ; message `RoleService.ts:324` | La liste « Membre du Risk Manager » filtre `line === "LINE_2"` : elle propose aussi les membres du Comité, que le serveur refuse (400) avec un message **en anglais** (« A widened view is given to a member of the Risk Manager group only ») affiché tel quel dans l'écran français. |

## 4. Observations (pas des défauts affirmés)

- QA-RL-OBS-01 : `GET /users/directory` accepte `role.read` (q187, `UserService.ts:46-55`) et nomme tous les comptes actifs, Audit et administrateurs compris ; la différence entre l'annuaire et `/roles/accounts` révèle donc quels comptes sont de ligne sensible (noms seulement). À trancher par Security / le PO.
- QA-RL-OBS-02 : la ligne Audit se définit par le groupe Audit seulement. Un rôle ordinaire portant `audit.read` est classé 1re ligne et reste visible d'un lecteur restreint, alors que `isAuditPermission` (F-B8b-05) en fait un auditeur « en effet ». Test d'observation.
- QA-RL-OBS-03 : un membre qui quitte le groupe Risk Manager perd la vue aussitôt (testé, PG compris) mais la ligne reste APPROVED et affichée « Active » ; s'il revient dans le groupe, **l'ancienne confirmation se réactive sans nouveau confirmeur**. À confirmer comme voulu par le PO. Test d'observation.

## 5. Revues requises

Security : QA-RL-02 (oracle d'existence), QA-RL-OBS-01/02/03. Privacy : noms de comptes Audit visibles par l'annuaire (OBS-01). Compliance, Risk : non requis par ce lot.

## 6. Rejouer

1. `bash tests/integration/qa-rights-lines-setup.sh up` (cluster, migrations 001..079, comptes `<nom>@rl.test`).
2. Backend et vite comme au §1 (`LOCAL_AUTH_USERS_JSON` : 8 comptes `adm rm1 rm2 com com0 aud stf roa @rl.test`, hash `scrypt$<sel>$<hex scryptSync("whatever",sel,64)>`, `LOCAL_AUTH_TOKEN_SECRET` >= 32 caractères, `VITE_API_BASE_URL=http://127.0.0.1:8099`).
3. `node tests/integration/qa-rights-lines-playwright.mjs` depuis la racine (base neuve à chaque passage : le script écrit des demandes et retire rm2 du groupe) ; `cd backend && QA_RL_PGPORT=55438 npx vitest run test/QA-rights-lines.test.ts`.
4. `bash tests/integration/qa-rights-lines-setup.sh down`.

STATUS : PARTIAL_PASS. RETEST_REQUIRED : oui pour QA-RL-01/-02/-03/-04 (passer les `it.fails` en `it`, rejouer 0.4, 0.5, 4.1).
