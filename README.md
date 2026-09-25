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
- ✅ Backend : squelette en couches posé, premier vertical slice **Risks**
  (domaine → service → repository Postgres → API `/api/v1/risks`) avec
  tests unitaires, build et audit de sécurité des dépendances vérifiés.
- ✅ Frontend : squelette React + Vite posé, page Risks reliée à l'API.
- ⬜ Authentification Google réelle côté frontend (actuellement un champ
  de saisie de token, pour dev uniquement).
- ⬜ Reste du périmètre Apps Script (contrôles, exécutions, efficacité,
  anomalies, cartographie, IAM, workflow maker-checker) à porter vers le
  backend, module par module.
- ⬜ Export Apps Script → import backend (pont de migration des données Djamo).
