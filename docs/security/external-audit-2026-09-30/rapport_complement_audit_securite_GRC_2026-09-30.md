# Complément à l’audit technique GRC Tools — 30 septembre 2026

## 1. Périmètre de cette séquence

Campagne complémentaire centrée sur le contrôle d’accès, l’isolation des données et le résultat détaillé du scan Semgrep de GitHub Actions.

- Dépôt : `mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools`
- Branche examinée pour les constats applicatifs : `feature/dashboard-scope-resolver`
- PR : [#27 — dashboard.executive: configurable RACI-derived scope](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/pull/27)
- L’ancien dossier `apps-script-legacy/` reste hors périmètre.
- Il s’agit d’une revue de code et de preuves CI. Aucun test dynamique contre une application déployée n’a été réalisé dans cette séquence.

## 2. Constats

### SEC-CAMP2-01 — Les synthèses KRI ne respectent pas encore le périmètre du dashboard

**Statut : confirmé par lecture du code. Priorité : P0 avant fusion de la PR si les vues sont accessibles aux profils à périmètre limité.**

Dans `backend/src/services/DashboardService.ts`, les méthodes `getExecutiveView()`, `getRiskCommitteeReport()` et `getConsolidatedReport()` calculent un périmètre de risques, mais appellent encore `getAllKriSummaries(actor.tenantId)`, qui récupère tous les KRI du tenant. Les lignes/risques peuvent donc être limités alors que les KRI, alertes ou compteurs KRI sont agrégés sur le tenant entier.

Le point `getKriConsolidated()` traite déjà le cas séparément : il calcule les identifiants de risques du périmètre et retourne une liste vide si le résultat est vide, afin d’éviter qu’un filtre vide soit interprété comme « aucun filtre ».

**Risque :** un utilisateur autorisé à consulter une vue exécutive limitée à certains départements/processus pourrait recevoir des KRI ou des agrégats associés à des risques hors périmètre. Le constat porte sur le code de service; l’exploitation réelle dépend des rôles attribués et des données présentes.

**Preuves :**
- [DashboardService.ts — branche de la PR](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/DashboardService.ts)
- [DashboardService.test.ts — tests existants](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/test/DashboardService.test.ts)

**Correctif attendu :**
1. Calculer une seule fois les `riskIds` autorisés.
2. Filtrer les KRI par ces identifiants dans les trois méthodes.
3. Appliquer le même filtre aux alertes, compteurs, regroupements et exports.
4. Traiter explicitement `riskIds=[]` comme un résultat vide.
5. Ajouter des tests négatifs pour chaque méthode : KRI du département A visible; KRI du département B absent; compteurs et regroupements ne comptent pas B.

### SEC-CAMP2-02 — Une affectation RACI peut cibler un utilisateur d’un autre tenant

**Statut : confirmé par lecture du service et du schéma. Priorité : P1.**

`RaciAssignmentService.assign()` valide le droit `raci.assign`, l’objet métier et le conflit R/A, puis transmet le `userId` reçu à `raci.create()`. Le service n’a pas de `UserRepository` et ne vérifie donc pas que le destinataire existe dans le même tenant et est actif.

La migration `027_raci_assignments.sql` déclare `user_id REFERENCES users(id)`, mais cette clé étrangère vérifie seulement l’existence de l’utilisateur. Elle ne lie pas le `tenant_id` de l’affectation au tenant du destinataire.

Le branchement de `server.ts` injecte les dépôts Risk, Control et ActionPlan, mais pas de dépôt User dans `RaciAssignmentService`.

**Risque :** un appelant disposant de `raci.assign` qui connaît l’identifiant d’un utilisateur d’un autre tenant peut tenter de créer une affectation RACI inter-tenant. Ce constat démontre l’absence de validation dans le chemin d’écriture; il ne prouve pas à lui seul un accès direct aux données du tenant cible.

**Preuves :**
- [RaciAssignmentService.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/services/RaciAssignmentService.ts)
- [PostgresRaciAssignmentRepository.ts](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/infrastructure/database/postgres/PostgresRaciAssignmentRepository.ts)
- [027_raci_assignments.sql](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/database/postgresql/migrations/027_raci_assignments.sql)
- [server.ts — câblage des services](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/backend/src/server.ts)

**Correctif attendu :**
1. Injecter le `UserRepository` réel dans `RaciAssignmentService`.
2. Refuser l’affectation si l’utilisateur cible est absent, suspendu ou appartient à un autre tenant.
3. Ajouter un test avec deux tenants et un utilisateur cible d’un tenant différent.
4. Envisager une protection au niveau SQL par une contrainte composite appropriée, si le modèle relationnel permet de l’appliquer proprement.

### SEC-CAMP2-03 — Les 8 résultats Semgrep sont tous des références d’actions GitHub mutables

**Statut : confirmé par lecture du SARIF téléchargé depuis le run CI. Priorité : P1 pour la chaîne d’approvisionnement CI.**

Le SARIF du scan Semgrep contient 8 résultats. Les 8 utilisent la même règle : `yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag`. Ils concernent des lignes de `.github/workflows/ci.yml` et signalent que des actions sont référencées par des tags/versions mutables plutôt que par un SHA de commit complet.

**Point important :** ces 8 résultats ne sont pas 8 vulnérabilités applicatives distinctes. Ils correspondent à un seul type de risque de chaîne d’approvisionnement répété sur plusieurs références `uses:`.

Le workflow configure actuellement Semgrep avec `continue-on-error: true`. La CI peut donc réussir malgré ces résultats. Cela explique pourquoi un statut CI vert ne signifie pas que Semgrep n’a rien détecté.

**Preuves :**
- [Workflow CI](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/blob/feature/dashboard-scope-resolver/.github/workflows/ci.yml)
- [Run GitHub Actions](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/actions/runs/36687475276)
- [Artefact SARIF Semgrep](https://github.com/mrjeanphilippekouadio-beep/Gouvernance-Risk-Control-Tools/actions/runs/36687475276/artifacts/11084746276)

**Correctif attendu :**
1. Épingler chaque action tierce à un SHA complet vérifié.
2. Documenter la version lisible en commentaire, si nécessaire.
3. Faire échouer la CI sur les nouveaux résultats ou gérer une liste d’exceptions datées, propriétaires et justifiées.
4. Définir explicitement les permissions minimales du `GITHUB_TOKEN` par workflow/job.

### SEC-CAMP2-04 — Durcissement HTTP à vérifier avant production

**Statut : observation de configuration, pas vulnérabilité exploitable démontrée. Priorité : P2.**

Dans `backend/src/server.ts`, la configuration consultée montre `cors(...)`, `express.json()` et `requestIdMiddleware`, sans middleware `helmet` ni limiteur de débit visible dans ce fichier. Cela justifie une vérification du durcissement HTTP global, mais ne prouve pas à lui seul qu’aucune protection équivalente n’existe dans l’infrastructure de déploiement.

**À vérifier sur staging :**
- en-têtes de sécurité effectifs (`Content-Security-Policy` côté frontend, `X-Content-Type-Options`, politique de framing, etc.) ;
- limites de débit et quotas, notamment sur l’authentification et les opérations coûteuses ;
- limites de taille et de concurrence pour les uploads en mémoire ;
- configuration du proxy et des journaux en production.

Ne pas ajouter aveuglément des protections susceptibles de casser l’authentification Google ou les flux CORS : valider les changements sur staging.

## 3. Points de contrôle positifs confirmés dans le code

- `GoogleIdentityProvider` vérifie le jeton Google avec l’audience attendue et exige un email vérifié.
- L’identité, le tenant et les permissions sont résolus côté serveur, pas acceptés directement depuis le corps de la requête.
- Les routes RACI et dashboard sont montées derrière `authMiddleware`.
- Les services consultés utilisent `requirePermission` et passent généralement `actor.tenantId` aux dépôts.
- La migration `028_raci_entity_type_snake_case.sql` aligne les valeurs RACI de la base (`RISK`, `CONTROL`, `ACTION_PLAN`) sur l’union de types applicative. Il ne faut donc pas traiter l’ancien CHECK de la migration 027 isolément comme un défaut actuel sans tenir compte de la migration 028.

## 4. Tests de retest requis

| ID | Test | Résultat attendu |
|---|---|---|
| RET-C2-01 | Acteur limité au département A appelle la vue exécutive avec un KRI lié à un risque du département B | KRI B absent |
| RET-C2-02 | Même scénario via rapport du Comité des Risques | Aucune alerte KRI B |
| RET-C2-03 | Rapport consolidé avec KRI B hors périmètre | Le compteur `criticalKriCount` ne compte pas B |
| RET-C2-04 | Utilisateur du tenant A affecte un RACI à un `userId` du tenant B | Refus et aucune ligne créée |
| RET-C2-05 | Affectation RACI à un utilisateur suspendu | Refus et aucune ligne créée |
| RET-C2-06 | Scan Semgrep après épinglage des actions | Plus de résultats sur les tags mutables; nouveaux résultats bloquants ou exception formelle |
| RET-C2-07 | Vérification HTTP sur staging | En-têtes, rate limiting et limites d’upload mesurés et documentés |

## 5. Ordre de traitement proposé

1. Corriger et tester les trois chemins KRI encore non filtrés.
2. Ajouter la validation du destinataire RACI (même tenant et actif).
3. Épingler les actions GitHub et décider du comportement bloquant de Semgrep.
4. Vérifier les contrôles HTTP effectifs en staging.
5. Reprendre ensuite les autres points du rapport principal : intégrité du journal d’audit, transaction/outbox, validation des fichiers et reproductibilité des installations.

## 6. Limites de preuve

- Les tests TypeScript/Vitest et builds cités dans le rapport principal proviennent des logs du workflow GitHub Actions; ils n’ont pas été relancés localement dans cette séquence.
- Le SARIF a été téléchargé depuis l’artefact GitHub Actions et ses 8 résultats ont été examinés.
- Aucun DAST, test d’intrusion sur staging, test de permissions PostgreSQL sur une base réelle, ni test de restauration n’a été exécuté dans cette séquence.
