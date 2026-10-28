# RM-V1 — Visibilité configurable des ressources (DECISION-100, révisée DECISION-102)

Auteur : A05 Architect, avec le regard GRC d'A13. Date : 2026-10-28 (révision du même jour après DECISION-102, q190-q196).
Statut : **modèle arrêté par le PO, 3 questions ouvertes (§8), aucun code**. Source lue : checkout principal, branche
`chore/suivi-r1-f7s3` (contient 078 / DECISION-097). Les écarts avec `origin/staging` sont à vérifier avant le dispatch A06.

## 0. Interprétations à confirmer (principe 5)

- **I-1** « Ressources de ce genre » = objets métier du dispositif créés par la 1re ligne ou le RM (§1). Le référentiel
  (départements, processus, échelles, Dispositif, appétit) et les objets d'Audit n'en font pas partie.
- **I-2** La visibilité règle **qui peut lire**. Modifier reste régi par `*.update`, mais on ne modifie ni ne lie ce qu'on ne voit pas.
- **I-3 (nouveau)** Au niveau « Personnes nommées », le **propriétaire** de la ressource reste toujours dans la liste
  (il peut modifier la visibilité, q194, il doit donc voir l'objet). Département, N+1, RACI et responsable du processus
  n'ouvrent plus l'accès à ce niveau.
- **I-4 (nouveau, q195)** Un KPI n'a pas de risque (`kpis` : `department_id`, `process_id`, aucun `risk_id`). « Même réglage
  que les KRI » est lu comme : le KPI porte **son propre réglage**, avec les trois mêmes niveaux et les mêmes règles.
  Limite : `kpis.owner` est un **texte libre**, pas un compte. Pour un KPI, il n'y a donc ni propriétaire dans le périmètre
  ni modification par le propriétaire tant que ce champ n'est pas une FK `users` (chantier séparé, A07).
- **I-5 (nouveau, q192)** La « liste de personnes configurable » est commune aux niveaux 2 et 3. Au niveau 2, elle
  **s'ajoute** au périmètre calculé. Au niveau 3, elle **est** le périmètre (avec le propriétaire, I-3).

## 1. Ressources et héritage (q193, q195)

| Ressource | Réglage | Rattachement servant au périmètre |
|---|---|---|
| **Risque** | propre | `owner_department_id`, `process_id`, `owner_id`, `superior_owner_id`, RACI |
| Évaluations, décisions de traitement, escalades, **KRI** (par `risk_id` principal), mesures de KRI | suit le risque | — |
| **Contrôle** | propre (il couvre plusieurs risques) | `department_id`, `process_id`, propriétaire s'il est un compte |
| Exécutions, efficacité, preuves | suit le contrôle (preuve sans exécution : niveau 1) | — |
| **Anomalie** | suit le risque, sinon le contrôle, sinon propre | `risk_id`, `control_id` |
| **Plan d'action** | suit la source RISK/CONTROL/KRI, sinon propre | `department_id`, `responsible_user_id` |
| **KPI** + mesures | propre (I-4) | `department_id`, `process_id` |

Liens N-N (`kri_risks`, `control_risks`) : seuls les identifiants visibles sont exposés. Lier vers un objet invisible
renvoie la même erreur que vers un objet inexistant. Règle « ce qui m'est assigné » : le responsable d'un plan d'action
ou l'exécutant d'un contrôle voit l'élément qui lui est assigné, sans voir le parent.

## 2. Modèle de données (pour A07)

- Colonne `visibility text NOT NULL DEFAULT 'CLIENT' CHECK (visibility IN ('CLIENT','PERIMETRE','NOMINATIF'))` sur les
  racines : `risks`, `controls`, `anomalies`, `action_plans`, `kpis`. Les données existantes passent en `CLIENT`, ce qui
  reproduit le comportement actuel : aucune régression, donc aucune ligne d'audit pour l'ajout de colonne.
- Table **`resource_access_grants`** (ajout seul) : `id`, `tenant_id`, `resource_type` (CHECK RISK | CONTROL | ANOMALY |
  ACTION_PLAN | KPI), `resource_id`, `user_id` (FK `users`), `granted_by`, `granted_at`, `grant_reason`, `revoked_at`,
  `revoked_by`, `revoke_reason`. Index unique partiel `(tenant_id, resource_type, resource_id, user_id) WHERE revoked_at
  IS NULL`. Révocation par `revoked_at`, jamais de `DELETE`. Pas de FK sur `resource_id` (cible polymorphe) : le service
  vérifie l'existence, dans le client, avant d'insérer (patron EvidenceService). `granted_by` / `revoked_by` = `actor.userId`.
- Migrations : numéro **suivant le dernier présent** au moment du lot, jamais fixé ici. Permission ajoutée au groupe
  RISK_MANAGER par migration auditée (patron 078).

## 3. Lecture : qui voit quoi

| Niveau | Libellé UI | Lisible par (en plus des « voient tout », §4) |
|---|---|---|
| CLIENT | Tout le client | tout porteur de `x.read` (comportement actuel) |
| PERIMETRE | Restreint au périmètre | membres du **groupe du département** (appartenance via `user_roles`, pas `users.department_id`) + propriétaire, N+1, RACI R/A/C/I, responsable du processus + **liste** |
| NOMINATIF | Personnes nommées | **liste** + propriétaire (I-3) |

- Une ressource PERIMETRE sans département ni processus n'est vue que par les personnes rattachées et la liste : on
  refuse plutôt que d'ouvrir.
- **Hors périmètre = 404** (comme une ressource d'un autre client). `assertVisible` passe **avant** toute écriture ou
  liaison, avec une vérification en base qui précède l'action.
- Le résultat effectif est l'**intersection** avec `dashboard_scope_mode` (ce que la vue agrège), qui reste inchangé.

## 4. Qui voit tout, et le cas de l'administrateur (q191)

**Voient tout, sans réglage possible** : groupes fixes **RISK_MANAGER, RISK_COMMITTEE** (2e ligne : sinon le profil de
risque présenté au Comité est incomplet sans que personne le sache) et **AUDIT** (3e ligne : accès sans restriction exigé
par la charte d'audit, IIA). C'est vrai aussi au niveau NOMINATIF. Information, sans rouvrir la décision : une enquête
visant un membre de la 2e ligne se mène hors de l'outil, ou par l'Audit et le Comité.

**Administrateur sans rôle dans le domaine des risques** : trois options instruites.

| Option | Effet | Séparation des tâches | TPE (admin = RM) |
|---|---|---|---|
| **A1** Admin technique, sans accès aux contenus | voit niveau, nombre d'ayants droit, identifiants ; aucun titre ni contenu | maximale : administrer ≠ lire le métier | sans effet : il voit tout **en tant que RM** |
| **A2** Admin voit tout (lecture littérale de q191) | simple, aucun droit nouveau | faible : le service informatique lit les dossiers NOMINATIF (fraude, RH) ; contredit l'esprit de DECISION-098/101, où même le RM ne voit les comptes d'admin que par un droit explicite | sans effet |
| **A3** Droit de **lecture des contenus** séparé, attribué explicitement | `resource.readall`, hors `ADMIN_PERMISSIONS` (piège q63 : sinon tout lecteur devient « admin »), posé sur le rôle d'un administrateur, **confirmé par une autre personne**, badge dans la matrice, audité, révocable | conservée par défaut ; l'exception est voulue, nommée et tracée | sans effet ; si l'admin est seul et n'est pas RM, la confirmation passe par la double confirmation du panel (marquée « sans second regard ») |

Cohérence avec DECISION-097/098/101 : la matrice classe déjà les administrateurs dans une ligne à part, et tout
élargissement de lecture y est individuel, distinct et confirmé par un tiers. A3 reprend exactement ce mécanisme. A2 serait
le seul endroit où le rôle d'administrateur donnerait accès au contenu métier. Les contournements restent bloqués :
pas d'auto-attribution de rôle, pas d'auto-ajout à une liste, et toute attribution est auditée.
**Recommandation : A3, non attribué par défaut** (§8, Q-1). A1 en est le comportement par défaut.

## 5. Modifier la visibilité (q194)

- **À la création** : le créateur choisit le niveau et la liste ; le formulaire propose CLIENT. Refus (400) si le créateur
  ne ferait pas lui-même partie de l'ensemble résultant et n'appartient pas à un groupe « voit tout ».
- **Après la création** : peuvent changer le niveau et la liste (i) un porteur de **`resourcevisibility.set`** (groupe
  RISK_MANAGER, jamais inclus dans `*.update`, conformément à SEC-013/014) et (ii) le **propriétaire** de la ressource, par
  relation (`owner_id` ou équivalent compte ; pas pour un KPI, I-4).
- **Motif obligatoire** dans les deux sens. Audit `VISIBILITY_CHANGE` (avant/après) et `ACCESS_GRANT` / `ACCESS_REVOKE`
  dans **la même transaction** (`writeAudited`). L'auteur est toujours `actor.userId`, jamais un champ venant du client.
- Gardes : personne ne s'ajoute soi-même à une liste. Le propriétaire ne peut pas être retiré tant qu'il est propriétaire.
  Changer de propriétaire n'emporte pas l'ancien propriétaire dans la liste. Un passage vers un niveau plus ouvert est
  une divulgation : l'audit le marque `widening: true`, pour les revues.

## 6. Agrégats et « X éléments non visibles » (q196)

- Toutes les vues (`dashboard.read`, `dashboard.executive`, rapports, cartographie, `/kris/dashboard`, `/actions`, KPI)
  se calculent en SQL sur **ce que le lecteur voit**. Le filtre est appliqué avant la pagination, jamais en mémoire.
- **Ce que la mention révèle, honnêtement** : l'**existence** et le **nombre** d'objets cachés. Si elle est calculée sur
  une vue filtrée, elle révèle aussi leurs **attributs** par différence : « 1 non visible » sur un filtre
  département = Finance + criticité = Critique + mois courant désigne un risque critique restreint de la Finance. Son
  évolution dans le temps révèle aussi la date de création. Dans un contexte fintech (CENTIF), cela peut prévenir la
  personne visée par une enquête.
- **Limitation proposée, qui garde l'affichage voulu par le PO** : (i) **un seul nombre par type de ressource**, calculé
  sur tout le client et **indépendant des filtres** ; (ii) aucune ventilation par catégorie, criticité, département,
  statut ou période ; (iii) aucun lien, identifiant ni tri sur ces éléments ; (iv) pas de mention pour les groupes
  « voient tout », pour qui elle vaut toujours 0 ; (v) les objets NOMINATIF exclus du nombre (§8, Q-2).
- Panel D1-D6 : inchangé (lu par les groupes fixes). Journal d'audit : détails d'une ressource restreinte filtrés pour un
  porteur d'`audit.read` hors groupe fixe. Notifications : pas de titre restreint quand un destinataire est hors périmètre.

## 7. Conception technique, lots révisés et effort

- `domain/visibility.ts` : types `Visibility` et `ReadScope` = `{ all: true } | { departmentIds, processIds, riskIds,
  controlIds, assignedIds, grantedIds }`, prédicat pur `isVisible`. `services/VisibilityResolver.ts` calcule le `ReadScope`
  **une fois par requête** : il reprend le calcul de `DashboardScopeResolver` et y ajoute les groupes de département, les
  groupes fixes, `resource.readall` (si A3) et les accès accordés. C'est un paramètre de constructeur **optionnel** :
  absent, on retombe sur `{ all: true }`, et aucun test existant ne casse. Repositories : `ReadScope` optionnel et prédicat
  `AND (visibility = 'CLIENT' OR …)` en SQL ; les enfants font une jointure sur la racine.
- Prédicats `isAdministrator` / `isRiskManagerMember` : à déplacer dans `domain/fixedGroupPermissions.ts`, jamais dupliqués.

| Lot | Contenu | Effort A06/A07 | Passages |
|---|---|---|---|
| V0 | Résolveur + `ReadScope` branchés partout, tout reste CLIENT : aucun changement visible ; test d'inventaire (aucune route `*.read` sans `ReadScope`) | 3 j | QA |
| V1 | Colonne + `resource_access_grants` ; **risques + enfants hérités (KRI compris)**, les 3 niveaux, liste, `resourcevisibility.set` + modification par le propriétaire, motif, audit, `/360`, cartographie, tableaux de bord, rapports ; sélecteur + éditeur de liste dans le frontend | 7-8 j | QA, Security, Compliance, Privacy |
| V2 | Contrôles (réglage propre) + exécutions, efficacité, preuves ; anomalies, plans d'action, règle « assigné » ; **KPI** + mesures | 5-6 j | QA, Security, Compliance |
| V3 | « X éléments non visibles » (§6), filtrage du journal d'audit, notifications, garde-fou panel | 3 j | Security, Privacy |
| V4 | Cas administrateur selon Q-1 (A3 : `resource.readall`, confirmation par un tiers, badge de matrice ; A1 : vue des métadonnées pour le support) | 2 j | Security, Compliance |

Total : **20 à 22 jours-agent**, hors passages et frontend fin. Ordre : V0 puis V1 ; V2, V3 et V4 peuvent être menés en
parallèle (worktrees) après V1, car `permissions.ts` et `server.ts` sont partagés. V0 et V1 n'attendent pas Q-1 : sans
`resource.readall`, le défaut est A1. La production attend V4 si le PO retient A3.

## 8. Questions encore ouvertes

- **Q-1 (administrateur, q191)** Un administrateur qui n'est ni RM, ni Comité, ni Audit voit-il les contenus ?
  *Reco : A3. Par défaut il ne voit que les métadonnées (A1). Un droit « lecture de tous les contenus », distinct
  du droit d'administration, peut lui être donné explicitement, confirmé par une autre personne, avec un badge dans la
  matrice, comme pour DECISION-101. Dans une TPE où l'admin est aussi RM, il voit déjà tout en tant que RM.*
- **Q-2 (q196)** Les objets « Personnes nommées » entrent-ils dans le nombre « X éléments non visibles » ? *Reco : non. Les
  compter signale qu'une enquête existe, ce qui peut prévenir la personne visée. Le nombre reste affiché pour les objets
  « restreints au périmètre », global et sans ventilation (§6).*
- **Q-3 (q194)** Quand le propriétaire **élargit** une ressource que le RM avait restreinte, faut-il davantage que la
  trace ? *Reco : pas de blocage, conformément à la décision. Le RM est notifié après la validation, et l'élargissement
  apparaît dans les revues (`widening: true`).*
