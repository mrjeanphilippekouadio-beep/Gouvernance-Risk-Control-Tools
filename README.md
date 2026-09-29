# GRC Tools

Plateforme de gestion des risques et de contrôle interne (GRC), en
transition d'un outil Google Apps Script interne vers une architecture en
couches (backend TypeScript + PostgreSQL + Google Drive), prête pour un
usage SaaS multi-tenant futur. Contexte complet de la décision :
[docs/architecture/ADR-001-cible-architecture.md](docs/architecture/ADR-001-cible-architecture.md).

## Structure du monorepo

| Dossier | Rôle |
|---|---|
| `apps-script-legacy/` | Outil Apps Script actuel (container-bound, Sheets comme base). Reste en production pendant la transition — voir son propre [README](apps-script-legacy/README.md). |
| `backend/` | API TypeScript (Express, Cloud Run). Domaine métier, repository pattern, audit trail. |
| `frontend/` | React + Vite + TypeScript. Aucune logique métier — présentation et appels API uniquement. |
| `database/` | Migrations SQL versionnées (Neon PostgreSQL) et jeu de données de démonstration. |
| `docs/architecture/` | Document d'échange complet + décisions d'architecture (ADR). |

## Configuration de l'infrastructure (Neon, OAuth Google, Drive)

Avant de pouvoir démarrer le backend pour de vrai, il faut créer un
projet Neon, un client OAuth Google et un service account Drive — guide
pas-à-pas dans [docs/SETUP.md](docs/SETUP.md).

## Démarrer en local

### Backend

```bash
cd backend
cp .env.example .env   # renseigner DATABASE_URL (Neon), GOOGLE_OAUTH_CLIENT_ID, etc.
npm install
npm run migrate        # applique database/postgresql/migrations/
npm run dev
```

`GET http://localhost:8080/health` doit répondre `{"status":"ok"}`.

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Principes d'architecture (rappel)

1. Le frontend ne contient aucune règle métier, aucune transition d'état.
2. Le domaine métier ne dépend jamais directement d'un moteur de
   persistance, de stockage ou d'identité — uniquement d'interfaces
   (`Repository`, `DocumentStorage`, `IdentityProvider`).
3. `tenant_id` sur les tables métier dès la première migration.
4. Journal d'audit dès la V1, jamais limité aux connexions.
5. Aucun secret dans le code — variables d'environnement uniquement.
6. Pas de suppression physique par défaut (soft delete).

Détails complets dans [docs/architecture/ADR-001-cible-architecture.md](docs/architecture/ADR-001-cible-architecture.md).

## État actuel

*(Dernière vérification : 2026-09-29, contre le code réel — pas un résumé de session.)*

- ✅ Apps Script legacy : fonctionnel, inchangé, toujours en production pour Djamo.
- ✅ Backend : architecture en couches (domaine → service → repository
  Postgres → API) sur **33 services** (`backend/src/services/`) et
  **37 groupes de routes** (`backend/src/api/v1/`), **37 fichiers de
  tests / 446 tests unitaires verts** (`npm test`), build et audit de
  sécurité des dépendances verts.
  Regroupés par domaine fonctionnel :
  - **Risques & évaluation** — `Risk` (`/api/v1/risks`, CRUD, transitions
    d'état, archivage avec raison), **moteur de cotation**
    `RiskEvaluation` (`/api/v1/risk-evaluations`, axes d'impact multiples,
    seuils d'appétence, cycle brouillon → validation), `RiskCategory`,
    `RiskAppetite`, `RiskOwnership` (propriétaires affichés/audités,
    jamais autoritatifs pour l'instant), import de masse
    (`RiskImportService`, mode dry-run).
  - **Contrôles** — `Control` (catalogue, lien many-to-many avec les
    risques couverts), `ControlExecution` (historisé append-only,
    maker-checker), `ControlEffectivenessAssessment` (distinct de
    l'exécution — "exécuté ne veut pas dire efficace" —, même circuit
    maker-checker).
  - **Gouvernance** — `RaciAssignment` (matrice RACI par objet métier,
    reliée au frontend), `GrcObjectType` (type d'objet unifié partagé par
    RACI/ActionPlan/Notification, pensé pour éviter la prolifération
    d'enums ad hoc), `GovernanceService` (revue/cycles), `RoleService`
    (permissions scopées par rôle).
  - **Référentiels** — `RatingScale`, `Department`, `Process` (hiérarchie
    à 3 niveaux auto-référencée), `RegulatoryFramework`, `Config`
    (dont le mode Classique/Participatif par défaut tenant, voir
    ci-dessous).
  - **KPI/KRI/Dashboard/Cartography/Reporting** — `Kpi`/`KpiMeasure`,
    `Kri`/`KriMeasure` (calcul de statut automatique), `DashboardService`,
    `CartographyService`, génération de rapports (`reports.routes.ts`).
  - **Notification/Governance/ModuleToggle/Branding/AuditLog** —
    `NotificationService` (+ abonnements), `ModuleToggleService`
    (activation de modules par tenant), `BrandingService`
    (personnalisation tenant), `AuditLogService` (journal global
    automatique — chaque service y écrit déjà, avec recherche dédiée).
  - **Anomalies/ActionPlan** — `Anomaly` (cycle de vie NEW →
    UNDER_ANALYSIS → ACTION_IN_PROGRESS → CLOSED, clôture avec commentaire
    obligatoire), `ActionPlan` (+ dashboard dédié
    `actionPlanDashboard.routes.ts`).
  - **Evidence** (`/api/v1/evidences`) — upload/lecture/suppression via
    Google Drive, isolation stricte par tenant.
- ✅ Mode d'évaluation **Classique/Participatif** (DECISION-006) : FK
  `risks.process_id` posée (migration 029, pas encore backfillée — voir
  ci-dessous), `Config.evaluationMode` (défaut tenant) et
  `Process.evaluationMode` (résolution héritée à la lecture, jamais
  dénormalisée) posés et testés (migration 030). Le garde-fou de
  validation propriétaire (permission dédiée `evaluationmode.validate`,
  table `process_evaluation_mode_requests`) est spécifié (PO tranché) mais
  **pas encore codé** — non bloquant, prévu au lot Processus.
- ✅ Frontend : React + Vite, périmètre encore volontairement réduit —
  `features/risks` (page Risks reliée à l'API), `features/admin`
  (rôles, feedback), `features/feedback` (widget), plus un panneau RACI
  (`design-system/RaciPanel.tsx`) déjà câblé au vrai backend RACI.
  Connexion Google Identity Services réelle (avec repli dev si
  `VITE_GOOGLE_CLIENT_ID` n'est pas encore configuré).
- ✅ Bibliothèque **`@djamo/design-system`** (`packages/design-system/`) —
  système de design séparé du frontend applicatif, pensé pour être
  réutilisable **hors GRC Tools** : 18 atomes (Button, Card, Table, Modal,
  Tabs, Menu, FormField, DatePicker, FileUpload, etc.) et 6 composants
  graphiques Chart.js (BarChart, LineChart, DoughnutChart, ScatterChart,
  BubbleChart, ProgressBar), plus `DashboardGrid` (grille de widgets
  réordonnable via GridStack). Publié comme package `@djamo/design-system`
  distinct, tokens CSS exportés séparément (`./tokens.css`).
- ✅ `CLAUDE.md` à la racine pour les futures sessions Claude Code.
- ✅ Infrastructure configurée : projet Neon, client OAuth Google, **service
  account Drive** (`GOOGLE_DRIVE_CREDENTIALS_PATH`) en place et requis au
  démarrage. **30 migrations appliquées** (`database/postgresql/migrations/`,
  001 à 030), convention de rollback `.down.sql` établie depuis la
  migration 027 (RACI) — les migrations 027 à 030 ont chacune leur
  `.down.sql`, les précédentes n'en ont pas. `GET /health` et `GET /ready`
  répondent OK contre la vraie base. Guide dans `docs/SETUP.md`.
- ⬜ Backfill `risks.process_id` : la colonne existe (migration 029) mais
  n'est pas peuplée — en données réelles, quasi aucun risque n'a
  aujourd'hui de `processId`. Chantier réel, non planifié.
- ⬜ Écran Processus : pas encore maquetté ni construit côté frontend —
  c'est là que le garde-fou de validation Classique/Participatif sera câblé.
- ⬜ Panneau latéral générique Comments/RACI/Evidence (brief UX
  restructuration plateforme, 2026-09-28) : RACI existe déjà et est câblé
  au vrai backend ; Evidence a un backend complet mais rien côté
  frontend ; Comments n'existe pas du tout en base pour l'instant. Le
  rail d'onglets rétractable unique qui doit les regrouper reste à
  construire.
- ⬜ Reste du périmètre Apps Script (cartographie image, visualisations)
  à évaluer au cas par cas : tout ne se porte pas 1:1.
- ⬜ Export Apps Script → import backend (pont de migration des données Djamo).
