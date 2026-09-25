# ADR-001 — Architecture cible du GRC Tools

Statut : Adopté (2026-09-25)
Contexte complet : voir [architecture_echange_complet.md](./architecture_echange_complet.md)

## Décision

On bascule d'un outil Apps Script container-bound (Sheets comme base de
données) vers une architecture en couches, prête pour un usage SaaS
multi-tenant futur, tout en restant dans l'écosystème Google Cloud pour
l'hébergement.

```
React + Vite + TypeScript (frontend)
        │ HTTPS / API versionnée (/api/v1)
        ▼
Backend TypeScript (Cloud Run)
        │
   Repository Layer (interfaces, pas de dépendance directe à un moteur)
        │
   ┌────┴────┬──────────────┬───────────────┐
   ▼          ▼              ▼               ▼
Neon         Google Drive   Identity        (futur : Firestore,
(PostgreSQL)  (documents)   Platform/SSO     réplicas, analytics)
```

## Choix retenus pour la V1

| Brique | Choix V1 | Pourquoi |
|---|---|---|
| Base de données métier | **Neon (PostgreSQL managé, serverless)** | Postgres standard → le repository pattern reste portable vers Cloud SQL/Supabase si besoin ; branching de DB pratique en dev |
| Documents / preuves | **Google Drive API** | Déjà la préférence exprimée ; séparation données métier / documents dès le départ |
| Authentification | **Google Identity Platform / Workspace SSO** | Reste dans l'écosystème Google ; migrable vers Entra ID/OIDC pour de futurs clients SaaS |
| Backend | **TypeScript sur Cloud Run** | Conteneurisé, stateless, scalable, déployable aussi chez un client (Mode 3 de l'échange) |
| Frontend | **React + Vite + TypeScript** | Aucune logique métier sensible côté client |
| Legacy | **Apps Script conservé tel quel dans `apps-script-legacy/`** | Continue de fonctionner pour Djamo pendant la transition ; sert de référence fonctionnelle pour écrire les cas de test du nouveau backend |

## Principes non négociables (rappel de l'échange)

1. Le frontend ne contient aucune règle métier, aucune transition d'état.
2. Le domaine métier ne dépend jamais directement de Neon/Postgres/Drive —
   uniquement d'interfaces `Repository` / `DocumentStorage` / `IdentityProvider`.
3. `tenant_id` sur les tables métier dès la première migration, même
   mono-client aujourd'hui.
4. Journal d'audit dès la V1 (`CREATE/UPDATE/DELETE/SUBMIT/VALIDATE/...`).
5. Aucun secret dans le code ou dans un fichier versionné — variables
   d'environnement uniquement (`.env` est gitignoré).
6. Pas de suppression physique par défaut (soft delete).
7. Migrations SQL versionnées dans `database/postgresql/migrations/`.

## Ce qu'on NE fait PAS en V1 (pour ne pas sur-architecturer)

- Pas de support simultané Firestore/Supabase — uniquement Neon Postgres,
  mais derrière l'interface Repository.
- Pas d'event bus / webhooks tant qu'aucun besoin réel ne le justifie.
- Pas de réplication multi-base tant qu'il n'y a qu'un tenant réel.
- Pas de custom fields dynamiques tant qu'aucun client ne le demande.

## Prochaine étape

Découpage exact Backend / Domain / Repository / Infrastructure (fait dans
`backend/src/`), puis premier vertical slice fonctionnel : **Risks**
(entité la plus centrale), du domaine jusqu'à l'API, pour valider le
schéma de couches de bout en bout avant de porter le reste du périmètre
Apps Script.
