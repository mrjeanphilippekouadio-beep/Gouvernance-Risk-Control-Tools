# QA — Visibilité des ressources, lot V3 (DECISION-108/109 : q196/q198, q209, q212)

Agent A08 QA, 2026-11-01. Branche `feat/r1-visibility-v3`, tête `4bdd871` (V3 `76c80dc` + revues Privacy/Security) plus les correctifs SEC V3-01, PRIV-V3-01, PRIV-V3-05 et N+1 NOMINATIF présents dans l'arbre de travail (non commités au moment du test). Pas un avis Security, Privacy ni Compliance (rapports A10 et A15 séparés).

**Verdict : ORANGE (PARTIAL_PASS).** Aucun BLOCKER ni MAJOR. Comptage, liste Comité/Audit, pagination et q212 fonctionnent sur PostgreSQL 16 réel et dans le navigateur. 2 défauts MINOR confirmés : deux écritures q212 ne sont pas atomiques avec leur trace.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v3.test.ts` (`QA_VIS3_LIVE=1`, vrai serveur + PG16 local 127.0.0.1:55442, base `grc_qa_vv3t` reconstruite à chaque run) | 46 tests : 44 PASS + 2 `it.fails` ; sans variable : 6 PASS (statique), 40 skipped |
| Suites live V1 + V2 + V2bis + V3 ensemble, `--no-file-parallelism` | 296 PASS + 2 expected fail |
| `tests/integration/qa-visibility-v3-playwright.mjs` (Chromium, backend 8091 + vite 5199, base `grc_qa_vv3p`) | 26/26 PASS, 0 erreur JS, 0 erreur console imprévue |
| `cd backend && npm run typecheck && npm test` | OK : 159 fichiers PASS + 21 skipped ; 2753 PASS, 604 skipped |
| `cd frontend && npm run build` | OK |

Outillage : `qa-visibility-v2-{setup,server}.sh` + seed V2 réutilisés ; nouveau `qa-visibility-v3-playwright.mjs`. Captures : `/tmp/claude-0/-home-user-Gouvernance-Risk-Control-Tools/8ad96fa7-1a3e-54fe-b0db-c63b5dc23437/scratchpad/shots-v3/`.

## 2. Couverture (oracles écrits avant exécution, depuis les décisions et la matrice de lecture V1/V2)

- **`GET /hidden-counts`** : 401 anonyme ; `null` pour RM, Comité, Audit ; pour les 9 autres profils le nombre par type égale exactement les éléments PERIMETRE (niveau effectif) que le profil ne lit pas, calculés à la main depuis la matrice (contrôle c02 + orphelin c04, KPI, risque 502, 5 anomalies, 6 plans) ; NOMINATIF, CLIENT et niveau propre ignoré jamais comptés ; le plan dont le lecteur est responsable n'est pas compté pour lui. Réponse = seulement des entiers par type (aucun id, libellé, canari). Types limités aux droits de lecture (sans `risk.read` ni `kpi.read` : pas de clé RISK ni KPI ; sans aucun droit : `{}`). Suit les données aussitôt : restreindre un contrôle CLIENT en PERIMETRE ajoute 1, le nommer le retire, NOMINATIF ne compte pas ; contrôle ou KPI supprimé (soft) sort ; un risque 502 passé NOMINATIF retire de lui-même ses anomalies et plans du compte ; un autre tenant n'est pas compté.
- **`GET /restricted-resources`** : 401 ; 200 pour RM, Comité, Audit (listes identiques), 403 pour les 9 autres dont `adm` qui ne détient le droit que dans `users.roles` (PRIV-V3-01) ; pagination : pages de 4 disjointes qui reconstituent la liste complète dans l'ordre, offset hors liste = `[]`, défaut = liste entière, limite 500 acceptée ; 11 valeurs invalides (limit 0, 501, -1, abc, 1.5, vide, répété, Infinity ; offset -1, abc, 1.5) = 400, jamais 5xx. `lastChange` : null si jamais changé ; après un changement RM = auteur, motif, widening, date ISO ; le dernier de plusieurs gagne ; pour contrôle, KPI, plan, anomalie, risque (restriction par propriétaire = widening faux, retour = vrai) ; reflète aussi une ouverture RACI (q207) sans déborder sur une autre ressource ; auteur nommé (`userId`, `byName`) pour RM et Audit, jamais pour le Comité (PRIV-V3-05).
- **q212 groupe de département** : sans motif / vide / blanc / 501 / null / nombre => 400 et rien d'écrit ; motif de 500 caractères => 201, `PERMISSION_CHANGE` (entité Role, `through: DEPARTMENT_GROUP`, liste `opened` exacte `[ACTION_PLAN a06, CONTROL c02, KPI 9002, RISK 502]`), RM notifié une fois sans contenu, lecture immédiate, NOMINATIF reste fermé ; `opened` ne liste que ce que la personne ne lit pas déjà (responsable de processus : le plan seul ; RACI : le KPI seul) ; RM auteur : pas de motif, trace conservée (motif null), personne notifié ; rien ne s'ouvre (département sans ressource restreinte, rôle ordinaire) : pas de motif ni de trace, un motif inutile est accepté et non tracé ; course de 4 attributions identiques : un 201, trois 409, une trace, une notification ; auto-attribution refusée. Lien d'un rôle existant à un département (`PATCH /roles/:id`, SEC V3-01) : motif exigé, `opened` par détenteur, RM notifié.
- **q212 désignation** : propriétaire et N+1 sur un risque restreint, mêmes règles (400 sans motif, 200 avec ; ASSIGN + PERMISSION_CHANGE `through: DESIGNATION`, `as: owner / superior owner`, RM notifié une fois, message sans contenu) ; RM : pas de motif, trace, pas de notification ; rien ne s'ouvre (la personne lit déjà, risque CLIENT) : ni motif ni trace ; propriétaire d'un risque NOMINATIF : ouvre, motif exigé ; N+1 sur un risque NOMINATIF : n'ouvre rien, ni motif, ni trace, ni notification (corrigé) ; auto-désignation refusée.
- **Navigateur** : `out` voit sous les 5 listes « 2 éléments non visibles (accès restreint). », « 1 élément non visible », etc., égaux à l'API ; le RM n'en voit aucune ; le Comité a l'entrée « Ressources restreintes » et la liste (sans auteur dans l'API), `out` n'a ni entrée ni accès ; `adm` attribue le groupe Finance à `out` depuis « IAM · Rôles » : refusé sans motif (message affiché, aucune appartenance, `out` ne lit rien), accepté avec motif, `PERMISSION_CHANGE` tracé, lecture ouverte, comptage de `out` en baisse.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-V3-03 | MINOR | Attribution d'un groupe de département : l'appartenance est créée, puis la trace `PERMISSION_CHANGE` écrite à part. Si l'écriture de la trace échoue (500), l'appartenance reste : ouverture sans trace. La pose RACI (V2bis) et le changement de responsable de processus sont, eux, atomiques | déclencheur qui refuse `PERMISSION_CHANGE` pour le rôle ; `POST /roles/:id/assign {userId, reason}` => 500, `user_roles` garde la ligne | `it.fails` |
| QA-V3-04 | MINOR | Désignation propriétaire / N+1 : `risks.assignOwner` puis ASSIGN puis `PERMISSION_CHANGE` hors transaction. Échec de la trace => 500 et propriétaire déjà changé (lecture ouverte sans trace) | même méthode sur `POST /risks/:id/owner` | `it.fails` |

Les deux tiennent à une panne d'audit simultanée (même classe que les écarts déjà acceptés hors transaction pour l'audit simple), mais V2bis a déjà posé la norme atomique pour l'ouverture ; à aligner.

### Points à trancher (QA_CHALLENGE)

1. **Oracle par différence du compteur** (déjà vu par Security) : l'agrégat baisse quand un risque PERIMETRE passe NOMINATIF et quand une ressource est supprimée, ce qui permet à un lecteur attentif de deviner un changement de niveau ; non testé comme défaut (décision q196 assumée).
2. **Compteur figé à l'affichage** : `HiddenCountNotice` charge la valeur une fois par écran ; elle ne bouge pas si le périmètre de l'utilisateur change pendant la session (il faut changer d'écran).
3. **Motif exigé sans effet** : désigner un propriétaire sur un risque NOMINATIF ouvre ; mais pour un RACI sur NOMINATIF (V2bis) le motif est demandé alors que rien ne s'ouvre. Cohérence à confirmer.
4. **Rattachement de département comme lien de rôle** : couvert (SEC V3-01). Autres ouvertures restantes, non couvertes par q212 : l'ajout d'un utilisateur à un processus comme responsable est couvert (q207) ; la désignation du N+1 de processus ou d'un adjoint n'ouvre rien (vérifié en V2bis).

## 4. Non-régression

Trois tests V2bis mis à jour légitimement (les observations « un groupe de département s'attribue sans motif » et « le détenteur direct de `resourcevisibility.set` lit la liste » ne sont plus vraies, et la liste est ouverte au Comité et à l'Audit) ; la pagination de la requête est vérifiée par le test statique que A06 avait déjà adapté. Le test d'observation « 083 est la dernière migration » reste vrai (V3 sans migration). V1 et V2 live inchangés (V1 68/68, V2 141 + 6 `it.fails`).

## 5. Limites et suites

- L'arbre testé contient des correctifs non commités (SEC V3-01, PRIV-V3-01/05, N+1 NOMINATIF) : rejouer après commit ; les 2 `it.fails` à repasser en `it` quand QA-V3-03/04 seront corrigés (`QA_VIS3_LIVE=1 npx vitest run test/QA-visibility-v3.test.ts`).
- Non couvert : charge du comptage (4 sous-requêtes par type, pas de cache), RACI sur KPI (non supporté), archivage d'un risque parent dans le comptage des anomalies (point déjà noté par Security).

## Corrections (orchestrateur, 2026-11-01)

| Constat | Statut | Correction |
|---|---|---|
| QA-V3-03 | **CORRIGÉ** | `PostgresRoleRepository.assignToUser` écrit les lignes `ROLE_CHANGE` et `PERMISSION_CHANGE` (q212) dans la transaction de l'attribution (`assignAuditsInTransaction`) : un échec d'audit annule l'attribution. |
| QA-V3-04 | **CORRIGÉ** | `assignOwner` / `assignSuperiorOwner` : lignes `ASSIGN` et `PERMISSION_CHANGE` dans la transaction de la désignation (`runAudited` / `writeAudited`). |

Retest : les 2 `it.fails` repassés en `it`. Suites live V1 + V2 + V2bis + V3 (QA et niveau 1, `--no-file-parallelism`) vertes ; `npm test` : 2753 verts. Correction annexe d'un test niveau 1 qui supposait une base locale neuve (identifiant de requête unique).
