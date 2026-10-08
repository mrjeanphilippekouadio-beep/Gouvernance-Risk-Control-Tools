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

## État actuel (octobre 2026)

*Mis à jour le 2026-10-08. Les faits d'environnement (Render, Neon, dates de
déploiement) viennent du suivi `.claude/agent-context/ACTION_ITEMS.md` et ne
sont pas vérifiables depuis le dépôt seul. Le détail des chantiers est dans
[docs/ROADMAP-V1.md](docs/ROADMAP-V1.md).*

### Ce qui tourne

- **Apps Script legacy** (`apps-script-legacy/`) : toujours en production
  pour Djamo, inchangé pendant la transition.
- **Backend** (`backend/`) et **frontend** (`frontend/`) : hébergés sur
  Render, avec un environnement de staging et un environnement de production.
- **Base de données** : PostgreSQL sur Neon (bases de staging et de
  production, voir `.github/workflows/migrate.yml`). Les migrations vont de
  `001` à `046` dans `database/postgresql/migrations/`.

### Ce qui est en cours

- **V1 Risk Management**, livrée par releases **R0 à R5** : R0 assainissement
  et correctifs, R1 fondations du Dispositif, R2 rôles, saisie et validation,
  R3 écrans et contributions, R4 signalement confidentiel, R5 recette et mise
  en production. Détail dans [docs/ROADMAP-V1.md](docs/ROADMAP-V1.md).
- **Page de pilotage** des arbitrages du Product Owner :
  https://claude.ai/artifact/LQgXExeGTqAHxijeSrSRf3
- **Chantiers ouverts** (non exhaustif) : sauvegarde quotidienne de la base
  de production (décidée, pas encore livrée dans `.github/workflows/`),
  choix de région et de plan d'hébergement pour la production, backfill de
  `risks.process_id`, écran Processus, panneau latéral Commentaires / RACI /
  Preuves.

### Branches et déploiement

- `staging` sert à l'intégration ; `main` correspond à la production.
- Le travail se fait par pull request vers `staging`, puis la promotion de
  `staging` vers `main` est faite par pull request.
- La CI (`.github/workflows/ci.yml`) s'exécute sur chaque pull request.
- Les migrations SQL sont appliquées par le workflow `migrate.yml` lors d'un
  push sur `staging` ou `main` qui modifie `database/postgresql/migrations/`.
  Procédure complète : [docs/runbook/migrations.md](docs/runbook/migrations.md).
