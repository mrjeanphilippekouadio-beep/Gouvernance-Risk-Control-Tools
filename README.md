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
- ✅ Backend : squelette en couches posé, **9 vertical slices** complets
  (domaine → service → repository Postgres → API), tous testés
  (54 tests unitaires), build et audit de sécurité des dépendances verts :
  - **Risks** (`/api/v1/risks`) — CRUD, transitions d'état, archivage avec raison.
  - **Evidence** (`/api/v1/evidences`) — upload/lecture/suppression via Google
    Drive, isolation stricte par tenant (voir la revue de sécurité qui a
    identifié et corrigé ce point).
  - **Controls** (`/api/v1/controls`) — catalogue, lien many-to-many avec
    les risques couverts.
  - **ControlExecutions** (`/api/v1/executions`) — historisé (append-only),
    validation maker-checker.
  - **ControlEffectivenessAssessments** (`/api/v1/effectiveness`) — distinct
    des exécutions ("exécuté ne veut pas dire efficace"), même circuit
    maker-checker.
  - **Anomalies** (`/api/v1/anomalies`) — ticket avec cycle de vie
    (NEW → UNDER_ANALYSIS → ACTION_IN_PROGRESS → CLOSED), clôture avec
    commentaire obligatoire.
  - **Departments** (`/api/v1/departments`) — pilote de risque avec
    désignation par défaut (manager) ou explicite.
  - **Processes** (`/api/v1/processes`) — hiérarchie à 3 niveaux
    auto-référencée (Processus > Sous-processus > Activité).
  - **Audit log global** (`/api/v1/audit-log`) — le "journal global" que
    l'Apps Script legacy décrivait sans jamais le raccorder
    automatiquement ; ici c'est automatique par construction, chaque
    service écrit déjà dans `audit_log`.
- ✅ Frontend : squelette React + Vite posé, page Risks reliée à l'API,
  connexion Google Identity Services réelle (avec repli dev si
  `VITE_GOOGLE_CLIENT_ID` n'est pas encore configuré).
- ✅ `CLAUDE.md` à la racine pour les futures sessions Claude Code.
- ✅ Infrastructure configurée : projet Neon (12 migrations appliquées),
  client OAuth Google. `GET /health` et `GET /ready` répondent OK contre
  la vraie base. Guide dans `docs/SETUP.md`.
- ⬜ Service account Drive : pas encore de clé JSON en place localement
  (`GOOGLE_DRIVE_CREDENTIALS_PATH` pointe vers un fichier qui n'existe pas
  encore) — l'upload d'evidences échouera tant que ce n'est pas fait,
  le reste de l'API n'en dépend pas.
- ⬜ **Moteur de cotation des risques** (`10_Evaluation.gs` /
  `20_Validation.gs`) — volontairement pas encore porté. C'est le module
  le plus complexe du legacy : axes d'impact multiples et configurables,
  seuils d'appétence, notation de maîtrise par ligne de défense, moteur
  de champs obligatoires piloté par `CONFIG`. Mérite une conception
  dédiée (le modèle `RiskAssessment` déjà posé dans `domain/entities/`
  est un point de départ simplifié, pas le modèle final) plutôt qu'un
  portage mécanique comme les 9 slices ci-dessus.
- ⬜ Reste du périmètre Apps Script (IAM/RBAC — modèle différent
  maintenant que les permissions sont scopées par rôle plutôt que RACI —,
  cartographie image, visualisations) à évaluer au cas par cas : tout ne
  se porte pas 1:1.
- ⬜ Export Apps Script → import backend (pont de migration des données Djamo).
