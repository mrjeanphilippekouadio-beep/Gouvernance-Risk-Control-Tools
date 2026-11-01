# QA — Visibilité des ressources, lot V2 (contrôles, anomalies, plans d'action, KPI)

Agent A08 QA, 2026-11-01. Branche `feat/r1-visibility-v2`. Arbre testé : tête `23506e4`, qui contient les correctifs Security `b4277c3` (SEC V2-01/02/04, CMP-V2-01) ; mes fichiers QA non commités en plus. Spec : `RM-V1-Visibilite-Ressources-spec.md` §1, §3, §5. Pas un avis Security, Privacy ni Compliance (le rapport A10 est `docs/security/SEC-visibility-v2-2026-11-01.md`).

**Verdict : ORANGE (PARTIAL_PASS).** Aucun BLOCKER ni MAJOR. 5 défauts MINOR confirmés et 1 constat UX, tous sur la règle « un objet masqué répond comme un objet inexistant » ou sur la robustesse. Le modèle de lecture (083), les héritages, les enfants, les compteurs et la garde de périmètre tiennent sur PostgreSQL 16 réel.

## 1. Ce qui a été exécuté

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v2.test.ts` (`QA_VIS2_LIVE=1`, vrai serveur tsx + PG16 local 127.0.0.1:55442, base `grc_qa_vv2t`) | 147 tests : 141 PASS + 6 `it.fails` (= défauts ci-dessous). Sans variable : 10 PASS (partie statique), 137 skipped |
| `QA-visibility-v1.test.ts` live rejoué sur la branche V2 (non-régression V1) | 68/68 PASS |
| `tests/integration/qa-visibility-v2-playwright.mjs` (Chromium, vrai backend 8095 + vite 5199 + base `grc_qa_vv2p`) | 33/33 PASS, 0 erreur JS, 0 erreur console imprévue |
| `cd backend && npm run typecheck && npm test` | OK : 155 fichiers PASS + 21 skipped ; 2723 PASS, 528 skipped |
| `cd frontend && npm run build` | OK |

Outillage : `tests/integration/qa-visibility-v2-{setup.sh,server.sh,seed.sql,playwright.mjs}` (jeu V2 posé sur le jeu V1, 12 comptes `<nom>@vv1.test`, secret de jeton généré à l'exécution, `/usr/bin/psql`, jamais Neon). Captures : `/tmp/claude-0/-home-user-Gouvernance-Risk-Control-Tools/8ad96fa7-1a3e-54fe-b0db-c63b5dc23437/scratchpad/shots-v2/` (9 PNG).

## 2. Couverture (oracles écrits avant exécution, depuis la spec)

- **STATIC (10)** : 083 (7 fonctions, `search_path` avec `pg_temp` dernier en ligne et par `ALTER FUNCTION`, aucun `SECURITY DEFINER`, aucun `users.roles`, aucun DML, down atomique) ; chaque `INSERT` de dépôt écrit `visibility` (garde qui aurait attrapé SEC V2-01) ; `visibility` accepté à la création, retiré des PATCH ; `boundedArray(…, 50)`, `z.guid()`, `reasonText(500)` ; `resourcevisibility.set` seulement dans le groupe Risk Manager ; carte frontend sur les 4 écrans ; 2 événements de notification obligatoires.
- **LEAK (12 profils de droits de lecture identiques x tous les objets)** : liste, fiche, `/visibility`, exécutions, efficacité, preuves, mesures KPI, liens, RACI ; canari `CANARY-V2-*` présent si et seulement si le profil lit l'objet ; un id masqué répond mot pour mot comme un id inconnu ; 12 profils x 14 routes de collections / tableaux de bord / rapports / fiche risque 360 sans aucun canari masqué ; compteurs (`openAnomaliesCount`, `/dashboard/anomalies`, `/dashboard/actions`, listes) égaux au nombre d'objets lisibles. L'exécutant garde son exécution sur un contrôle masqué ; le responsable garde son plan sans voir la source (`sourceId` null).
- **XMOD (22 routes d'écriture)** : exécution, efficacité, anomalie (contrôle, risque, exécution), plan (CONTROL, RISK, KRI), mesure KPI, RACI, PATCH contrôle/KPI/anomalie/plan, liens, validations, suppression de preuve, archivage : la cible masquée répond comme l'inconnue ; le même corps réussit sur une cible lisible (test non vacueux).
- **CREATE** : niveau persisté en base pour les 4 ressources ; défaut CLIENT ; 6 niveaux invalides (400, aucune ligne) ; liste envoyée à la création ignorée ; refus « vous ne verriez pas la ressource » ; propriétaire/membre du périmètre accepté ; héritage refusé (anomalie avec risque/contrôle/exécution, plan RISK/CONTROL/KRI).
- **CHG** : qui change (RM, propriétaire = responsable du plan / déclarant, jamais le créateur non responsable, jamais Comité/Audit/lecteur listé ; 404 pour le non-lecteur et pour `adm` qui détient le droit directement ; 401) ; motif (7 formes invalides, 500 accepté, 501 refusé) ; payload (niveau inconnu/minuscule, non-uuid, 51 ids, compte suspendu/inconnu/autre tenant, auto-ajout dont majuscules, révocation d'un non-listé, champ d'attribution client ignoré, `granted_by` = acteur) ; retour à CLIENT purge la liste sans retour ; une ligne `PERMISSION_CHANGE` par changement avec `widening` ; échec d'audit = annulation du changement ; concurrence (6 PUT identiques, course RM/propriétaire) sans 5xx ni doublon de droit ; héritage refusé même au propriétaire (400 « follows ») et 403 au lecteur ; notifications (RM seulement, une fois, sans contenu ; rien pour restriction, pour le RM, ni pour contrôle/KPI).
- **PERIM** : garde RM/propriétaire + motif ; élargissement mesuré sur les lecteurs effectifs (Finance vers Operations : true ; détacher le processus : false) ; edits hors périmètre et no-op sans motif ; contrôle CLIENT libre ; KPI par PATCH et par `/link` ; PATCH combiné (périmètre + statut interdit) refusé en bloc ; atomicité avec l'audit (échec d'audit = périmètre inchangé).
- **INHER (dynamique)** : basculer le risque 502, le contrôle c02, retirer un siège de groupe, une habilitation, un RACI : les enfants se ferment et se rouvrent aussitôt dans les deux sens.
- **Navigateur** : RM restreint un contrôle (motif obligatoire, « Enregistrer » inactif sans motif ou motif blanc, ajout d'un nommé par recherche) et un plan ; `out` ne les voit plus (liste) et reçoit un 404 identique à un id inconnu ; `named` voit le contrôle mais pas le plan ; le responsable `own` voit son plan et peut ouvrir la carte avec « Modifier la visibilité » ; `com`/`aud` voient tout ; une anomalie liée à un risque masqué disparaît pour `out` (et celles qui citent un contrôle ou une exécution via ce risque), reste visible du propriétaire du risque ; sa carte indique « Suit la visibilité de son risque » sans bouton ; le déclarant `dept` modifie une anomalie autonome ; KPI visible du responsable du processus, pas de `out`.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-VIS2-01 | MINOR | La clôture d'un plan accepte la preuve d'une exécution masquée : oracle d'existence (200 contre 400 « does not exist » pour un id inconnu) et le plan porte un `evidenceId` que le clôturant ne peut pas lire. `ActionPlanService.close` appelle `evidences.getById` sans le filtre `executionHidden` | seed V2, compte `out2` (droit `actionplan.validate`) : `PATCH /actions/a0a/close {"evidenceId":"…0f01"}` | `it.fails` |
| QA-VIS2-02 | MINOR | Une anomalie lisible (risque CLIENT) qui cite un contrôle et une exécution masqués expose leurs ids (`controlId`, `controlExecutionId`) à un tiers, en fiche, liste et `/dashboard/anomalies`. Même classe que QA-VIS1-02, corrigé pour les risques seulement | `out` : `GET /anomalies/…0d09` | `it.fails` |
| QA-VIS2-03 | MINOR | `GET /actions/:id/links` d'un plan lisible liste les liens CONTROL et ANOMALY masqués (le filtre ne couvre que RISK) | `out` : `GET /actions/…0a0b/links` | `it.fails` |
| QA-VIS2-04 | MINOR (perte de donnée) | `POST /actions/:id/links` remplace tous les liens sauf les RISK masqués : un éditeur qui ne voit pas un lien CONTROL/ANOMALY le supprime sans le savoir | `out` : `POST /actions/…0a0b/links {"links":[]}` puis lire `action_links` : seul RISK reste | `it.fails` |
| QA-VIS2-05 | MINOR | `PATCH /controls/:id {departmentId: <inconnu>}` répond 500 (violation de FK), restreint ou non ; `processId` inconnu et le KPI répondent 400 | `rm` : `PATCH /controls/c02 {"departmentId":"…09ff","reason":"x"}` | `it.fails` |
| QA-VIS2-06 | TRIVIAL (UX) | Les listes Contrôles, Anomalies, Plans d'action et KPI n'affichent aucun badge de niveau (le registre des risques en a un) et le formulaire de création n'offre pas le niveau : on ne sait pas quelles lignes sont restreintes sans ouvrir chaque carte | capture `own-owner-plan-card.png` | ouvert, non testé en test auto |

Pour retirer un `it.fails` : le passer en `it` après correction ; chaque `it.fails` a été vérifié pour échouer sur la bonne assertion avant d'être posé.

### QA_CHALLENGE (décision PO / Security, pas des défauts)

1. **Déclarant d'une anomalie sur un risque restreint.** Le déclarant perd la vue de sa propre anomalie : la règle du risque l'emporte (`anomaly_visible_to`), et la règle « ce qui m'est assigné » ne couvre que le responsable de plan et l'exécutant. Il ne peut plus la suivre (404 sur la fiche et sur le changement de statut). À confirmer avec la spec (§1 dit seulement que l'anomalie suit le risque). Épinglé par un test.
2. **Plan source introuvable (dangling).** La fonction SQL est fail-closed pour tous, mais le service donne « voit tout » à RM, Comité et Audit par le scope : lecture 200 pour eux, 404 pour les autres. Pas de défaut observable ; la branche « KRI sans risque => tout le monde » de `action_plan_visible_to` est inatteignable (`kris.risk_id NOT NULL`).
3. **Garde de périmètre prudente.** Sur un contrôle NOMINATIF, changer le département exige RM + motif alors que personne ne gagne ni ne perd la lecture ; `widening` vaut false. Un transfert latéral Finance vers Operations est marqué `widening: true` (un lecteur de plus), même si le groupe Finance perd l'accès. Cohérent avec la définition « au moins un lecteur ajouté ».
4. **Lecteurs de contrôle/KPI.** Sans compte propriétaire, seul le RM peut changer le niveau ; le chef de processus ou un lecteur listé reçoit 403 (conforme à I-4, à garder en tête pour le support).
5. **Evidence (Drive).** `GET /evidences/:id/url` répond 500 sur un fichier lisible avec le fournisseur local (pas de Drive) : contrainte d'environnement, pas un défaut ; le test vérifie seulement « jamais 404 » pour un lecteur autorisé.

## 4. Non-régression

V0 : `QA-visibility-v0` modifié par A06 relu, modifications légitimes (le constat « 5 racines sans portée » est remplacé par « plus de lecture `SYSTEM_SCOPE` utilisateur » avec 5 exceptions justifiées ; assertions non affaiblies). V1 : suite live 68/68 sur la tête V2. Suite complète verte. Aucune mutation de code de production exécutée (le code est celui d'A06/A10) ; la sensibilité des tests est établie par les 6 `it.fails` et par un premier passage où une collision de canaris (préfixe commun) a fait échouer le test comme attendu.

## 5. Limites et suites

- Les 12 profils ont les mêmes droits de lecture ; les droits d'écriture ont été donnés par SQL à `out`, `out2`, `dept`, `own`, `named`, `pown` pour le test.
- Non couvert : upload de preuve (Drive absent), multi-tenant des fonctions 083 (couvert en V1 pour `risk_visible_to`, seul un utilisateur d'un autre tenant est testé en `addUserIds`), pagination, charge, import de risques.
- Retest requis après correction de QA-VIS2-01 à 05 : rejouer `QA_VIS2_LIVE=1 npx vitest run test/QA-visibility-v2.test.ts` et passer les 6 `it.fails` en `it`.
- Security (A10) : QA-VIS2-01/02/03 sont des fuites d'identifiants ou d'existence à qualifier côté sécurité ; QA ne tranche pas leur criticité.

## Corrections A06 (2026-11-01, après passage QA)

| Constat | Statut | Correction |
|---|---|---|
| QA-VIS2-01 | **CORRIGÉ** | `ActionPlanService.close` : une preuve rattachée à une exécution illisible (contrôle masqué, pas l'exécutant) répond comme une preuve inconnue (`ResourceVisibilityManager.executionHidden`). |
| QA-VIS2-02 | **CORRIGÉ** | `controlId` / `controlExecutionId` masqués retirés des anomalies lisibles (`maskAnomalyParents`, 2 requêtes), dans `AnomalyService.get/list/updateStatus` et `DashboardService.getOpenAnomalies`. |
| QA-VIS2-03 | **CORRIGÉ** | `GET /actions/:id/links` ne liste plus les cibles CONTROL / ANOMALY masquées (ni un KRI dont le risque est masqué). |
| QA-VIS2-04 | **CORRIGÉ** | `POST /actions/:id/links` conserve côté serveur les liens masqués (RISK, CONTROL, ANOMALY, KRI). |
| QA-VIS2-05 | **CORRIGÉ** | Département inconnu sur un contrôle (création, mise à jour, changement de périmètre) : 400 au lieu d'une violation de clé étrangère (500). |
| QA-VIS2-06 | **CORRIGÉ** | Badge de niveau (« Visibilité ») dans les listes des contrôles, anomalies, plans d'action et KPI. |

Retest : les 6 `it.fails` repassés en `it` ; `QA_VIS2_LIVE=1` → 147/147. Suites live V0/V1/V2 : 152/152. `npm test` : 2723 verts. Build frontend vert.
