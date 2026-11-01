# SEC — Revue lot V2 visibilité des ressources (contrôles, anomalies, plans d'action, KPI)

Agent : A10 Security. Date : 2026-11-01. Branche `feat/r1-visibility-v2`, diff `origin/staging...HEAD` (b649fab, c4bd01f).
Méthode : revue statique complète du diff, `tsc --noEmit` vert, vitest `visibility-v2` + `QA-visibility-v0` (21 verts / 25 skip),
tests dynamiques sur PostgreSQL 16 LOCAL (base `grc_sec_vv2`, migrations 001..083, cluster 127.0.0.1:55442). Jamais Neon.

**Escalade HUMAN : aucune** (CVSS maximal 4,3). **Verdict : ORANGE.** Le modèle SQL et le gestionnaire de visibilité sont
solides, mais le niveau choisi à la création d'une anomalie ou d'un plan d'action est ignoré en base (V2-01, CONFIRMED).
Correctif trivial, à faire avant merge. Le reste est LOW ou INFO.

## 1. Ce qui passe (PASS)

- **083** : 4 fonctions `*_visible_to` + 3 aides, `LANGUAGE sql STABLE`, pas de SECURITY DEFINER (`prosecdef = f` vérifié),
  `search_path = pg_catalog, public, pg_temp` posé et répété par `ALTER FUNCTION` (vérifié dans `pg_proc.proconfig`).
  Tenant filtré partout. « Voit tout » = `user_roles` actifs + `roles.system_group`, jamais `users.roles`. Valeur inconnue
  ou lecteur NULL = invisible (fail-closed). NOMINATIF n'ouvre ni département, ni processus, ni RACI (I-3 respecté).
  Down : supprime les fonctions ; le code appelant échoue alors en 500, et les lignes non CLIENT restent invisibles pour le
  code V1 (fail-closed).
- **Filtre SQL** : `resourceVisibilityClause` dans le WHERE de `getById`/`list`/`listForRisk`/`listCoveringRisk` des 4
  racines ; id lecteur passé par `readerLiteral` (UUID validé avant interpolation) ; noms de fonctions et tables fixes.
  Aucun SQL brut sur ces tables hors de leurs dépôts.
- **`PostgresResourceAccessRepository`** : table issue d'une constante, `FOR UPDATE` sur la racine, retour à CLIENT =
  révocation de la liste relue sous verrou, révocation par `revoked_at` (pas de DELETE), `widening` calculé sur les
  lecteurs effectifs avant/après dans la même transaction que l'audit (`runAudited`).
- **`ResourceVisibilityManager`** : `get` filtré avant tout (404 identique), droit `resourcevisibility.set` ou propriétaire,
  motif 1–500 obligatoire, auto-ajout refusé, comptes ajoutés actifs et du tenant, ressource héritante refusée,
  notification RM si le propriétaire élargit, auteur = `actor.userId`. Routes : `z.guid()`, `boundedArray(…, 50)`,
  `reasonText(500)`. `visibility` retiré des corps UPDATE (pas d'assignation de masse).
- **Enfants** : exécutions, évaluations d'efficacité, preuves, mesures KPI suivent la racine (404/liste vide, règle
  « exécutant » respectée). Validations de liens (anomalie, plan, RACI, efficacité, exécution, mesure) en scope lecteur.
  `DashboardService` : plus aucun `SYSTEM_SCOPE` sur ces racines. Câblage `server.ts` vérifié (manager injecté dans les
  4 services, `controlRepository` dans `EvidenceService`).

## 2. Retest des résidus

| Résidu | Résultat | Détail |
|---|---|---|
| V0-04 (KPI, liens) | **RETEST_PASS** | `KpiService.requireKpi` et `KpiMeasureService` en scope lecteur ; liens CONTROL/ANOMALY/KRI en scope lecteur. Restent en `SYSTEM_SCOPE` : `FindingService` (domaine Audit, I-1, détenteurs Audit qui voient tout ; au pire un oracle d'existence si `audit.finding.create` est posé ailleurs) et `ProcessService.assertNoActiveReferences` (refus sans id). Acceptable. |
| V1-02 (périmètre d'un risque) | **RETEST_PASS** | `PostgresRiskRepository.update` verrouille la ligne et mesure `risk_visible_to` avant/après dans la transaction ; `perimeterWidening` alimente l'audit et la notification. Résidu INFO inchangé : la décision « risque restreint ? » est prise avant le verrou (fenêtre CLIENT→PERIMETRE concurrente, sans gain pour l'acteur). |
| V1-03 (anomalies/plans d'un risque restreint) | **RETEST_PASS** | `anomaly_visible_to` suit le risque puis le contrôle ; `action_plan_visible_to` suit la source RISK/CONTROL/KRI ; tableaux de bord et compteurs en scope lecteur. Hors spec : un plan simplement *lié* (`action_plan_links`) à un risque restreint n'hérite pas (ids masqués), conforme à §1. Voir V2-02 pour le trou « exécution seule ». |
| V1-05 (ids masqués dans les vues) | **RETEST_PASS** | Les contrôles eux-mêmes sont désormais filtrés dans vue 360 et contexte d'évaluation ; masquage des ids de risques conservé. |

## 3. Constats

### SEC V2-01 — Le niveau choisi à la création d'une anomalie ou d'un plan d'action n'est pas enregistré (MEDIUM, CVSS 4,3 `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED)

- Composants : `PostgresAnomalyRepository.create`, `PostgresActionPlanRepository.create` ; routes `POST /anomalies`,
  `POST /action-plans` (champ `visibility` accepté).
- Cause : les deux `INSERT` n'ont pas de colonne `visibility` (seuls contrôles et KPI l'écrivent). Le service exécute
  `assertCreation`, puis la base applique son défaut CLIENT. La réponse 201 renvoie `visibility: CLIENT`, sans erreur.
- Preuve (base locale) : `create({ …, visibility: "NOMINATIF" })` donne `anomaly created CLIENT` / `OUT reads anomaly: true`,
  et `plan created CLIENT` / `OUT reads plan: true` (OUT = compte sans lien ni droit étendu).
- Impact : une anomalie (fraude, RH) ou un plan créés « restreints » via l'API sont lisibles par tout porteur de
  `anomaly.read` / `actionplan.read` jusqu'à un `PUT /:id/visibility`. Atténuation : le frontend V2 n'envoie pas le niveau
  à la création (il passe par PUT après coup). Les tests niveau 1 utilisent des faux dépôts et ne pouvaient pas le voir.
- Recommandation (A06) : ajouter `visibility` aux deux INSERT ; test d'intégration sur PostgreSQL réel (créer NOMINATIF,
  relire avec un tiers : 404). Statut : **REMEDIATION_REQUIRED, bloquant pour le merge** (le contrôle annoncé échoue ouvert).

### SEC V2-02 — Une anomalie rattachée à une exécution seule n'hérite pas du contrôle (LOW, CVSS 3,1 `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED)

- `anomaly_visible_to` ne regarde que `risk_id` puis `control_id`. `AnomalyService.create` accepte `controlExecutionId`
  sans `controlId` et n'en déduit pas le contrôle. Une telle anomalie prend son propre niveau (CLIENT par défaut).
- Preuve : contrôle NOMINATIF, exécution, anomalie avec `control_execution_id` seul : `anomaly_visible_to(…, OUT) = t`.
- Impact : le texte rédigé par un exécutant ou un lecteur d'un contrôle restreint est lisible par tous (l'exécution reste
  masquée). Recommandation (A06) : dériver `controlId` de l'exécution à la création (et refuser une incohérence), ou
  faire suivre l'exécution dans `anomaly_visible_to` (A07). Statut : REMEDIATION_REQUIRED (non bloquant).

### SEC V2-03 — RACI et responsable de processus élargissent un PERIMETRE sans le circuit de visibilité (LOW, CVSS 3,1 `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`, CONFIRMED par SQL)

- Au niveau PERIMETRE, une affectation RACI (contrôle, plan, et déjà risque depuis V1) et le responsable du processus
  (contrôle, KPI, risque) ouvrent la lecture. `RaciAssignmentService.assign` (`raci.assign`) et l'affectation de
  responsable de processus (`process.responsibility.assign`) n'exigent ni `resourcevisibility.set`, ni motif, ni ligne
  `PERMISSION_CHANGE`/`widening`, ni notification. Preuve : contrôle PERIMETRE, OUT non lecteur (`f`), insertion RACI `I`,
  OUT lecteur (`t`).
- Atténuation : par défaut ces droits ne sont qu'au groupe RM (qui voit tout et détient `resourcevisibility.set`) ; le
  risque n'existe que si un rôle ordinaire reçoit `raci.assign` ou `process.responsibility.assign`. L'affectation RACI
  reste auditée (CREATE).
- Même famille que V1-02 (leçon V1 : tout écrivain d'un attribut de périmètre est un écrivain de visibilité), non vu en V1
  pour la RACI. Recommandation : décision HUMAN (accepter, la RACI étant par conception un attribut de périmètre, spec §3)
  ou A06 (sur une cible non CLIENT : motif + `PERMISSION_CHANGE` avec `widening` + notification RM, ou réserver à
  `resourcevisibility.set`). Statut : REVIEW_REQUIRED (HUMAN).

### SEC V2-04 — Changement de département/processus d'un contrôle ou KPI restreint hors transaction (LOW, CVSS 2,2 `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N`)

- Interprétation signalée par A06, confirmée : UPDATE, audit UPDATE et `PERMISSION_CHANGE` sont trois écritures
  séparées ; lecteurs mesurés avant/après sans verrou. Un échec d'audit laisse un changement de périmètre sans trace ;
  une écriture concurrente fausse `widening`. Seul le groupe RM peut le faire (pas de propriétaire), d'où PR:H.
- Recommandation (A06, dette, même famille que F7S6-01) : passer `ControlRepository.update`/`KpiRepository.update` à
  `runAudited` quand le périmètre change, comme `PostgresRiskRepository.update`. Statut : ACCEPTABLE en dette tracée.

## 4. Interprétations signalées par A06

| Point | Avis A10 |
|---|---|
| I-6 déclarant / responsable = propriétaire ; responsable lit son plan même source masquée ; exécutant lit son exécution et ses preuves | **Acceptable** : conforme à spec §1 (« ce qui m'est assigné ») et §5. Élargissement par le propriétaire notifié au RM. Une ressource héritante refuse tout réglage propre. |
| Contrôle et KPI : RM seul | **Acceptable** : pas de compte propriétaire (I-4). À revoir si `executor`/`owner` deviennent des FK `users`. |
| Périmètre contrôle/KPI non transactionnel | **À corriger en dette** : V2-04. |
| Création : niveau seul, liste par PUT | **Acceptable** une fois V2-01 corrigé. NOMINATIF à la création reste de fait réservé aux « voit tout » (contrôle, KPI) ou au propriétaire (anomalie, plan), ce qui est fail-closed. |
| `FindingService`, `ProcessService` en SYSTEM_SCOPE | **Acceptable** (voir retest V0-04). |
| Preuve sans exécution = CLIENT | **Acceptable** : spec §1, niveau 1. |
| Faux dépôts sans `getById` = aucun contrôle restreint | **Acceptable pour les tests**, INFO : convention fail-open au câblage (cf. V0-01). Le vrai `ControlRepository` a toujours `getById` ; recommander un test de garde qui échoue si le service est construit en production sans dépôt complet. |

## 5. INFO

- `action_plan_visible_to` source KRI : `COALESCE(…, true)` ne joue que pour un `source_id` KRI orphelin (`kris.risk_id`
  est NOT NULL) ; un KRI archivé reste suivi via son risque. Acceptable.
- `GET /:id/visibility` donne la liste nominative (avec noms) à tout lecteur de la ressource : même choix que V1 (q192).
- Suspendus : les fonctions ne testent pas `users.deleted_at`, mais un suspendu ne s'authentifie pas (`lookupMembership`).

## 6. Statut et propriétaires

V2-01 **REMEDIATION_REQUIRED, bloquant** (A06, retest A10). V2-02 REMEDIATION_REQUIRED (A06/A07). V2-03 REVIEW_REQUIRED
(HUMAN, puis A06). V2-04 dette acceptée sous réserve de tracking (A06). V0-04, V1-02, V1-03, V1-05 : RETEST_PASS.
Verdict : **ORANGE**, VERT après correction et retest de V2-01. CLOSED ne vaut pas validation Risk, Compliance ou Privacy.
