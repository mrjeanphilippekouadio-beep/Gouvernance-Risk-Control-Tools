# QA — Visibilité des ressources, lot V2bis (DECISION-107 : q207 A et q208 A)

Agent A08 QA, 2026-11-01. Branche `feat/r1-visibility-v2bis`, tête `8cc19d6` (au-dessus de staging qui contient V2). Pas un avis Security, Privacy ni Compliance.

**Verdict : ORANGE (PARTIAL_PASS).** Aucun BLOCKER ni MAJOR. Les règles q207 (motif, PERMISSION_CHANGE, notification) et q208 (événements du propriétaire, liste RM) fonctionnent sur PostgreSQL 16 réel et dans le navigateur. 2 défauts MINOR (bruit et doublons) et 1 constat UX TRIVIAL ; 4 points à trancher par le PO.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v2bis.test.ts` (`QA_VIS2B_LIVE=1`, vrai serveur tsx + PG16 local 127.0.0.1:55442, base `grc_qa_vv2bt`, reconstruite à chaque run) | 37 tests : 35 PASS + 2 `it.fails` (les 2 défauts) ; sans variable : 6 PASS (statique), 31 skipped |
| Suites live V1 + V2 + V2bis ensemble, `--no-file-parallelism` | 249 PASS + 2 expected fail ; après mise à jour de V1/V2 (voir §4), V1 68/68 |
| `tests/integration/qa-visibility-v2bis-playwright.mjs` (Chromium, backend 8093 + vite 5199, base `grc_qa_vv2bp`) | 28/28 PASS, 0 erreur JS, 0 erreur console imprévue |
| `cd backend && npm run typecheck && npm test` | OK : 157 fichiers PASS + 21 skipped ; 2741 PASS, 561 skipped |
| `cd frontend && npm run build` | OK |

Outillage : réutilise `tests/integration/qa-visibility-v2-{setup,server}.sh` + `qa-visibility-v2-seed.sql` ; nouveau `qa-visibility-v2bis-playwright.mjs`. Captures : `/tmp/claude-0/-home-user-Gouvernance-Risk-Control-Tools/8ad96fa7-1a3e-54fe-b0db-c63b5dc23437/scratchpad/shots-v2bis/` (4 PNG).

## 2. Couverture (oracles écrits avant exécution, depuis la décision)

- **q207 RACI** (contrôle c02, risque 502, plan a06) : sans motif, motif vide, blanc, tab/newline, 501 caractères, null, nombre => 400 et RIEN d'écrit (ni ligne RACI, ni audit, ni notification, ressource toujours masquée) ; motif de 500 caractères accepté : ligne RACI, `PERMISSION_CHANGE` (auteur, motif, `through: RACI`, `widening: true`, `reads` faux puis vrai), ligne CREATE de l'affectation portant le motif, lecture immédiate, RM notifié exactement une fois avec le bon événement (CONTROL / RISK / ACTION_PLAN `_VISIBILITY_WIDENED`), message sans contenu ni id, aucun autre compte notifié ; la révocation referme. Les 4 rôles R/A/C/I ouvrent pareil.
- **Pas de motif requis** si rien ne s'ouvre : la personne lit déjà (responsable de processus), ressource CLIENT, ou auteur du groupe RM (la trace PERMISSION_CHANGE est écrite, motif null, personne notifié). Un motif inutile est accepté et non enregistré.
- **NOMINATIF** (le RACI ne l'ouvre pas, I-3) : un non-RM doit quand même donner un motif ; rien ne s'ouvre, ni trace ni notification.
- **Cible masquée** : l'auteur qui ne lit pas la ressource reçoit la réponse « id inconnu » avant toute règle de motif (pas d'oracle).
- **Atomicité** : si la ligne PERMISSION_CHANGE ne peut pas être écrite (déclencheur qui échoue), aucune affectation n'est laissée et la ressource reste masquée (RACI et responsable de processus).
- **q207 responsable de processus** (`PUT /processes/:id/responsibilities`) : mêmes refus sans écriture ; avec motif : UPDATE + PERMISSION_CHANGE dans la même piste, liste `opened` exacte `[CONTROL c02, KPI 9002, RISK 502]` (ni NOMINATIF, ni orphelin, ni CLIENT), RM notifié une fois (`PROCESS_OWNER_VISIBILITY_WIDENED`), le nouveau responsable lit les trois, l'ancien perd ce que seul le processus lui donnait. Pas de motif si rien ne s'ouvre (processus sans ressource restreinte, mêmes valeur, adjoint ou risk champion seuls, propriétaire effacé, processus avec seulement du NOMINATIF). Auto-désignation toujours refusée. Pas de contournement : `PATCH` et `POST /processes` n'écrivent pas `ownerUserId`.
- **q208 événements du propriétaire** : plan, anomalie et risque, restriction => `*_VISIBILITY_RESTRICTED`, élargissement => `*_VISIBILITY_WIDENED`, une notification par changement et par membre RM, rien pour le RM auteur, ni Comité, Audit, propriétaire, personnes listées, ni contrôles / KPI (pas de propriétaire).
- **q208 `GET /restricted-resources`** : 401 anonyme, 200 pour le seul groupe RM, 403 pour les 11 autres profils (Comité, Audit compris) ; contenu = exactement les lignes restreintes de la base du tenant (type, id, niveau, nombre d'accès actifs recalculé), jamais CLIENT, jamais un autre tenant, tri par date décroissante ; un changement de niveau ou de liste se reflète aussitôt ; un contrôle supprimé (soft) sort de la liste. Un rôle personnalisé ne peut pas porter `resourcevisibility.set`.
- **Navigateur** : rm voit l'entrée de menu et l'écran (13 ressources, niveaux affichés, compteur = API, aucune ressource CLIENT) ; dept, out, com, aud n'ont pas l'entrée et reçoivent 403 sur l'API ; dept ajoute un RACI sur un plan restreint : refusé sans motif (message affiché, aucune ligne), accepté avec motif ; `out` lit alors le plan ; PERMISSION_CHANGE avec motif ; la cloche du RM affiche l'événement sans le titre du plan ; plan CLIENT : RACI sans motif.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-V2B-01 | MINOR | Une même affectation d'ouverture envoyée 5 fois en parallèle passe 5 fois la pré-vérification `canRead` : 5 lignes RACI actives (la table n'a aucune unicité, préexistant), 5 `PERMISSION_CHANGE` et 5 notifications au RM. Attendu : 1 et 1 et 1 | `own` : 5 `POST /raci` simultanés (ACTION_PLAN a06, `out2`, C, motif) | `it.fails` |
| QA-V2B-02 | MINOR | Un PUT du propriétaire qui ne change rien (même niveau, liste inchangée) notifie quand même le RM d'une « restriction » (`widening` faux => événement RESTRICTED). Bruit sur un événement obligatoire | `own` : `PUT /actions/:id/visibility {"visibility":"PERIMETRE"}` deux fois de suite | `it.fails` |
| QA-V2B-03 | TRIVIAL (UX) | Le refus « motif requis » du panneau RACI s'affiche en anglais brut (« A reason (1 to 500 characters) is required: … ») dans une interface française | capture `dept-raci-refused.png` | ouvert |

### QA_CHALLENGE (décision PO / Security)

1. **Autres chemins d'ouverture non couverts par q207.** Affecter à une personne le groupe d'un département (`POST /roles/:id/assign` sur un groupe `department_id`) lui ouvre toutes les ressources PERIMETRE du département sans motif, sans `PERMISSION_CHANGE` et sans notification (épinglé par un test d'observation). Même question pour la désignation d'un propriétaire de risque et du N+1. À décider : étendre q207 ou assumer.
2. **Liste RM : porte = chaîne de permission, pas le groupe.** Un compte qui détient `resourcevisibility.set` directement dans `users.roles` sans être du groupe RM lit toute la liste (libellés de ressources qu'il ne peut pas lire lui-même ; épinglé). Atteignable seulement hors groupe fixe (un rôle personnalisé ne peut pas porter ce droit) : à vérifier côté Security.
3. **Motif exigé sans effet sur du NOMINATIF.** Pour un RACI sur une ressource NOMINATIF, le non-RM doit donner un motif alors que rien ne s'ouvre ; aucune trace ne conserve ce motif (la ligne CREATE le porte, mais pas de PERMISSION_CHANGE). Prudent, cohérent avec V2 (garde NOMINATIF), à confirmer.
4. **Liste sans pagination.** La requête n'a pas de `LIMIT` : la réponse grossit avec le nombre de ressources restreintes. Les libellés de risques et d'anomalies sont tronqués à 160 caractères, pas ceux des contrôles, plans et KPI. La liste affiche le niveau stocké de chaque racine : une anomalie ou un plan qui suit un parent restreint n'est pas listé seul (le parent l'est).

## 4. Non-régression

Deux tests existants ont dû être mis à jour, légitimement, par la décision q208 (un propriétaire qui restreint notifie désormais le RM) : `QA-visibility-v2.test.ts` (« owner narrows: nothing » devient RESTRICTED) et `QA-visibility-v1.test.ts` (« owner narrows: not notified » devient un 3e événement `RISK_VISIBILITY_RESTRICTED`, séquence des types vérifiée). Rien d'autre affaibli. Les changements de A06 dans `NotificationsCenter`, `QA-D044`, `QA-Notifications` (compte 27 vers 32 types, 5 nouveaux types obligatoires) relus : conformes.

## 5. Limites et suites

- Les suites live qui reconstruisent chacune leur base peuvent tourner ensemble avec `--no-file-parallelism` (fait) ; elles partagent le port 55442 mais pas les bases ni les ports serveur.
- Non couvert : charge de la liste (pas de pagination), upload de preuve (Drive absent), autre tenant pour les fonctions SQL (couvert en V1).
- Retest après correction de QA-V2B-01/02 : `QA_VIS2B_LIVE=1 npx vitest run test/QA-visibility-v2bis.test.ts`, passer les 2 `it.fails` en `it`.
