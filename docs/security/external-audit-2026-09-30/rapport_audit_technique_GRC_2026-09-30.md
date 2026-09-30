# Rapport d'audit technique global — Gouvernance Risk & Control Tools

**Date de la revue :** 30 septembre 2026  
**Dépôt :** `mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools`  
**Branche examinée :** `feature/dashboard-scope-resolver`  
**Commit HEAD examiné :** `81c41db6477f50cef38f0fe520d347685ea77f7c`  
**Branche de base :** `main` — commit de base PR : `766f5a3092362579ea77246438356c0124378a3f`  
**PR :** [#27 — dashboard.executive: configurable RACI-derived scope](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/pull/27)  
**Périmètre :** nouvelle application web/backend GRC, endpoints, services, repositories, migrations PostgreSQL, fichiers/preuves, CI/CD.  
**Exclusion :** `apps-script-legacy/`, ancien système remplacé.

## 1. Synthèse exécutive

La revue a combiné une lecture du code de la branche de PR, l’examen des tests associés, la lecture des logs d’un workflow GitHub Actions lié au commit et une vérification des règles du pipeline.

### Résultats vérifiables

- Le workflow GitHub Actions associé au commit s’est terminé avec le statut **success**.
- Backend : `npm run typecheck` a terminé sans erreur et `npm test` a rapporté **43 fichiers de test et 562 tests réussis**.
- Frontend : les builds de `@djamo/design-system` et `@grc-tools/frontend` ont réussi.
- Trivy : le job a terminé avec succès et son journal indique `Clean (no security findings detected)` pour le scan de vulnérabilités configuré. Cela ne couvre pas tous les types de risques ni les vulnérabilités de logique métier.
- Semgrep : **425 fichiers analysés, 50 règles exécutées, 8 findings rapportés dont 8 marqués blocking**. Toutefois, l’étape Semgrep est configurée avec `continue-on-error: true` : le pipeline peut rester vert malgré ces findings. La liste détaillée de ces 8 résultats doit être triée à partir de l’artefact SARIF.

**Limite importante :** les tests ci-dessus ont été exécutés par GitHub Actions et leurs logs ont été consultés. Je n’ai pas lancé un nouveau clone/build/test dans un runtime local indépendant, ni exécuté de DAST contre une application déployée. Il s’agit d’une revue statique partielle accompagnée de preuves CI, pas d’un pentest complet.

## 2. Résumé des constats

| ID | Constat | Statut de preuve | Gravité proposée | Action |
|---|---|---|---|---|
| AUD-01 | Les KRI restent hors périmètre dans certaines vues exécutives et rapports, même si le risque est filtré | Confirmé par inspection du code de la branche | **P0 — bloquant avant fusion** | Appliquer le scope aux KRI et agrégats dans chaque endpoint concerné |
| AUD-02 | Une affectation RACI ne vérifie pas explicitement que l’utilisateur destinataire est actif et appartient au même tenant | Confirmé comme absence de garde dans le service et le schéma examiné | **P1 — élevé** | Valider le destinataire côté serveur et renforcer l’intégrité en base |
| AUD-03 | L’écriture métier et l’écriture de l’audit sont séparées ; une panne de l’audit après la mutation peut laisser une opération sans événement correspondant | Confirmé par l’ordre des appels dans les services examinés | **P1 — élevé** | Transaction commune ou mécanisme fiable de journalisation/compensation |
| AUD-04 | Le journal d’audit est décrit comme append-only par convention, mais la migration précise que les droits DB ne bloquent pas encore UPDATE/DELETE | Confirmé par commentaire explicite de la migration | **P1 — élevé** | Rôle runtime limité à INSERT/lecture autorisée ; contrôle séparé pour migrations |
| AUD-05 | Semgrep rapporte 8 findings, dont 8 blocking, mais son étape n’est pas bloquante | Confirmé par logs CI et workflow | **P1 — élevé pour la gouvernance CI** | Trier les 8 findings et mettre en place un seuil de blocage/dérogation |
| AUD-06 | Le job frontend supprime le lockfile et installe avec `npm install --package-lock=false` | Confirmé par workflow CI | **P2 — modéré** | Rendre l’installation reproductible sur Linux sans supprimer le lockfile |
| AUD-07 | Le flux de preuve utilise un stockage Multer en mémoire et transmet le MIME déclaré ; aucune validation de signature de fichier n’apparaît dans le service consulté | Observation confirmée dans le flux inspecté ; contrôle éventuel ailleurs non vérifié | **P2 — à confirmer** | Vérifier le stockage complet, ajouter détection de type réel et protections anti-abus si absentes |
| AUD-08 | Tests négatifs manquants ou non démontrés pour les KRI des vues exécutives et rapports | Confirmé dans les tests de scope consultés : le test dédié porte sur `getKriConsolidated` | **P1 — élevé** | Ajouter des tests de régression pour chaque endpoint qui expose des KRI/agrégats |

Les niveaux P0/P1/P2 sont des propositions de triage. Ils ne remplacent pas la décision finale du responsable sécurité/risques après analyse de l’impact réel et des protections compensatoires.

---

## 3. Constats détaillés et preuves

### AUD-01 — Les KRI ne sont pas tous filtrés selon le scope du dashboard

**Gravité proposée : P0 — bloquant avant fusion**

**Preuve dans le code :**

- `DashboardService.getExecutiveView()` calcule le scope des risques mais charge aussi `getAllKriSummaries(actor.tenantId)`, puis construit `criticalKris` à partir de cette liste non filtrée.
- `getRiskCommitteeReport()` utilise également `getAllKriSummaries(actor.tenantId)` pour `krisInAlert`.
- `getConsolidatedReport()` charge les KRI du tenant complet et utilise leur catégorie/entité pour calculer `criticalKriCount`.
- La PR contient un correctif de filtrage pour `getKriConsolidated()`, et un test négatif dédié à cet endpoint. Ce correctif ne suffit pas à sécuriser les trois autres chemins ci-dessus.

**Impact potentiel :** un utilisateur en mode `DEPARTMENT` ou `PROCESS` peut recevoir des KRI/alertes ou des totaux associés à des risques hors de son périmètre, dans le même tenant.

**Liens de preuve :**
- [DashboardService.ts — branche feature/dashboard-scope-resolver](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/DashboardService.ts)
- [Tests DashboardService](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/test/DashboardService.test.ts)
- [PR #27](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/pull/27)

**Correction attendue :**
1. Résoudre le scope une fois côté serveur.
2. Construire l’ensemble des `riskIds` autorisés.
3. Filtrer les KRI en base par ces IDs dans les vues exécutives, le rapport comité et le rapport consolidé.
4. Vérifier que les alertes, nombres, regroupements, tendances et exports utilisent la même liste filtrée.
5. Traiter explicitement `riskIds = []` comme un résultat vide : ne jamais passer un tableau vide à une méthode où il signifie « pas de filtre ».
6. Ajouter des tests négatifs pour les trois endpoints concernés, avec un KRI en département A et un KRI en département B.

**Critère de clôture :** les utilisateurs restreints ne voient ni les KRI hors périmètre ni leur contribution aux agrégats. Le test doit vérifier les lignes et les totaux.

### AUD-02 — Affectation RACI sans validation explicite du tenant de l’utilisateur destinataire

**Gravité proposée : P1 — élevée**

**Preuve dans le code :**

- `RaciAssignmentService.assign()` valide la permission et l’existence de l’objet métier, puis vérifie le conflit R/A avant d’enregistrer l’affectation.
- Le service ne reçoit pas de `UserRepository` et ne vérifie pas que `targetUserId` désigne un utilisateur actif du même tenant.
- La migration RACI a une FK `user_id REFERENCES users(id)`, mais pas de contrainte composite reliant `raci_assignments.tenant_id` au `tenant_id` du destinataire.

**Impact potentiel :** une affectation RACI peut référencer un utilisateur d’un autre tenant si son identifiant est connu et que la FK globale existe. L’impact direct sur la confidentialité n’est pas établi par cette seule inspection ; le défaut d’intégrité inter-tenant, lui, est plausible et doit être empêché.

**Liens de preuve :**
- [RaciAssignmentService.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/RaciAssignmentService.ts)
- [Migration 027 — raci_assignments](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/database/postgresql/migrations/027_raci_assignments.sql)
- [Tests RaciAssignmentService](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/test/RaciAssignmentService.test.ts)

**Correction attendue :** vérifier côté service que l’utilisateur destinataire existe, n’est pas désactivé/supprimé et appartient au tenant de l’objet. Ajouter un test inter-tenant et un test utilisateur inactif. Étudier une contrainte DB composite ou un modèle relationnel qui rend impossible cette incohérence même en cas de défaut applicatif.

### AUD-03 — Risque de mutation métier sans trace d’audit correspondante

**Gravité proposée : P1 — élevée**

**Preuve dans le code :**

- Dans `RaciAssignmentService`, la mutation `raci.create(...)` ou `raci.remove(...)` est exécutée avant `audit.record(...)`.
- Dans `EvidenceService`, l’upload vers le stockage puis la création de l’enregistrement précèdent `audit.record(...)`. La suppression logique et l’appel au stockage précèdent aussi la création de l’événement d’audit.
- `PostgresAuditRepository.record()` exécute son propre `pool.query(INSERT...)`. Les extraits consultés ne démontrent pas que la mutation métier et l’écriture de l’audit partagent la même transaction.

**Impact potentiel :** si l’écriture de l’audit échoue après la mutation, l’opération peut avoir réussi sans trace d’audit correspondante. Cela affecte la preuve, l’investigation et la reconstitution d’actions sensibles.

**Liens de preuve :**
- [RaciAssignmentService.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/RaciAssignmentService.ts)
- [EvidenceService.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/EvidenceService.ts)
- [PostgresAuditRepository.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/infrastructure/database/postgres/PostgresAuditRepository.ts)

**Correction attendue :** pour les mutations DB, inclure l’écriture métier et l’événement d’audit dans une transaction commune. Pour les opérations externes (Google Drive), définir une stratégie fiable de compensation/outbox ou un état de traitement permettant de détecter et réparer les opérations non auditées. Ajouter un test injectant volontairement une panne d’audit.

### AUD-04 — Caractère append-only de l’audit non garanti par les droits PostgreSQL

**Gravité proposée : P1 — élevée**

**Preuve dans la migration :** `database/postgresql/migrations/004_audit_log.sql` précise que le journal est append-only par convention et que ce n’est pas encore imposé au niveau des rôles DB (`no REVOKE UPDATE/DELETE`).

**Impact potentiel :** un compte DB possédant des privilèges de modification peut altérer ou supprimer les traces, ce qui affaiblit la valeur probante du journal.

**Lien de preuve :**
- [Migration 004 — audit_log.sql](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/database/postgresql/migrations/004_audit_log.sql)

**Correction attendue :** utiliser un rôle runtime distinct des rôles de migration, lui accorder uniquement les droits requis (notamment INSERT et lecture selon le besoin), retirer UPDATE/DELETE, vérifier les privilèges effectifs en staging et documenter un mécanisme d’administration contrôlé.

### AUD-05 — Le pipeline signale des findings Semgrep sans bloquer la CI

**Gravité proposée : P1 — gouvernance de sécurité**

**Preuve dans le workflow et les logs :**

- `.github/workflows/ci.yml` configure Semgrep avec `continue-on-error: true`.
- Le journal du run `36687475276` rapporte 425 fichiers suivis analysés, 50 règles exécutées et 8 findings, dont 8 « blocking ».
- Le job a néanmoins terminé avec succès, ce qui est cohérent avec la configuration non bloquante.
- Le SARIF a été téléversé en artefact. Les 8 findings doivent être triés individuellement ; leur gravité technique ne peut pas être déduite du seul compteur.

**Liens de preuve :**
- [Workflow CI](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/main/.github/workflows/ci.yml)
- [Run GitHub Actions #36687475276](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/actions/runs/36687475276)
- [Artefact SARIF Semgrep](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/actions/runs/36687475276/artifacts/11084746276)

**Correction attendue :** examiner les 8 findings, documenter les faux positifs, corriger les résultats valides, puis activer un seuil bloquant ou un mécanisme de dérogation explicite (propriétaire, justification, expiration). Ne pas assimiler « job vert » à « zéro finding ».

### AUD-06 — Installation frontend non verrouillée dans la CI

**Gravité proposée : P2 — modérée**

**Preuve :** le workflow supprime `package-lock.json` puis exécute `npm install --package-lock=false`, malgré la présence d’un lockfile dans le dépôt. Le commentaire du workflow explique la motivation liée aux dépendances natives spécifiques à l’OS ; cela explique la décision, mais ne rend pas la résolution des dépendances strictement reproductible.

**Lien de preuve :**
- [Workflow CI](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/main/.github/workflows/ci.yml)

**Correction attendue :** résoudre le problème de lockfile de manière reproductible sur Linux et utiliser une installation verrouillée. Valider que l’artefact testé est celui qui sera livré.

### AUD-07 — Validation des fichiers : couverture à confirmer

**Gravité proposée : P2 — à confirmer**

**Preuve dans le flux inspecté :** la route utilise Multer `memoryStorage()` avec une limite de 25 MiB et transmet `originalname`, `mimetype` déclaré et `buffer` à `EvidenceService`. Le service vérifie la présence, la taille et le rattachement tenant de l’objet métier, mais ne montre pas lui-même de validation de signature du contenu ni d’analyse antivirus.

**Lien de preuve :**
- [evidences.routes.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/api/v1/evidences.routes.ts)
- [EvidenceService.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/EvidenceService.ts)

**Réserve :** l’absence de validation dans ces deux fichiers ne prouve pas que le stockage externe ne réalise aucune vérification. Il faut inspecter l’implémentation de `DocumentStorage`/Google Drive et la configuration de déploiement.

**Tests à ajouter :** MIME déclaré différent de la signature réelle, extension trompeuse, fichier vide, fichier dépassant la limite, nom hostile, contenu actif, uploads concurrents et panne Drive. Valider également une politique de quarantaine/antivirus si elle est requise par le risque.

### AUD-08 — Couverture de tests de périmètre incomplète pour les KRI

**Gravité proposée : P1**

Le test de régression ajouté dans `DashboardService.test.ts` démontre que `getKriConsolidated()` filtre les KRI hors périmètre et traite le scope vide en mode fail-closed. En revanche, le code consulté montre que les vues exécutives, le rapport comité et le rapport consolidé continuent d’utiliser des synthèses KRI globales. Les tests devraient reproduire les mêmes jeux de données à deux départements pour chacune de ces méthodes.

**Lien de preuve :**
- [DashboardService.test.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/test/DashboardService.test.ts)

---

## 4. Résultats des tests réellement exécutés

Source : logs du workflow GitHub Actions `36687475276`, associé au commit de la PR examinée.

| Contrôle CI | Résultat observé | Interprétation |
|---|---|---|
| Backend `npm run typecheck` | Succès | Pas d’erreur de type rapportée par cette exécution |
| Backend `npm test` | **562 tests réussis, 43 fichiers de test** | Suite existante réussie sur ce commit |
| Build `@djamo/design-system` | Succès | Build frontend du design system réussi |
| Build `@grc-tools/frontend` | Succès | Build frontend principal réussi |
| Semgrep `p/ci` | 425 fichiers, 50 règles, **8 findings dont 8 blocking** | Analyse terminée, findings à trier ; étape non bloquante |
| Trivy — vulnérabilités HIGH/CRITICAL | Scan configuré terminé avec succès, journal indiquant « Clean » | Aucun résultat HIGH/CRITICAL signalé par ce scan ; cela ne garantit pas l’absence de défauts applicatifs |
| DAST / tests runtime sur staging | Non exécutés dans cette campagne | Environnement et autorisations de test non fournis |
| PostgreSQL réel, droits DB, restauration | Non exécutés dans cette campagne | Nécessitent un environnement de test et une configuration accessibles |

**Lecture correcte du résultat :** 562 tests réussis signifie que les tests présents passent ; cela ne prouve pas que toutes les surfaces de sécurité sont couvertes. Les findings Semgrep restent ouverts tant qu’ils ne sont pas examinés.

## 5. Points positifs observés

- L’authentification Google utilise `verifyIdToken` avec une audience attendue et exige un email vérifié.
- Les rôles et le tenant proviennent de la base applicative, et non des claims arbitraires du client.
- Les repositories consultés utilisent des requêtes SQL paramétrées et des filtres `tenant_id` sur les opérations montrées.
- Les services contrôlent plusieurs droits via `requirePermission`.
- Le nouveau résolveur de scope prévoit explicitement qu’un périmètre vide ne doit pas revenir à GLOBAL.
- Le correctif KRI dédié utilise un filtre repository par IDs de risques, et un test négatif couvre le cas département hors scope.
- La limite d’upload de 25 MiB est définie ; la validation du type réel et la résistance aux uploads concurrents restent à confirmer.

## 6. Plan de remédiation recommandé

### Avant fusion de la PR #27
1. Corriger les trois chemins KRI non filtrés (`getExecutiveView`, `getRiskCommitteeReport`, `getConsolidatedReport`).
2. Ajouter des tests négatifs avec deux départements et comparer les lignes **et les agrégats**.
3. Valider que l’affectation RACI refuse un utilisateur inactif ou d’un autre tenant.
4. Trier les 8 findings Semgrep et décider d’un seuil CI bloquant.

### Avant mise en production
5. Définir une transaction ou une stratégie outbox/compensation pour les opérations critiques et leur audit.
6. Restreindre les privilèges SQL de l’application sur `audit_log`.
7. Vérifier le pipeline complet de validation des preuves et les limites de mémoire/concurrence.
8. Rendre l’installation frontend reproductible et verrouillée.
9. Exécuter les tests DAST/API sur un staging autorisé.
10. Tester une restauration réelle de PostgreSQL et les documents nécessaires, puis mesurer RPO/RTO.

## 7. Matrice de re-test

| ID | Test de re-test | Précondition | Résultat attendu |
|---|---|---|---|
| RET-01 | KRI exécutif hors scope | KRI A dans le scope, KRI B hors scope | Seul KRI A est retourné/agrégé |
| RET-02 | Rapport comité hors scope | Alertes KRI distinctes entre départements | Aucune alerte du département B pour l’acteur A |
| RET-03 | Rapport consolidé hors scope | KRI critique lié à un risque hors scope | `criticalKriCount` ne compte pas le KRI exclu |
| RET-04 | Affectation RACI inter-tenant | Objet du tenant A, destinataire du tenant B | Refus, aucune ligne RACI créée |
| RET-05 | Affectation à un compte inactif | Destinataire supprimé/désactivé | Refus, aucune ligne créée |
| RET-06 | Échec d’écriture audit | Injecter une erreur du repository audit | Aucune mutation critique non tracée ou mécanisme de compensation vérifié |
| RET-07 | Droits audit SQL | Connexion runtime normale | UPDATE/DELETE sur `audit_log` refusés |
| RET-08 | CI Semgrep | Introduire un finding contrôlé en branche de test | Échec CI ou dérogation formelle visible selon la règle retenue |
| RET-09 | Lockfile frontend | Build Linux depuis clone propre | Installation reproductible avec lockfile |
| RET-10 | Validation fichier | Fichier au MIME falsifié | Rejet ou mise en quarantaine avant usage |

## 8. Limites de cette revue

Cette revue n’est pas une certification, un avis de conformité réglementaire ou un pentest complet. Elle est fondée sur le commit et les fichiers explicitement examinés, ainsi que sur les logs CI consultés. Les résultats de staging, les configurations effectives de production, les droits réels de la base, les secrets cloud et le contenu détaillé de l’artefact SARIF n’ont pas tous été inspectés ici.

**Conclusion :** la suite automatisée est verte, mais la campagne ne doit pas être considérée comme terminée. Le point prioritaire restant dans le code examiné est l’application cohérente du scope aux KRI dans toutes les vues et tous les rapports. Les écarts d’intégrité RACI, d’audit et de gouvernance Semgrep doivent ensuite être traités et re-testés.
