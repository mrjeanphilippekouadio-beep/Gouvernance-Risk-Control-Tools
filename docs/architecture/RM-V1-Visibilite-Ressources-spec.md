# RM-V1 — Visibilité configurable des ressources (DECISION-100)

Auteur : A05 Architect, avec le regard GRC d'A13. Date : 2026-10-28. Statut : **proposition, questions PO ouvertes, aucun code**.
Source lue : checkout principal (branche `chore/suivi-r1-f7s3`, qui contient déjà 078 / DECISION-097). Je n'ai pas pu
basculer sur `origin/staging` (pas de shell dans cette session), donc les écarts éventuels avec staging sont à vérifier
avant le dispatch A06. Le service du panel de gouvernance (D1-D6) n'est pas présent dans ce checkout : §1.3 le traite
d'après sa spec (`RM-V1-Panel-Principes-Gouvernance.md`).

## 0. Interprétations à confirmer (principe 5)

- **I-1** « Ressources de ce genre » = les objets métier du dispositif de risque créés par la 1re ligne ou le RM (liste §1.1).
  Le référentiel (départements, processus, échelles, Dispositif, appétit) et les objets d'Audit (missions, constats)
  n'en font **pas** partie : ils sont déjà réservés ou sont communs à tous par nature.
- **I-2** « Restreindre » porte sur **qui peut lire**. Qui peut modifier reste régi par les permissions `*.update`, mais
  on ne peut ni modifier ni lier une ressource qu'on ne voit pas.
- **I-3** « Configurable » = un choix posé **sur la ressource** (à la création, modifiable ensuite avec un droit dédié).
  Ce n'est pas seulement un périmètre de rôle comme `dashboard_scope_mode`. Les deux mécanismes coexistent (§2.5).

## 1. Inventaire

### 1.1 Ressources concernées et rattachement

| Ressource | Rattachement existant | Lecture aujourd'hui |
|---|---|---|
| **Risque** (racine) | `owner_department_id`, `process_id` (jamais rétro-rempli), `owner_id`, `superior_owner_id`, RACI | `risk.read` : `GET /risks`, `/:id`, `/:id/raci`, `/:id/360`, globale au client |
| Évaluations, décisions de traitement, escalades | `risk_id` (obligatoire) | `riskevaluation.read`, `treatmentdecision.read`, globales |
| **KRI** + mesures | `risk_id` principal obligatoire + `kri_risks` (N-N) ; mesures → `kri_id` | `kri.read` : `/kris`, `/kris/dashboard`, globale |
| **Contrôle** | `control_risks` (N-N), `process_id`, `department_id` propres | `control.read`, globale |
| Exécutions, efficacité | `control_id` | `execution.read`, `effectiveness.read`, globales |
| Preuves | `control_execution_id` (nullable) | `evidence.read` / `.download` : contrôle tenant puis Drive (patron EvidenceService) |
| Anomalies | `risk_id`, `control_id` (nullables) | `anomaly.read`, globale |
| Plans d'action | `source_type` RISK/CONTROL/KRI/AUDIT/INCIDENT/MANAGEMENT + `source_id`, `department_id`, `responsible_user_id` | `actionplan.read`, globale ; `/actions` (tableau) |
| KPI (à confirmer, Q-6) | `department_id`, `process_id` propres, sans risque | `kpi.read`, globale |

### 1.2 Agrégats et vues transverses

- `dashboard.read` (risques, anomalies, conformité, propriétaire, `/department/:id`) : **global**, sans périmètre.
- `dashboard.executive` + rapports comité / consolidé / KRI consolidé : périmètre par rôle via `DashboardScopeResolver`
  (`roles.dashboard_scope_mode` GLOBAL | DEPARTMENT, PROCESS refusé faute de `process_id` rempli). Filtre SQL `= ANY`,
  jamais en mémoire. C'est le seul endroit où un périmètre existe (constat INFO-03).
- Cartographie (`cartography.read`, `/`, `/scale`, `/compare`) : globale.
- Journal d'audit (`audit.read`, `GET /audit-logs`) : globale, et il **contient le contenu** des objets (avant/après).
- Notifications : le titre de l'objet est dans le message.
- Panel de gouvernance D1-D6 (`governancehealth.read`, groupes fixes seulement) : comptages sur tout le client.
- Exports : pas de route d'export dédiée. Les rapports ci-dessus jouent ce rôle ; l'import Excel est en écriture seule.

### 1.3 Mécanismes réutilisables

1. `DashboardScopeResolver` / `RiskScope` : calcul à la lecture, jamais stocké. Les R/A et le propriétaire donnent
   le département, les C/I donnent le processus. Ce calcul et le filtre SQL de `RiskRepository.list` se réutilisent tels quels.
2. Groupes de département (`roles.department_id`, un par département) : appartenance via `user_roles`, auditée,
   **sans auto-attribution** (maker-checker de `RoleService`). C'est une source d'appartenance plus fiable que
   `users.department_id`, simple champ de fiche modifiable par `user.update`.
3. Responsabilités de processus (069) : propriétaire, champion, N-1. Propriétaire et N+1 du risque (B-0).
4. Groupes fixes RISK_MANAGER / RISK_COMMITTEE / AUDIT et leur classement en lignes (DECISION-098).

## 2. Options de modèle

### Option A : deux niveaux sur la ressource racine (la plus simple)

- `visibility` ∈ { **CLIENT** (défaut, comportement actuel), **PERIMETRE** }.
- Une ressource PERIMETRE est lisible par : (i) les membres du groupe du département de la ressource, (ii) les personnes
  rattachées (propriétaire, N+1, RACI R/A/C/I, responsable du processus), (iii) les **groupes fixes** RM, Comité et Audit.
  Si la ressource n'a ni département ni processus, seuls (ii) et (iii) la voient : on refuse l'accès plutôt que de l'ouvrir.
- Coût : une colonne sur 4 tables racines, un résolveur et un prédicat SQL. Pas de table d'accès.

### Option B : A + niveau « Personnes nommées »

- Troisième valeur **NOMINATIF** : liste explicite de personnes (table `resource_access_grants`, ajout seul, révocation par
  `revoked_at`, audit). Le département n'ouvre plus l'accès. Cas d'usage : fraude, enquête, risque RH ou juridique.
- Coût : une table, un écran de gestion de la liste, la règle « on ne s'ajoute pas soi-même » et un passage Privacy.

### Option C : périmètre de lecture par rôle généralisé + étiquette

- `dashboard_scope_mode` devient un périmètre appliqué à **tous** les `*.read`, et l'étiquette A s'y ajoute. Toute
  lecture est filtrée, même pour les ressources CLIENT.
- Coût élevé : il change ce que voient tous les utilisateurs existants, ce qui inverse la décision « défaut = tout le client ».
  Elle exige aussi le remplissage de `process_id`, jamais fait. Ce n'est pas ce que demande le PO (restreindre **à la création**).

### 2.1 Qui choisit, qui modifie

- **À la création** : celui qui crée choisit le niveau. Le formulaire propose CLIENT par défaut. Restreindre est un
  resserrement, donc aucun droit supplémentaire n'est demandé. Le service refuse PERIMETRE (400) si le créateur
  ne ferait lui-même pas partie du périmètre et n'est pas d'un groupe fixe, pour ne pas créer d'objet orphelin invisible.
- **Après la création** : permission dédiée **`resourcevisibility.set`**, unique pour toutes les ressources racines,
  attribuée au groupe RISK_MANAGER et jamais incluse dans `*.update` (convention SEC-013/014). Restreindre ou élargir
  demande un **motif**. Élargir (PERIMETRE → CLIENT) est une divulgation : motif obligatoire, audit
  `VISIBILITY_CHANGE` dans la même transaction (`writeAudited`).
- Pas de champ d'attribution venant du client : la personne qui fait le changement est toujours `actor.userId`.

### 2.2 Héritage

| Enfant | Règle |
|---|---|
| Évaluation, décision de traitement, escalade, KRI (par `risk_id` principal), mesure de KRI | **suit son risque**, sans réglage propre |
| Contrôle | **réglage propre** (il couvre plusieurs risques). La liste `coveredRiskIds` affichée ne montre que les risques visibles pour le lecteur |
| Exécution, efficacité, preuve | suit son contrôle. Une preuve sans exécution suit le niveau CLIENT |
| Anomalie | suit son risque, sinon son contrôle, sinon réglage propre |
| Plan d'action | suit sa source RISK/CONTROL/KRI, sinon réglage propre (AUDIT/INCIDENT/MANAGEMENT) |
| Liens N-N (`kri_risks`, `control_risks`) | on n'expose que les identifiants visibles ; lier vers un objet invisible renvoie la même erreur que vers un objet inexistant |

Règle « ce qui m'est assigné » : le responsable d'un plan d'action ou l'exécutant d'un contrôle voit **l'élément qui lui est
assigné**, même si le parent est restreint. Il ne voit pas le parent pour autant.

### 2.3 Non-contournement (lignes de défense, DECISION-097/098)

- **Voient tout** : les membres des groupes fixes **RISK_MANAGER, RISK_COMMITTEE** (2e ligne, supervision du dispositif
  complet) et **AUDIT** (3e ligne : la charte d'audit exige un accès sans restriction, IIA). Lecture A13 : si la 2e ligne
  n'a pas une vue complète, le profil de risque présenté au Comité est incomplet sans que personne le sache. Ce serait un
  défaut de conception du dispositif, pas une protection.
- **Les administrateurs ne voient pas tout du seul fait d'être administrateurs** : administrer des comptes, ce n'est pas lire le métier
  (séparation des tâches). Le contournement « je m'ajoute au groupe du département » est déjà bloqué (pas
  d'auto-attribution de rôle) et toute attribution est auditée.
- **Aucun rôle ordinaire ne peut porter « voit tout »**. Le seul moyen est d'appartenir à un groupe fixe, dont la
  composition est déjà contrôlée.
- **Hors périmètre = 404**, comme une ressource d'un autre client, et non 403 : on ne révèle pas qu'elle existe.
- Écritures : `assertVisible` passe **avant** toute écriture ou liaison (même patron que `EvidenceService` : la vérification
  en base précède l'action).

### 2.4 Agrégats et comptages

- **Toutes les vues** (`dashboard.read`, `dashboard.executive`, rapports, cartographie, `/kris/dashboard`, `/actions`) se
  calculent sur **ce que le lecteur voit**. Le filtre est en SQL, jamais après lecture, pour que la pagination et les
  totaux restent cohérents. On n'affiche pas « N éléments masqués », qui révélerait leur existence.
- Les vues exécutives ont déjà un `scopeSummary`. On y ajoute la mention « vue limitée à votre périmètre » quand le lecteur
  n'appartient pas à un groupe fixe.
- **Panel D1-D6** : inchangé. Il mesure le dispositif entier et n'est lu que par les groupes fixes, qui voient tout.
  Garde-fou : si `governancehealth.read` était un jour donné à un rôle ordinaire, le panel ne montrerait que des
  comptages, sans titre d'objet restreint.
- **Journal d'audit** : les détails d'une ressource restreinte sont filtrés pour un porteur de `audit.read` qui n'est
  pas d'un groupe fixe (ex. rôle « Auditeur » seedé). **Notifications** : pas de titre de ressource restreinte dans le message
  quand un destinataire est hors du périmètre.

### 2.5 Articulation avec `dashboard_scope_mode`

Il y a deux couches distinctes. La visibilité dit **ce que j'ai le droit de voir**. `dashboard_scope_mode` dit **ce que la
vue exécutive agrège pour moi**. Le résultat effectif est leur **intersection**. Aucun changement sur `dashboard_scope_mode`.

### 2.6 Conception technique (pour A06/A07)

- `domain/visibility.ts` : type `Visibility`, type `ReadScope` = `{ all: true } | { departmentIds, processIds,
  riskIds, controlIds, assignedIds }`, prédicat pur `isVisible(scope, resource)` pour les tests.
- `services/VisibilityResolver.ts` : calcule le `ReadScope` **une fois par requête**. Il reprend le calcul de
  `DashboardScopeResolver` (RACI + propriétaire) et y ajoute les groupes de département et les groupes fixes. Comme pour
  `Notifier`, c'est un paramètre de constructeur **optionnel** dans les services ; absent, on retombe sur `{ all: true }`,
  donc aucun test existant ne casse.
- Repositories : les méthodes `list*`/`getById` reçoivent un `ReadScope` optionnel et ajoutent
  `AND (visibility = 'CLIENT' OR … = ANY($n))`. Les enfants font une jointure sur la racine.
- Migration (numéro **suivant le dernier présent**, jamais fixé ici) : `visibility text NOT NULL DEFAULT 'CLIENT'
  CHECK (visibility IN ('CLIENT','PERIMETRE'))` sur `risks`, `controls`, `anomalies`, `action_plans`. **Données existantes :
  CLIENT**, ce qui reproduit le comportement actuel sans aucune régression. L'ajout de la colonne ne change la visibilité
  de personne et ne demande donc pas de ligne d'audit. Permission `resourcevisibility.set` ajoutée au groupe RISK_MANAGER
  par une migration auditée (patron 078).

## 3. Recommandation et lots

**Option A**, avec une colonne `visibility` qui permet d'ajouter NOMINATIF (option B) plus tard sans refonte si le PO le
demande. L'option C est écartée : elle change le défaut et dépend de données absentes.

| Lot | Contenu | Passages |
|---|---|---|
| V0 | `VisibilityResolver` + `ReadScope` branchés partout, **toutes ressources CLIENT** : aucun changement de comportement, tests d'inventaire (aucune route `*.read` sans `ReadScope`) | QA |
| V1 | Risques + enfants hérités (évaluations, décisions, escalades, KRI, mesures) : colonne, choix à la création, `resourcevisibility.set`, audit, `/360`, cartographie, tableaux de bord, rapports, sélecteur frontend | QA, Security, Compliance |
| V2 | Contrôles (réglage propre) + exécutions, efficacité, preuves, anomalies, plans d'action, règle « assigné » | QA, Security, Compliance |
| V3 | Journal d'audit pour les porteurs non membres d'un groupe fixe, notifications, garde-fou panel | Security, Privacy |
| V4 | (si Q-1 = oui) niveau NOMINATIF | Security, Privacy, Compliance |

À noter : DECISION-100 déclenche un balayage complet (8bis). V0 peut partir dès la validation du principe. V1 attend les
réponses Q-1 à Q-5.

## 4. Questions au PO

- **Q-1** Deux niveaux suffisent-ils (« Tout le client » / « Restreint au département et aux personnes concernées »),
  ou faut-il aussi « Personnes nommées seulement » (cas confidentiels) ? *Reco : deux niveaux maintenant, le troisième plus tard si besoin.*
- **Q-2** Qui voit toujours tout ? *Reco : Risk Manager, Comité et Audit. Les administrateurs non, en tant que tels.*
- **Q-3** « Restreint » = membres du groupe du département + propriétaire, N+1, personnes du RACI et responsable du
  processus ? *Reco : oui, avec l'appartenance au département lue dans le groupe de département, pas dans la fiche utilisateur.*
- **Q-4** Un KRI, une évaluation ou une décision suivent la visibilité de leur risque ; un contrôle (qui couvre plusieurs
  risques) a son propre réglage ? *Reco : oui.*
- **Q-5** Qui modifie la visibilité après la création ? *Reco : un nouveau droit dédié, donné au Risk Manager, avec un
  motif obligatoire. Celui qui crée ne choisit qu'au moment de la création.*
- **Q-6** Les KPI sont-ils concernés ? *Reco : non pour l'instant (indicateurs de performance, pas de risque).*
- **Q-7** Un utilisateur au périmètre limité voit-il des totaux calculés uniquement sur ce qu'il voit, sans mention
  « éléments masqués » ? *Reco : oui.*
