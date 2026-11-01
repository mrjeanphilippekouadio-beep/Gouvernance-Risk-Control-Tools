# QA — Visibilité des ressources, lot V1 (2026-11-01)

TASK : revue QA (A08) du lot V1, branche `feat/r1-visibility-v1`, tête `ae07c61` (DECISION-100/102/103/104, migrations 081 et 082).
Ce verdict est un verdict QA : ce n'est ni un avis Security, ni Privacy, ni Compliance, ni une acceptation de risque.

**STATUS : PARTIAL_PASS** — aucun défaut BLOCKER ; 1 MAJOR (hérité de V0/staging, CORS), 1 MAJOR de contrat (oracle RACI), 3 MINOR/INFO.

## 1. Ce qui a été exécuté

| Niveau | Fichier | Résultat |
|---|---|---|
| Backend niveau 2 (VRAI serveur tsx + HTTP + PostgreSQL 16 local) | `backend/test/QA-visibility-v1.test.ts` | 65 PASS + 3 `it.fails` (= défauts) ; 5 tests statiques sans base |
| Régression QA-V0 (en mémoire + PG réel) | `backend/test/QA-visibility-v0.test.ts` | 33/33 avec PG, 15/15 sans |
| Suite backend complète | `npm test` | 2684 pass, 380 skipped (PG), 0 fail ; `npm run typecheck` OK |
| Build frontend | `npm run build` | OK |
| Navigateur (Chromium) | `tests/integration/qa-visibility-v1-playwright.mjs` | 38/38 PASS |

Environnement : PostgreSQL 16.15 LOCAL (`127.0.0.1:55442`, jamais Neon), migrations 001..082, backend réel `AUTH_PROVIDER=local`, Drive remplacé en mémoire (préchargement F7-S1). Outillage : `tests/integration/qa-visibility-v1-{setup.sh,server.sh,seed.sql}`. Le test vitest est ignoré sans `QA_VIS1_LIVE=1` (CI inchangée). Oracles écrits avant exécution ; aucun résultat attendu modifié pour obtenir un PASS (les corrections de mon propre test sont tracées en §6).

Jeu de données : 12 comptes de même droits de lecture (seul le niveau change le résultat), 3 risques (CLIENT, PERIMETRE, NOMINATIF) portant chacun une évaluation, une décision de traitement, un KRI et sa mesure, une escalade, un RACI, un contrôle, une anomalie et un plan d'action. Chaque texte « CANARY-<niveau>-… » sert d'oracle de fuite.

## 2. Fuites : 12 profils x 2 risques restreints x toutes les routes (LEAK)

Profils : propriétaire, N+1, RACI, responsable du processus, membre du groupe du département, personne nommée, 1re ligne hors périmètre, membre du groupe d'un AUTRE département, Risk Manager, Comité, Audit, administrateur sans le droit A3 (muni en plus de `resourcevisibility.set` en direct).

Attendu (et constaté) : PERIMETRE = propriétaire, N+1, RACI, responsable du processus, groupe du département, liste ; NOMINATIF = propriétaire + liste ; RM, Comité, Audit voient tout ; l'administrateur et le hors périmètre ne voient ni l'un ni l'autre.

PASS pour chaque profil sur : liste du registre (ids exacts), fiche, `/raci`, `/360`, `/visibility`, évaluations (liste, id), décisions de traitement, KRI (liste, tableau de bord, id, rapport consolidé), mesures, cartographie (3 variantes), tableau de bord (risques, exécutif), rapports (consolidé, comité), `risk-owners`, `?ownerId=`. Un id masqué répond **exactement** comme un id inconnu (statut + corps, id substitué) ; les routes d'écriture visant un risque masqué (évaluation, KRI, RACI, lien KRI) aussi. Les compteurs (`totalActiveRisks`, `riskCount`) = 1 + risques lisibles pour les 12 profils. `notifications` : rien ; `audit-log` : 403 pour 11 profils sur 12, 200 pour Audit seul. Sans jeton / jeton forgé : 401. Autre tenant : `risk_visible_to` faux. Siège révoqué, groupe supprimé, rôle simplement NOMMÉ « Risk Manager » : n'ouvrent rien (fonction SQL réelle).

Inventaire statique (INV) : toute lecture `getById`/`list` du dépôt de risques dans `services/` porte une portée ; les seules lectures sans portée sont 6 `listByIds` de vérification d'existence (ControlService, DashboardScopeResolver x2, KriService x3). Exports / recherche : il n'existe pas de route d'export ni de recherche de risques (NOT_APPLICABLE) ; l'import Excel ne lit rien et crée en CLIENT (vérifié statiquement).

**Instantané QA-V0** : il listait encore des lectures de risque, à tort : son heuristique (« le mot visibility dans l'appel ») les comptait comme des trous alors qu'elles passent par `readerScope()`. Je les ai sorties de l'inventaire (`if (m[1] === "risks") continue`) ; il ne reste que contrôles / anomalies / plans d'action / KPI (V2), comptes recalculés depuis le code. Le harnais PG de V0 a dû être adapté (modèle 001..079 ; 081/082 appliquées après 080 pour les tests VIS).

Mutation testing : (a) `hiddenRiskIds` neutralisé : 11 tests rouges ; (b) `riskVisibilityClause` neutralisée : 31 rouges ; (c) clause enfant seule neutralisée : 0 rouge, car la couche service (`hiddenIds`) couvre les mêmes lectures (défense en profondeur redondante, INFO, rien à corriger).

## 3. Changement de visibilité (CHG) — tout PASS

Création : niveau + liste enregistrés avec le CRÉATEUR comme auteur (un `grantedBy` client est ignoré) ; auto-ajout refusé ; liste sur CLIENT refusée ; niveau inconnu, null, non-uuid, 51 ids, compte inconnu ou suspendu : 400 ; créateur qui ne verrait pas le risque : 400 (NOMINATIF hors liste, PERIMETRE hors périmètre) ; défaut CLIENT ; même clé d'idempotence avec un autre niveau refusée, rejeu identique accepté.
Modification : lecteur ni propriétaire ni RM = 403 ; non-lecteur = 404 (y compris l'administrateur muni du droit en direct) ; non authentifié = 401 ; Comité et Audit = 403. Motif absent, vide, blanc, tab/retour ligne, 501 caractères, non-chaîne : 400, rien modifié, rien audité ; 500 caractères accepté. Auto-ajout (propriétaire et RM) refusé. `revokeUserIds` retire l'accès immédiatement avec révocateur et motif sur la ligne. Une ligne `PERMISSION_CHANGE` par changement (motif, avant/après, `widening`). Retour à CLIENT : liste révoquée, elle ne revient pas à la restriction suivante. Notification `RISK_VISIBILITY_WIDENED` : seulement quand le propriétaire élargit (niveau plus ouvert ou nom ajouté), jamais quand il restreint ni quand le RM élargit, sans contenu du risque, un échec de notification n'annule pas le changement. Double appel identique : pas de doublon de droit actif. Concurrence propriétaire / RM : état final cohérent (niveau = un des deux, liste = grants actifs, 0 grant actif sous CLIENT). `PATCH /risks/:id` ne change pas le niveau.

## 4. q203 — `audit.read` réservé au groupe Audit : PASS

Création et modification (HTTP) d'un rôle ordinaire portant `audit.read` : 400 ; tout `PATCH` sur les groupes Risk Manager / Comité avec `audit.read` : refusé (< 500) ; `GET /audit-log` : 403 pour les 11 profils non-Audit sur 4 filtres, 200 pour Audit. Aucun chemin `users.roles` direct (les comptes se créent par id de rôle). Migration 081 sur une base 080 : retire le droit des rôles ordinaires (supprimés compris) et de `users.roles`, une ligne d'audit par rôle/compte (`migration:081`, compte technique suspendu), épargne le groupe Audit et `audit.mission.read`, idempotente, `down` ne fait qu'oublier l'enregistrement (ne restaure pas), `up` suivant ne fait rien ; aucun compte technique créé dans un tenant sans rien à retirer. Migration 082 : up / down / up, fonction `risk_visible_to` avec `search_path` épinglé, droit `resourcevisibility.set` ajouté au seul groupe Risk Manager (pas au Comité), audité par `migration-082@system.invalid` suspendu, retiré par le down, niveaux déjà posés conservés.

## 5. Parcours navigateur (PostgreSQL 16 local) : 38/38

Création d'un risque « Restreint au périmètre » avec une personne nommée dans le formulaire (badge au registre, audit CREATE avec liste) ; invisible pour un compte hors périmètre : registre, cartographie, fiche (404 identique), tableau de bord (1 risque actif contre 4 pour le RM) ; visible pour la personne nommée, le RM, le Comité, l'Audit ; propriétaire désigné ; fiche : carte « Visibilité » ; modification par le RM : « Enregistrer » inactif sans motif ou avec motif blanc, niveau « Personnes nommées », audit avec motif, le groupe du département perd la ligne, la personne nommée la garde ; propriétaire : auto-ajout refusé (message affiché), bandeau « retire toute la liste » avant validation, « Tout le client », liste purgée, le compte hors périmètre voit la ligne ; la cloche du RM affiche « Visibilité d’un risque élargie par son propriétaire » sans contenu du risque, rien chez Comité et Audit ; 0 erreur JS, 0 erreur console imprévue. Captures dans `qa-shots/` (non versionnées).

## 6. Défauts et constats

| ID | Sév. QA | Constat | Preuve / action |
|---|---|---|---|
| QA-VIS1-01 | MAJOR | `GET /raci?entityType=RISK&entityId=<id masqué>` répond 404 « Risk <id> not found », alors qu'un id inconnu répond 200 `{"data":[]}` : oracle d'existence, contraire à « 404 identique à un id inconnu » (DECISION-102). `RaciAssignmentService` (lecture portée) mais route de liste non alignée. | `it.fails` « QA-VIS1-01 ». Dev Backend : répondre pareil pour les deux (404 pour les deux ou liste vide pour les deux). À voir par Security. |
| QA-VIS1-02 | MINOR | Les contrôles (`coveredRiskIds`), anomalies (`riskId`, `/dashboard/anomalies`) et plans d'action (`/actions`, `/:id/links`) lisibles par un hors périmètre contiennent l'id des risques masqués. Aucun texte, mais l'existence et l'id fuient. Ce sont des racines CLIENT jusqu'au lot V2. | `it.fails` « QA-VIS1-02 » + test de périmètre (aucun CANARY ni description) qui passe. Architecte : confirmer que V2 filtre ces ids, sinon filtrer maintenant. À voir par Security. |
| QA-VIS1-03 | MINOR | `GET /risk-evaluations/:id/context` d'une évaluation d'un risque masqué répond « Risk <id du risque> not found » : autre entité que pour un id inconnu (« RiskEvaluation … ») et l'id du risque masqué est divulgué. Les autres routes d'évaluation sont conformes. | `it.fails` « QA-VIS1-03 ». |
| QA-VIS1-04 | INFO | La notification d'élargissement part à tout détenteur de `resourcevisibility.set`, y compris un compte qui ne lit pas le risque (id du risque dans la notification). Atteignable seulement par un droit posé en direct en base (RoleService le refuse hors groupe RM). | Observation ; Security à voir. |
| QA-VIS1-05 | MAJOR (hérité, hors V1) | La liste CORS (`server.ts:190`, `allowedHeaders: Authorization, Content-Type`) n'inclut pas `Idempotency-Key` : en inter-origines le navigateur bloque `POST /risks` (« Failed to fetch »), donc le formulaire de création avec visibilité est inutilisable si front et API n'ont pas la même origine. Identique sur `origin/staging`. | Contournement TEST (préflight répondu par Playwright), production non touchée. A vérifier : le déploiement est-il bien en même origine ? Sinon DevOps / Dev Backend. |
| QA-VIS1-06 | INFO | Un créateur de 1re ligne hors du groupe du département ne peut pas créer un risque PERIMETRE (le propriétaire n'est pas encore posé) : message anglais « You would not see this risk yourself… » affiché tel quel à l'écran. Comportement conforme à la règle, message à traduire. | Observation UX. |

Corrections de MON test, tracées : (1) `/risk-evaluations/:id/context` prend un id d'évaluation (j'avais d'abord supposé un id de risque) ; (2) l'id demandé est repris dans l'erreur d'une route à paramètre : l'assertion « l'id n'apparaît pas » ne porte que sur les routes sans id dans l'URL, la comparaison à l'id inconnu couvre les autres ; (3) le créateur d'un risque PERIMETRE doit être dans le groupe du département (règle du service) ; (4) les destinataires de la notification incluent `adm` à cause du droit direct de mon jeu de données (QA-VIS1-04), retiré dans le parcours navigateur.

## 7. Revues requises

- SECURITY_REVIEW_REQUIRED : oui (QA-VIS1-01, -02, -03, -04, -05). Je ne qualifie aucun de ces points de vulnérabilité.
- PRIVACY_REVIEW_REQUIRED : oui (ids de risques masqués dans les contrôles / anomalies / plans, notification à un non-lecteur).
- COMPLIANCE_REVIEW_REQUIRED : non déclenché par ces tests.
- RISK_REVIEW_REQUIRED : non.
- RETEST_REQUIRED : oui après correction de QA-VIS1-01 à -03 (retirer les marqueurs `it.fails`) ; relance du parcours navigateur après QA-VIS1-05.

## 8. Reproduire

```
bash tests/integration/qa-visibility-v1-setup.sh up              # cluster PG16 local 127.0.0.1:55442 + base + jeu
cd backend && QA_VIS1_LIVE=1 npx vitest run test/QA-visibility-v1.test.ts      # démarre/arrête lui-même le serveur (port 8098)
QA_VIS_PGHOST=<dossier socket> QA_VIS_PGPORT=55442 npx vitest run test/QA-visibility-v0.test.ts
QA_PORT=8099 bash tests/integration/qa-visibility-v1-server.sh start ; (frontend) VITE_AUTH_PROVIDER=local VITE_API_BASE_URL=http://127.0.0.1:8099 vite --port 5198
node tests/integration/qa-visibility-v1-playwright.mjs
```
