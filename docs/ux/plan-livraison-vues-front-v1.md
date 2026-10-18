# Plan de livraison des vues frontend V1 (A04, UX Designer)

**Statut** : DRAFT pour validation PO. Analyse et plan, pas de maquette, pas de code.
**Origine** : DECISION-079 point 5 (analyse du retard du frontend sur le backend et plan de livraison des vues).
**Méthode** : comparaison, au 2026-10-18, de (1) `backend/src/server.ts` (46 fichiers `*.routes.ts`, tous montés), (2) les appels de `frontend/src/api/*.ts`, (3) les vues de `frontend/src/App.tsx`, (4) les décisions DECISION-060 à DECISION-079 et les specs `docs/ux/RM-V1-Navigation-Risques.md`, `docs/ux/RM-V1-Panel-Principes-Gouvernance.md`, `docs/architecture/RM-V1-Panel-Principes-Gouvernance.md`.
**Limite de la vérification** : j'ai relu la couche `frontend/src/api/*.ts` et `App.tsx`. Je n'ai pas ouvert chaque page pour vérifier qu'elle n'appelle pas une route par un autre chemin. Les cas douteux sont marqués « à vérifier ».

## 0. Résumé en une page

Le backend monte 46 routeurs. Le frontend couvre l'essentiel du cœur GRC (risques, évaluations, contrôles, anomalies, plans d'action, constats, indicateurs, référentiels, rôles, journal d'audit, Dispositif). Il ne couvre **rien** des lots de gouvernance D1 à D4 déjà montés côté serveur (profil d'organisation, désignations, responsabilités de processus, politique d'auto-validation, double confirmation). Et la navigation décidée le 2026-10-18 (DECISION-065) n'est pas encore faite dans `App.tsx`.

Trois constats qui comptent plus que le nombre d'écrans :

1. **Le client HTTP perd deux signaux serveur.** `apiRequest` ne renvoie que `payload.data` : la réponse 202 `pendingRequest` de la politique d'auto-validation est donc invisible. Et le 409 `GOVERNANCE_CONFIRMATION_REQUIRED` n'arrive que dans le texte du message d'erreur (`ApiError` n'a pas de champ `code`). Ce sont des correctifs du socle, à faire avant tout écran de gouvernance.
2. **Sans écran, des décisions PO sont inopérantes.** Exemple : le PO a voulu que le client puisse activer la double confirmation (q141) et autoriser le cumul Comité + Audit (DECISION-061). Aujourd'hui seule l'API le permet.
3. **Trois lots serveur n'existent pas encore** : D5 (revues et acceptations), D6 (`GET /governance-health`), l'étape Analyse (DECISION-064, « modèle à concevoir »). Les écrans correspondants sont planifiés, mais ne peuvent pas être branchés avant.

### Tableau récapitulatif des vues manquantes

| Catégorie | Nouveaux écrans | Évolutions d'écrans existants | Total |
|---|---|---|---|
| V1 obligatoire | 7 | 8 | **15** |
| V1 souhaitable | 8 | 0 | **8** |
| Administration par API seulement (pas d'écran en V1) | 2 | 0 | **2** |
| À trancher par le PO (voir section 5) | 8 | 0 | **8** |
| **Total** | **25** | **8** | **33** |

Détail dans les sections 2 à 4. Une « vue » = un écran, un onglet, ou un composant partagé câblé dans plusieurs écrans (la double confirmation compte pour une évolution, même si elle touche 8 écrans).

## 1. Inventaire : routes du serveur sans écran

Légende de la colonne « Spec UX » : **oui** = spec dans `docs/ux/`, **partielle** = couverte en passant, **non** = à écrire.

### 1.1 Gouvernance (lots D1 à D4, montés)

| Fonction serveur (route) | Pour qui (permission) | Décision PO qui l'exige | Écran aujourd'hui | Spec UX |
|---|---|---|---|---|
| `PUT /config/self-validation-policy` (réponse 202 `pendingRequest` si une seconde personne doit approuver) ; `GET /config/self-validation-policy/request` ; `POST …/requests/:id/approve` et `/reject` | Administrateur (`config.selfvalidation.set`), approbateur tiers (`config.selfvalidation.approve`) | q141 (activable par le client), q158 (assouplissement confirmé par une seconde personne), DECISION-072 | Aucun. Le client HTTP perd le 202. | non |
| `PUT /config/committee-thresholds`, `/committee-enforcement`, `/committee-audit-cumul`, `/evaluation-mode` | Administrateur (`config.committeethreshold.set`, `config.committeeenforcement.set`, `config.cumul.set`, `config.update`) | DECISION-061 (cumul interdit par défaut, autorisable par le client), DECISION-058 (motif obligatoire), DECISION-072 (régime hybride) | Aucun | non |
| `GET/POST /organization-profile`, `/submit`, `/:id/approve`, `/:id/reject` | Lecture `orgprofile.read` ; soumission `orgprofile.submit` (admin, Risk Manager) ; approbation `orgprofile.approve` (Risk Manager, Comité) | q135, q146, q147, q154 (6 questions), DECISION-076, q157 | Aucun | non |
| `GET/POST /governance-designations`, `/:id/end` | Administrateur (`designation.manage`) | q137 (intérimaire ou suppléant du Risk Manager), DECISION-066 point 5 (gérant), q149, q160/q161 | Aucun | non |
| `GET/PUT /processes/:id/responsibilities` (propriétaire, champion, N-1) | `process.responsibility.assign` (admin, Risk Manager) ; lecture `process.read` | DECISION-064 (qui peut faire l'Analyse), DECISION-072 (`risk.owner.assign`), q150 (rapprochement proposé, confirmé processus par processus) | `ProcessesPage` ne l'appelle pas | non |
| `/process-evaluation-mode-requests` (liste, détail, proposer, valider, rejeter). `PUT /processes/:id/evaluation-mode` est fermé. | Proposer `process.evaluationmode.propose` ; valider `evaluationmode.validate` | DECISION-006 (option A), DECISION-069 (demande « revenir au mode du Dispositif »), q131 | Aucun. Sans écran, **personne ne peut plus changer le mode d'un processus**. | non |
| Réponse 409 `GOVERNANCE_CONFIRMATION_REQUIRED` + corps `governanceConfirmation` sur 8 validations : évaluation de risque, décision de traitement (Comité exclu, q159), exécution de contrôle, efficacité, clôture de plan d'action, clôture de constat, clôture de cycle de revue, validation d'une demande de mode d'évaluation | Tout valideur qui est aussi l'auteur, quand la politique est `DOUBLE_CONFIRMATION` et que personne d'autre ne peut valider | q141, DECISION-066 (« ne jamais bloquer »), DECISION-074 | Aucun. Les écrans de validation affichent le texte brut de l'erreur. Défaut serveur = `REFUSE`, donc pas de régression tant que personne n'active la politique. | non |
| Champ `validationIndependence` (`INDEPENDENT` / `WITHOUT_INDEPENDENT_REVIEW` / `REVIEWED_BY_THIRD_PARTY`) dans les réponses des objets validables | Tous les lecteurs de ces objets | q142 (« Appliqué sans validation indépendante », distinct de « Validé »), q153 (libellé distinct partout) | Non affiché | non |
| `GET /audit-log` avec le marqueur `governanceException` (colonne ajoutée par la migration 066) et filtre associé | `audit.read` (Auditeur) | q138, DECISION-073 | `AuditLogPage` sans colonne ni filtre « sans seconde validation » (à vérifier) | partielle (panel §6) |
| `GET /users` (dernière connexion, migration 067) | `user.read` | q155 (libellé « dernière connexion »), q156 | Liste sans usage dans un écran de gestion | partielle |

### 1.2 Gouvernance (lots D5 et D6, **pas encore montés côté serveur**)

| Fonction à venir | Pour qui | Décision PO | Spec UX |
|---|---|---|---|
| `GET /governance-health` (panel, taille, principes, objets en cause, masquage des noms sans `audit.read`) | Admin, Risk Manager, Comité, Audit (`governancehealth.read`) | DECISION-073, DECISION-074 (q135 à q144), DECISION-075 (q151), DECISION-077 | oui (`RM-V1-Panel-Principes-Gouvernance.md`, contenu A13 encore en « Exemple ») |
| Revue par un tiers d'une action sans validation indépendante | Risk Manager, Comité, Audit (`governanceexception.review`) | q138, DECISION-074 | non |
| Acceptation datée d'un principe non respecté (motif, durée, seconde confirmation, fin anticipée) | Admin, Risk Manager ; confirmation par un tiers | q138 | non (la spec du panel recommandait de ne pas l'avoir en V1 ; le PO a décidé le contraire) |
| Notifications `GOVERNANCE_EXCEPTIONS_TO_REVIEW`, `GOVERNANCE_EXCEPTION_RECORDED`, baisse de taille (contestation par l'Audit, q157) | Audit, Comité, gérant | q144, q157 | non |

### 1.3 Refonte Risques (DECISION-062, 064, 065)

| Fonction | Pour qui | Décision PO | État | Spec UX |
|---|---|---|---|---|
| Nouvelle navigation : Appétence, Grilles, Dispositif déplacés dans Administration > Méthodologie ; séparateurs Méthodologie / Référentiels / Plateforme / Gouvernance | Tous | q122 à q125 (DECISION-065) | `NAV_GROUPS` de `App.tsx` inchangé : les trois entrées sont encore dans « Risques » | oui (DRAFT à passer en décidé) |
| Retrait des écritures d'appétence (`PUT /appetite/:subCategory`, `POST /appetite/:id/archive`) et des écritures de grille hors brouillon de Dispositif | Risk Manager, administrateur | q122, DECISION-054 | `AppetitePage` propose des actions que le serveur refuse | oui |
| Fiche risque à onglets Identification · Analyse · Évaluation · Historique | Risk Owner, équipe risque | DECISION-062 | `RisksPage` : à vérifier | oui |
| Étape Analyse (causes, événements, impacts, contexte ; qui l'écrit : DECISION-064) | Personne attributaire, N-1, propriétaire du risque, propriétaire du processus | q121 / DECISION-064 | **Aucun backend** (« modèle à concevoir »). Aucun champ ne doit être spécifié avant le modèle. | non (emplacement seulement) |
| Onglets du détail de Dispositif : Checklist · Paramètres · Échelles · Seuils d'appétence · Versions | Risk Manager, administrateur | q132, q133 | `AppetiteThresholdsTab.tsx` existe déjà (commit 60f7757) ; l'onglet n'est pas encore choisi dans le menu cible (à vérifier) | oui |
| Cibles de `NotificationCenter` : `frameworks`, panel, désignations | Tous | Navigation S6, panel §2 | Cibles actuelles : `risks`, `actions`, `controls`, `evaluation`, `roles` | oui |

### 1.4 Autres routes montées sans écran

| Route(s) | Pour qui (permission) | Décision PO | Écran | Spec UX |
|---|---|---|---|---|
| `/roles/matrix`, `/roles/users/:userId`, `/roles/users/:userId/permissions`, `PATCH /roles/:id` | Administrateur | DECISION-068 (liste des droits) | `RolesAdmin` : liste, création, désactivation, attribution, retrait seulement | non |
| `/roles/audit-group/permissions`, `/roles/permission-changes`, `…/approve`, `…/reject` | Administrateur propose, Risk Manager ou Comité approuve | DECISION-072 (`rolegroup.audit.update`, régime hybride) | Aucun. Sans écran, le circuit à deux ne peut pas s'exercer. | non |
| `/users` création, modification, suspension, réactivation, `/users/me` | `user.*` | Aucune décision trouvée | Liste seule, utilisée dans les sélecteurs | non |
| `/audit-missions` création, démarrage, clôture | Auditeur | Menu « Missions » en « À venir » | Liste seule (`audit.ts`) | non |
| `/evidences` liste, URL de téléchargement, analyse, suppression | Plusieurs | Cahier des charges GRC (preuves) | `evidence.ts` ne fait que le dépôt (POST). **Une preuve déposée ne se relit pas dans l'interface** (à vérifier hors couche API). | partielle |
| `/risks/:id/360`, `/risks/:id/escalate`, `/risks/:id/raci` | Risk Owner, équipe risque | Aucune décision trouvée | Non appelés par `risks.ts` ; le RACI passe par `/raci` | non |
| `/cartography` (liste) et `/cartography/compare` | Lecteurs de risques | Aucune | Seul `/cartography/scale` est appelé | non |
| `/kris/dashboard`, `PUT /kris/:id`, `POST /kris/:id/risks`, `PATCH /kris/:id/disable` | Risk Manager | Aucune | `indicators.ts` ne couvre que listes, détails, création et mesures (à vérifier) | non |
| `/risk-evaluations/:id/appetite-suggestion` | Risk Owner | Aucune | Non appelé | non |
| `/dashboard/risks`, `/anomalies`, `/compliance`, `/risk-owner`, `/department/:id`, `/executive` ; `/reports/*` (6 rapports) | `dashboard.read`, `dashboard.executive` | DECISION-002 point 5 (qui voit quel widget) **resté ouvert** | Entrée de menu « Dashboards » en « À venir » ; seul `/dashboard/actions` est utilisé | non |
| `/review-cycles` (liste, détail, création, proposition de clôture, clôture avec double confirmation) | `governance.read/create/validate` | Menu « Cycles de revue » en « À venir » ; aucune décision de périmètre trouvée | Aucun | non |
| `/branding`, `/modules`, `/tenants`, `/import/excel` | `branding.*`, `config.read`, `config.manage` | Aucune décision d'écran | Aucun | non |
| `/regulatory-frameworks` (liste, détail, création, mise à jour) | `config.read`, `config.manage` | Aucune | Aucun. `FrameworksPage` = Dispositif de risque (`/risk-frameworks`), pas les cadres réglementaires. | non |
| `/risk-owners` | `risk.read` | Aucune | Aucun | non |
| `/notification-subscriptions` (écriture) | Tous | DECISION-045 (écran en lecture seule) | Lecture seule, conforme | oui |

**Routes montées ou non ?** Les 46 fichiers de `backend/src/api/v1` sont tous importés et montés dans `server.ts`. `processEvaluationModeRequests` est monté sous `/api/v1/process-evaluation-mode-requests` et `regulatoryFrameworks` sous `/api/v1/regulatory-frameworks`. Seule `localAuth` est montée sous condition (fournisseur d'identité local). Rien n'est « non monté » ; ce qui manque côté serveur, ce sont D5, D6, l'Analyse, et la demande « revenir au mode du Dispositif » (DECISION-069) dont je ne vois pas la trace dans la route (à vérifier avec A06).

## 2. Classement des vues

Règle appliquée : **V1 obligatoire** = une décision PO ne peut pas s'exercer sans cet écran, ou le serveur refuse ce que l'écran propose. **V1 souhaitable** = utile au rôle cible, aucune décision PO ne l'exige. **API seulement** = aucun rôle utilisateur ne la manipule, pas de décision. **À trancher** = je ne peux pas classer sans le PO (section 5).

### 2.1 V1 obligatoire (15)

Nouveaux écrans (7) :

| # | Vue | Rôle cible | Justification |
|---|---|---|---|
| O1 | **Réglages de gouvernance** (Administration > Gouvernance) : politique d'auto-validation avec demande en attente, approbation, rejet ; cumul Comité + Audit ; application du passage Comité ; seuils Comité ; mode d'évaluation global | Administrateur ; approbateur tiers | q141, q158, DECISION-061, DECISION-058. Une carte par réglage, un réglage = un appel (DECISION-054). Motif obligatoire. |
| O2 | **Profil d'organisation** : questionnaire à 6 questions, historique des versions, demande en attente, approbation ou rejet, seconde confirmation d'une baisse de taille | Administrateur, Risk Manager (soumet) ; Risk Manager, Comité (approuvent) | q135, q146, q147, q154, DECISION-076. La taille alimente le panel. |
| O3 | **Désignations** : gérant, intérimaire ou suppléant du Risk Manager, avec date de fin et motif | Administrateur | q137, DECISION-066 point 5. |
| O4 | **Demandes de mode d'évaluation de processus** : file, proposer, valider, rejeter, « revenir au mode du Dispositif » | Direction de département / propriétaire de processus (propose) ; équipe risque (valide) | DECISION-006, DECISION-069, q131. L'écriture directe est fermée. |
| O5 | **Panel « Principes de gouvernance »** (liste, détail, trois colonnes TPE / PME / GE, objets en cause, revue par un tiers, acceptation datée) | Administrateur, Risk Manager, Comité, Audit | DECISION-073, DECISION-074. Dépend de D5 et D6. |
| O6 | **Demandes de changement de droits du groupe Audit** (liste, approbation, rejet) | Administrateur (propose) ; Risk Manager, Comité (approuvent) | DECISION-072 `rolegroup.audit.update`. |
| O7 | **Étape Analyse** (contenu des onglets) | Risk Owner et personnes de DECISION-064 | DECISION-064. Dépend d'un modèle serveur qui n'existe pas. L'onglet vide est livré avec O12. |

Évolutions d'écrans existants (8) :

| # | Évolution | Justification |
|---|---|---|
| O8 | **Menu Risques / Administration refondu** (DECISION-065), séparateurs, compteur du panel, `PAGE_TITLES`, `ContextRail` | q122 à q125. |
| O9 | **Retrait des écritures d'appétence et de grille hors Dispositif** (`AppetitePage`, `RatingScalesPage`) ; raccourcis S1 à S6 | Le serveur les refuse déjà (B-6b). |
| O10 | **Double confirmation partagée** : dialogue « Personne d'autre ne peut valider » + motif + seconde confirmation, câblé dans les 8 écrans de validation | q141, DECISION-066. Un seul composant. |
| O11 | **Libellé « Appliqué sans validation indépendante »** (jamais « Validé ») sur tous les objets qui portent `validationIndependence`, y compris listes et exports | q142, q153. |
| O12 | **Fiche risque à onglets** (Identification · Analyse · Évaluation · Historique) avec onglet Analyse vide « renseigné prochainement » | DECISION-062, DECISION-065. |
| O13 | **Responsabilités de processus** dans `ProcessesPage` : propriétaire, champion, N-1, rapprochement proposé et confirmé ligne par ligne | DECISION-064, DECISION-072, q150. |
| O14 | **Proposition d'intérimaire** après attribution du rôle Risk Manager (`RolesAdmin`) quand la fonction risque dépasse une personne | q137. |
| O15 | **Journal d'audit** : colonne et filtre « sans seconde validation » ; **notifications** : nouveaux types et cibles | q138, q144, q157. |

### 2.2 V1 souhaitable (8, nouveaux écrans)

| # | Vue | Rôle cible | Pourquoi pas obligatoire |
|---|---|---|---|
| S1 | **Consultation des preuves** (liste, ouverture, analyse) | Auditeur, contrôleur | Fort besoin d'usage (une preuve déposée ne se relit pas), mais aucune décision PO ne l'exige. À vérifier d'abord hors couche API. |
| S2 | **Missions d'audit** (création, démarrage, clôture) | Auditeur | Entrée de menu « À venir », pas de décision. |
| S3 | **Matrice des droits** et droits par utilisateur | Administrateur, Audit | DECISION-068 a été traitée dans le cockpit ; l'écran aide, il n'est pas exigé. |
| S4 | **Vue 360 du risque** (dans la fiche) | Risk Owner | Complète O12 ; non décidée. |
| S5 | **Escalade d'un risque** | Risk Owner | Non décidée. |
| S6 | **Gestion complète des KRI** (tableau de bord, modification, rattachement, désactivation) | Risk Manager | Création et mesures existent déjà. |
| S7 | **Comparaison de cartographies** | Risk Manager, Comité | Le serveur la propose ; aucune décision. |
| S8 | **Suggestion d'appétence** dans l'évaluation | Risk Owner | Petit ajout à `EvaluationPage`. |

### 2.3 Administration par API seulement en V1 (2)

| # | Fonction | Justification |
|---|---|---|
| A1 | **Cadres réglementaires** (`/regulatory-frameworks`) | Aucun rôle utilisateur ne la manipule en V1, pas de décision PO, contenu réglementaire que l'UX ne doit pas modifier. À rouvrir si Compliance le demande. |
| A2 | **Annuaire des propriétaires de risque** (`/risk-owners`) | C'est une aide de sélection. Elle sert aux listes déroulantes de la fiche, pas à un écran propre. |

(Les abonnements aux notifications sont déjà en lecture seule, conforme à DECISION-045 : rien à faire.)

### 2.4 À trancher (8) : voir section 5

Dashboards et rapports (2 groupes de vues), cycles de revue, gestion des utilisateurs, et quatre écrans de mise en service (branding, modules activables, tenants, import Excel).

## 3. Plan de livraison en lots frontend

Principes communs à tous les lots :

- **Aucune règle métier côté frontend.** Le frontend affiche ce que le serveur renvoie : taille, principe surligné, `validationIndependence`, « personne d'autre ne peut valider ». Il ne recalcule rien.
- **Cacher un bouton n'est pas un contrôle.** Bouton désactivé avec la raison, clic = `PermissionDeniedDialog`.
- **Chaque nouvel écran** reçoit sa maquette dans l'**artefact de revue** (exigence PO, suivi dans `.claude/agent-context/COMMENTS_ARTIFACT_TRACKING.md`) **avant** son implémentation. Une spec écrite dans `docs/ux/` ne suffit pas.
- **Design system** : on réutilise `@djamo/design-system` tel quel (Button, FormField, Table, Tabs, Card, Modal, MessageBanner, StatusBadge, Pagination, SegmentedControl, Timeline, Panel, Grid, Menu). Un composant lié à un concept GRC va dans `frontend/src/design-system/` (comme `RaciPanel`), jamais dans le package. `frontend/` interdit les paramètres de constructeur propriétés (`erasableSyntaxOnly`).
- Un lot n'est fini que si `npm run build` passe côté frontend ; QA (A08) et Sécurité (A10) passent après chaque lot ; Compliance (A14) sur F4 et F5.

### Vue d'ensemble

| Lot | Contenu | Taille | Dépend du backend | Peut partir tout de suite ? |
|---|---|---|---|---|
| **F0** | Socle partagé | M | Une précision d'A06 (forme du 409) | Oui |
| **F1** | Navigation et refonte Risques | M | Aucune (Analyse = emplacement) | Oui |
| **F2** | Double confirmation et libellé q142 sur les validations | M | D4 (monté) | Oui, après F0 |
| **F3** | Réglages de gouvernance + demandes de mode d'évaluation | M | D4 (monté) ; DECISION-069 à confirmer | Oui, après F0 |
| **F4** | Profil d'organisation + désignations + responsabilités de processus | L | D2b, D2c, D3 (montés) | Oui, après F0 et F1 |
| **F5** | Panel de gouvernance + revues + acceptations + notifications | L | **D5 et D6 (non montés)** | Non : maquette tout de suite, branchement après D6 |
| **F6** | Étape Analyse | M | **Modèle Analyse (non conçu)** | Non |
| **F7** | Souhaitables (S1 à S8) | L | Aucun, sauf vérification S1 | Oui, en dernier |
| **F8** | Écrans à trancher | variable | Réponses du PO | Selon réponses |

Ordre recommandé : **F0 → (F1 en parallèle de F2) → F3 → F4 → F5 → F6 → F7 → F8**. F5 est le seul lot qui attend le serveur (D5 puis D6). Pendant l'attente, on livre F0 à F4 et on prépare les maquettes de F5.

### F0 — Socle partagé (M)

- **Contenu** : (a) le client HTTP expose le **202 avec `pendingRequest`** (aujourd'hui perdu) ; (b) le **409** est reconnu comme une demande de confirmation, avec le principe et la conséquence (aujourd'hui seulement dans le texte du message : demander à A06 un champ structuré `code`, comme DECISION-011 le demande déjà pour les permissions) ; (c) **correctifs du design system** nécessaires aux nouveaux écrans, tels que listés dans le panel §10 : squelette de chargement (E7, M18), états vides distincts (E8), tri avec `aria-sort` (E10), ligne ouvrable au clavier et nom de tableau (E11, E12), bouton d'action dans `MessageBanner` (E22), compteur de menu visible replié (E27), tableau empilé mobile (E13) ; (d) **badge** « Appliqué sans validation indépendante » (variante de `StatusBadge`, texte + icône) ; (e) cibles de `NotificationCenter`.
- **Composants du design system réutilisés** : StatusBadge, MessageBanner, Table, Modal.
- **Composants manquants** : section repliable (M6), `ConfirmWithReasonDialog` (composition de Modal + FormField, dans `frontend/src/design-system/`).
- **Maquette** : planche « états partagés » (squelette, vide, erreur, refus, 202 en attente, badge).
- **Parallèle au backend** : oui, sauf (b) qui attend la réponse d'A06.

### F1 — Navigation et refonte Risques (M)

- **Contenu** : O8, O9, O12, plus les raccourcis S1 à S6 de la spec de navigation. Ordre interne fixé par la spec : (1) déplacer les entrées, (2) retirer les écritures, (3) onglets de fiche, (4) raccourcis. Supprimer `AdminPage.tsx` (code mort).
- **Réutilise** : Tabs (fiche et détail du Dispositif), Menu, Breadcrumb, Card (bandeau de contexte déjà présent dans `EvaluationPage`), `PermissionDeniedDialog`.
- **Manquant** : aucun.
- **Dépendance** : aucune. L'onglet Analyse affiche « Cette étape sera renseignée prochainement » (spec §6).
- **Point d'attention** : la spec de navigation est encore marquée DRAFT alors que q122 à q125 l'ont décidée. Je la passe à « décidée » dans la revue. Q1 (grille créée seulement depuis un brouillon) demande que A06 confirme la règle serveur pour le cas « grille non rattachée ».
- **Maquette** : menu cible (barre dépliée, repliée, mobile), fiche à onglets, écran Appétence en lecture. Déjà décrits en texte ; à mettre dans l'artefact.
- **Parallèle au backend** : oui, entièrement.

### F2 — Double confirmation et libellé q142 (M)

- **Contenu** : O10 et O11. Le dialogue s'ouvre sur le 409 : il rappelle le principe, la conséquence, demande un motif, puis renvoie la même requête avec `governanceConfirmation`. Il est câblé dans : `EvaluationPage`, décisions de traitement, `ControlMonitoringPage` (exécutions et efficacité), `ActionPlansPage`, `AuditFindingsPage` ; les écrans de revue (F4) et de demande de mode (F3) l'utilisent à leur tour. Les validations du Comité n'ont pas de double confirmation (q159).
- **Réutilise** : Modal, FormField, Button, MessageBanner, badge de F0.
- **Manquant** : `GovernanceConfirmDialog` (spécialisation de `ConfirmWithReasonDialog`).
- **Règle** : l'écran ne décide jamais s'il propose la confirmation. Il réagit au 409. S'il n'y a pas de 409, l'action est refusée en 403 avec le message du serveur.
- **Dépendance** : D4 monté. Pas d'attente.
- **Maquette** : le dialogue (3 états : demande, motif manquant, en cours), le badge dans une liste et dans une fiche.
- **Parallèle au backend** : oui.

### F3 — Réglages de gouvernance et demandes de mode d'évaluation (M)

- **Contenu** : O1 et O4. Réglages : une carte par réglage, état courant, bouton « Modifier » avec motif, bandeau « Demande en attente de <approbateur> » quand le serveur répond 202, boutons Approuver / Rejeter pour l'approbateur tiers (jamais pour l'auteur : le serveur le refuse, l'écran désactive avec la raison). Demandes de mode : tableau des demandes (statut, processus, demandeur), actions selon droit, dialogue de proposition, option « revenir au mode du Dispositif » si le serveur l'offre.
- **Réutilise** : Card, Table, Tabs, Modal, FormField, StatusBadge, MessageBanner, Timeline (parcours de la demande), F0 et F2.
- **Manquant** : rien.
- **Dépendance** : D4 monté. DECISION-069 (« revenir au mode du Dispositif ») : à confirmer avec A06 avant de dessiner l'option.
- **Maquette** : page Réglages (6 cartes), carte « Politique d'auto-validation » dans ses 3 états (active, 202 en attente, rejetée), file des demandes.
- **Parallèle au backend** : oui.

### F4 — Profil d'organisation, désignations, responsabilités de processus (L)

- **Contenu** : O2, O3, O13, O14. Profil : questionnaire de 6 questions (effectif, personnes dans le risque, audit interne, conseil d'administration, comité, supervision), motif, historique en `Timeline`, version en attente, approbation ou rejet par un tiers ; une baisse de taille passe en attente de seconde confirmation, ou s'applique avec le marqueur « seul » quand il n'y a pas de tiers (q157). Désignations : deux emplacements (gérant, intérimaire), date de fin, fin de désignation avec motif. Responsabilités : onglet dans `ProcessesPage`, trois sélecteurs (propriétaire, champion, N-1) avec contrôle « compte actif », proposition de rapprochement par nom, confirmée ligne par ligne (q150).
- **Réutilise** : FormField (radios et champs natifs), Card, Table, Tabs, Timeline, DatePicker, Modal, Button, MessageBanner.
- **Manquant** : un groupe de boutons radio accessible (aucun atome ; composer en champs natifs dans `FormField` au début, créer l'atome si F4 l'impose) ; un sélecteur de compte qui ne montre que les noms que le serveur renvoie.
- **Dépendance** : D2b, D2c, D3 montés. **Contenu du questionnaire** : validé (DECISION-076), mais A13 doit remettre les libellés exacts.
- **Point ouvert** : la désignation de soi-même comme champion est interdite (I-R1) ; voir question Q5.
- **Maquette** : trois écrans + dialogues.
- **Parallèle au backend** : oui. Ce lot peut partir en parallèle de D5 et D6.

### F5 — Panel de gouvernance, revues, acceptations, notifications (L)

- **Contenu** : O5 et O15 (partie notifications et journal). Spec existante : `RM-V1-Panel-Principes-Gouvernance.md`, à **mettre à jour** parce que DECISION-074 la dépasse : (a) la taille vient du profil (F4) et non plus des seuls comptes ; (b) les écarts « déclaré / observé » (`profileGaps`) ; (c) l'acceptation avec motif et durée, qui était déconseillée en V1 dans la question Q3 de la spec, est maintenant décidée (q138) ; (d) le statut `ACCEPTED` ; (e) la revue par un tiers ; (f) les principes « évaluables à la livraison de <fonction> », jamais « respecté » (q151) ; (g) « suivi depuis le <date> » (q143) ; (h) groupe Risk Manager vide en tête du panel (q149) ; (i) masquage des noms (« Personne 1 ») et dates de dernière connexion (q156).
- **Réutilise** : Card, Table, StatusBadge, SegmentedControl, MessageBanner, Pagination, Grid, Tabs, Modal, Breadcrumb, F0 et F2.
- **Manquant** : `PrincipleComparisonColumns` (3 colonnes, colonne recommandée par marqueur textuel + icône + `aria-current`, version repliable mobile) ; mapping gravité → ton de `StatusBadge` ; pastille « Exemple — contenu à valider ».
- **Dépendance** : **D5 et D6 non montés.** Le contenu A13 est encore « Exemple ».
- **Ce qui peut partir tout de suite** : maquettes (liste, détail, dialogues de revue et d'acceptation, états), `PrincipleComparisonColumns` avec données fictives, entrée de menu et compteur. Branchement seulement après D6, **avec les données de test de D6 et pas avant**.
- **Maquette** : liste, détail, 3 colonnes, mobile, revue, acceptation, états vide / erreur / droit manquant / noms masqués.
- **Parallèle au backend** : en partie (maquettes et composants uniquement).

### F6 — Étape Analyse (M)

- **Contenu** : O7. Causes, événements, impacts, contexte, figés à chaque évaluation, rédigés par les personnes de DECISION-064.
- **Réutilise** : Card, FormField, Tabs, Table.
- **Manquant** : éditeur de liste ordonnée (à décider avec la spec).
- **Dépendance** : modèle Analyse à concevoir par A13, A05, A06 (section « Droits et accès »). **Ne pas spécifier de champ avant.** Je ne produis que l'emplacement (déjà dans F1).
- **Parallèle au backend** : non.

### F7 — Souhaitables (L, découpable)

S1 à S8, à répartir en sous-lots selon le temps disponible. Ordre conseillé : **S1** (preuves, le plus gênant à l'usage), S2 (missions), S3 (matrice des droits), S6 (KRI), puis S4, S5, S7, S8. Chacun avec sa maquette. Peut partir en parallèle du backend, mais après F4 pour ne pas ralentir les lots obligatoires.

### F8 — À trancher

Voir section 5. Aucun travail avant la réponse du PO. Si la réponse est « oui », chaque écran reçoit sa maquette puis son lot.

## 4. Ce qui part tout de suite en parallèle du backend

- **F0, F1, F2, F3, F4** n'attendent aucun lot serveur (D2b, D2c, D3, D4 sont montés).
- **F5** : maquettes et composants maintenant ; branchement après D6.
- **Maquettes de tout** : l'artefact de revue peut recevoir les écrans de F0 à F7 dès maintenant.

Pendant que le backend livre D5 et D6, le frontend peut livrer F0 à F4 : c'est la majorité des vues obligatoires (11 des 15).

## 5. Questions au PO

Aucune décision n'est prise ici. Chaque question propose une recommandation d'UX, à confirmer.

**Q1. Dashboards et rapports : faut-il les livrer en V1 ?**
Contexte : le serveur sait déjà calculer six tableaux de bord et six rapports (risques, anomalies, conformité, propriétaire de risque, département, direction ; comité des risques, consolidé, appétence contre résiduel, KRI). L'entrée « Dashboards » est en « À venir ». La décision sur qui voit quel widget (DECISION-002 point 5) est restée ouverte.
Options : (A) aucun en V1 ; (B) un seul tableau de bord (direction) et les rapports en téléchargement ; (C) tous.
Recommandation : **B**. Mais cette question dépend de DECISION-002 point 5 : je ne peux pas spécifier ce qu'un rôle voit tant qu'elle est ouverte.

**Q2. Cycles de revue : dans le périmètre V1 ?**
Contexte : le serveur gère les cycles de revue (création, proposition de clôture, clôture avec double confirmation). L'entrée « Cycles de revue » est en « À venir ». Je n'ai trouvé aucune décision de périmètre.
Options : (A) V1 ; (B) après V1.
Recommandation : **B**, sauf si le contrat de la gestion des risques les rend obligatoires.

**Q3. Gestion des utilisateurs : un écran, ou le fournisseur d'identité et l'API ?**
Contexte : créer, modifier, suspendre, réactiver un compte existe côté serveur. Aucun écran. Les règles de départ du dernier Risk Manager (q149, q160, q161) s'exercent justement à la suspension.
Options : (A) écran d'administration des comptes en V1 ; (B) les comptes se gèrent hors de l'application en V1.
Recommandation : **A** dès que F4 est livré, car la suspension d'un compte est déjà couverte par des règles de gouvernance que l'écran doit expliquer.

**Q4. Mise en service : branding, modules activables, tenants, import Excel.**
Contexte : GRC Tools est un produit commercial (DECISION-066). Ces quatre fonctions existent côté serveur. Un client doit-il les voir, ou seulement l'éditeur ?
Options : (A) aucun écran en V1, opérations de l'éditeur par API ; (B) écrans « Modules » et « Identité visuelle » pour l'administrateur client, import Excel et tenants restent à l'éditeur ; (C) tous.
Recommandation : **A**. La mise en service est faite par l'éditeur aujourd'hui, et DECISION-058 demande déjà d'ajouter un motif au changement de module avant de l'exposer à un client.

**Q5. En structure à une personne, le Risk Manager peut-il se désigner lui-même champion de processus ?**
Contexte : l'interdiction d'auto-désignation (I-R1) n'a aucune exception. En structure à une personne, le Risk Manager n'a donc personne pour se nommer champion. Cela touche l'écran des responsabilités de processus. Le point est ouvert dans `ACTION_ITEMS.md` (D2b).
Options : (A) interdiction maintenue ; (B) exception avec double confirmation, motif et marqueur « sans validation indépendante », comme DECISION-066.
Recommandation UX : **B**, cohérente avec « ne jamais bloquer ». L'arbitrage revient à A13 puis au PO.

**Q6. Acceptation d'un principe et revue par un tiers : même écran que le panel ?**
Contexte : la spec UX du panel déconseillait l'acceptation en V1. Le PO l'a décidée (q138). Deux emplacements possibles pour les actions.
Options : (A) dans le détail du principe (un seul endroit) ; (B) dans une page « Décisions de gouvernance » séparée.
Recommandation : **A**. Moins de navigation, et le panel reste en lecture pour qui n'a pas le droit.

## 6. Dépendances et risques pour l'orchestrateur

1. **Écart client HTTP / serveur** : sans F0, les écrans F2 et F3 ne peuvent pas fonctionner. À dispatcher d'abord à Dev Frontend, avec une question à A06 sur la forme structurée du 409.
2. **Spec de navigation encore DRAFT** : à passer en « décidée » (q122 à q125) avant dispatch de F1.
3. **Spec du panel à réviser** (DECISION-074/075/077/078 la dépassent) : travail A04 à prévoir avant F5.
4. **Contenu A13** : le panel est en « Exemple ». Livrer F5 avec la pastille « Exemple » et ne pas la retirer sans validation PO écrite dans `ACTION_ITEMS.md` (règle 7bis).
5. **Passages de contrôle** : QA et Sécurité après chaque lot ; Compliance après F4 et F5 (séparation des fonctions, données personnelles de la dernière connexion, A15 R3/R5/R6 encore ouverts pour D6).
6. **Pas de nouvelle règle côté écran** : le seul calcul toléré est l'affichage (tri, filtre sur ce que le serveur a renvoyé).
