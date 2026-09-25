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

- ✅ Apps Script legacy : fonctionnel, inchangé, toujours en production pour Djamo.
- ✅ Backend : squelette en couches posé, 4 vertical slices complets
  (domaine → service → repository Postgres → API), tous testés
  (29 tests unitaires), build et audit de sécurité des dépendances verts :
  - **Risks** (`/api/v1/risks`) — CRUD, transitions d'état, archivage avec raison.
  - **Evidence** (`/api/v1/evidences`) — upload/lecture/suppression via Google
    Drive, isolation stricte par tenant (voir la revue de sécurité qui a
    identifié et corrigé ce point).
  - **Controls** (`/api/v1/controls`) — catalogue des contrôles, lien
    many-to-many avec les risques couverts.
  - **ControlExecutions** (`/api/v1/executions`) — historisé (append-only),
    validation maker-checker.
- ✅ Frontend : squelette React + Vite posé, page Risks reliée à l'API,
  connexion Google Identity Services réelle (avec repli dev si
  `VITE_GOOGLE_CLIENT_ID` n'est pas encore configuré).
- ✅ `CLAUDE.md` à la racine pour les futures sessions Claude Code.
- ⬜ Configuration réelle : projet Neon, client OAuth Google, service
  account Drive — rien de tout ça n'existe encore, le backend ne peut
  pas tourner en vrai tant que ce n'est pas fait.
- ⬜ Reste du périmètre Apps Script (efficacité, anomalies, cartographie,
  IAM, journal global) à porter vers le backend, module par module — le
  vertical slice **Risks**/**Evidence** est le gabarit à suivre (voir
  `CLAUDE.md`).
- ⬜ Export Apps Script → import backend (pont de migration des données Djamo).
