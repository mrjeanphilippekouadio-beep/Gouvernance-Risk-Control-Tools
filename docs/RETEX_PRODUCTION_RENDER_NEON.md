# RETEX — Déploiement production Backend Render + Neon PostgreSQL

## 1. Objet

Ce document formalise le retour d'expérience du déploiement du backend GRC Tools en environnement de production.

Périmètre couvert :

- build Docker du backend ;
- déploiement du backend Node.js/Express sur Render ;
- connexion à Neon PostgreSQL ;
- séparation des rôles PostgreSQL runtime / migration ;
- contrôles de sécurité des privilèges ;
- migrations PostgreSQL ;
- configuration des variables d'environnement de production ;
- contrôles de santé et de readiness ;
- difficultés rencontrées et corrections apportées.

Ce RETEX doit servir de référence pour les prochains déploiements et pour les futures couches d'architecture, notamment le frontend, Cloudflare et les WebSockets.

---

## 2. Architecture validée

Architecture cible actuellement validée :

```
Client / Internet
      |
      v
   Render
      |
      v
Node.js / Express
      |
      v
grc_app_runtime
      |
      v
Neon PostgreSQL
```

Le backend est construit depuis le dépôt GitHub et utilise :

- Node.js 26 ;
- TypeScript ;
- Express ;
- Docker ;
- PostgreSQL sur Neon.

Le Web Service Render utilise le Dockerfile :

```
backend/Dockerfile
```

Le contexte Docker doit rester la racine du dépôt.

---

## 3. Point de départ et contraintes

Le projet devait être déployé avec une séparation stricte entre :

- le rôle utilisé par l'application ;
- le rôle utilisé pour les migrations.

Le rôle runtime ne doit pas disposer de privilèges DDL ou d'administration de la base.

Les contraintes de sécurité retenues sont notamment :

- pas de SUPERUSER pour le runtime ;
- pas de CREATEROLE ;
- pas de CREATEDB ;
- pas de CREATE sur le schéma `public` ;
- pas de UPDATE/DELETE/TRUNCATE sur `audit_log` ;
- accès SELECT/INSERT à `audit_log` ;
- accès limité sur `schema_migrations`.

---

## 4. Incident n°1 — Mauvais contexte de build Docker

### Symptôme

Le premier déploiement Render échouait pendant le build avec :

```
npm error Missing script: "build"
```

### Cause

Le Dockerfile utilisait le `package.json` situé à la racine du dépôt alors que le script `build` appartient au workspace backend.

### Correction

Le Dockerfile a été corrigé pour utiliser explicitement :

```dockerfile
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./

RUN npm run build
```

La correction a été intégrée via la PR #81.

### Leçon

Le contexte Docker et le `WORKDIR` doivent être explicitement cohérents avec la structure du monorepo.

---

## 5. Incident n°2 — Rôle Neon trop privilégié

### Symptôme

Le contrôle de sécurité du backend refusait le rôle initial utilisé par l'application.

Le rôle possédait notamment des privilèges incompatibles avec le modèle de sécurité attendu :

- CREATEDB ;
- CREATEROLE ;
- privilèges hérités du modèle de rôles gérés par Neon ;
- droits UPDATE/DELETE sur `audit_log`.

### Cause

Les rôles créés via les mécanismes gérés de Neon pouvaient être membres de `neon_superuser`.

La révocation directe de cette appartenance n'était pas possible avec les privilèges disponibles.

### Correction

Un rôle runtime dédié a été créé directement en SQL :

```sql
CREATE ROLE grc_app_runtime
WITH LOGIN PASSWORD '...';
```

Puis les attributs ont été vérifiés :

```
rolsuper       = false
rolcreaterole  = false
rolcreatedb    = false
rolinherit     = true
rolcanlogin    = true
rolreplication = false
rolbypassrls   = false
```

Aucune appartenance à `neon_superuser` n'a été conservée.

### Leçon

Pour un rôle applicatif soumis à des exigences de moindre privilège, privilégier un rôle PostgreSQL créé directement avec SQL plutôt qu'un rôle provisionné avec des privilèges administratifs hérités.

---

## 6. Création du rôle de migration

Un second rôle SQL-native a été créé :

```
grc_migrator_runtime
```

Ses attributs ont également été vérifiés :

```
rolsuper       = false
rolcreaterole  = false
rolcreatedb    = false
rolinherit     = true
rolcanlogin    = true
rolreplication = false
rolbypassrls   = false
```

Le rôle dispose des droits nécessaires à l'exécution des migrations, notamment :

```sql
GRANT USAGE, CREATE
ON SCHEMA public
TO grc_migrator_runtime;
```

Il ne s'agit pas du rôle utilisé par le serveur applicatif.

---

## 7. Incident n°3 — Échec de migration lié à l'ancien propriétaire

### Symptôme

La migration devait fonctionner avec le rôle dédié de migration alors que des objets PostgreSQL existants pouvaient appartenir à un autre rôle.

### Risque

Un rôle de migration qui n'est pas propriétaire des tables existantes peut rencontrer des limitations lors de futures migrations nécessitant des opérations DDL.

### Correction

Un préflight de propriété des tables publiques a été ajouté au runner de migrations.

Le runner vérifie les objets existants du schéma `public` et refuse de poursuivre si une table applicative est détenue par un autre rôle.

Le message indique alors explicitement que la propriété doit être transférée au rôle de migration.

Cette logique a été ajoutée dans :

```
backend/src/infrastructure/database/postgres/runMigrations.ts
backend/src/infrastructure/database/postgres/migrationDatabaseSecurity.ts
```

### Leçon

La séparation des rôles ne se limite pas aux privilèges : la propriété des objets PostgreSQL doit également être cohérente avec le rôle responsable des migrations.

---

## 8. Migration des privilèges runtime

Une migration dédiée a été ajoutée :

```
database/postgresql/migrations/043_runtime_default_privileges.sql
```

Elle établit notamment :

- USAGE sur `public` pour le runtime ;
- SELECT/INSERT/UPDATE/DELETE sur les tables applicatives ;
- SELECT/INSERT uniquement sur `audit_log` ;
- SELECT uniquement sur `schema_migrations` ;
- interdiction de UPDATE/DELETE/TRUNCATE sur `audit_log` ;
- interdiction de INSERT/UPDATE/DELETE/TRUNCATE sur `schema_migrations` ;
- privilèges par défaut pour les futures tables créées par le rôle de migration.

Cette migration permet de rendre la baseline de privilèges reproductible.

---

## 9. Validation locale de la base

La base Neon a été contrôlée avant le déploiement.

Résultats :

- rôle courant des migrations : `grc_migrator_runtime` ;
- rôle runtime : `grc_app_runtime` ;
- aucune appartenance du runtime à `neon_superuser` ;
- tables publiques existantes détenues par le rôle de migration ;
- `schema_migrations` contient 43 migrations appliquées ;
- dernière migration : `043_runtime_default_privileges.sql`.

Le contrôle du rôle runtime a confirmé :

```
SUPERUSER       = false
CREATEROLE      = false
CREATEDB        = false
CREATE public   = false
```

Pour `audit_log` :

```
SELECT     = true
INSERT     = true
UPDATE     = false
DELETE     = false
TRUNCATE   = false
```

Pour `schema_migrations` :

```
SELECT     = true
INSERT     = false
UPDATE     = false
DELETE     = false
```

---

## 10. Validation du backend en local

Le backend a été compilé avec succès :

```
npm.cmd run build
```

Les tests backend ont également été exécutés avec succès :

```
53 test files passed
628 tests passed
```

Les endpoints locaux ont ensuite été contrôlés :

### Health

```
GET /health

{"status":"ok"}
```

### Readiness

```
GET /ready

{"status":"ready","database":"ok"}
```

Le second contrôle confirme que l'application peut accéder à PostgreSQL avec le rôle runtime.

---

## 11. Incident n°4 — Variable Google Drive incompatible avec la production

### Symptôme Render

Après réussite du build Docker, le processus quittait immédiatement avec :

```
Invalid production configuration:
GOOGLE_DRIVE_CREDENTIALS_PATH must not be set;
use the Cloud Run service identity.
```

### Cause

Une variable d'environnement prévue pour un mode local/ancien mode d'authentification était présente dans l'environnement de production.

### Correction

La variable suivante a été supprimée du Web Service Render :

```
GOOGLE_DRIVE_CREDENTIALS_PATH
```

### Leçon

Les variables d'environnement destinées au développement local ne doivent pas être recopiées automatiquement dans l'environnement de production.

---

## 12. Incident n°5 — Variable de migration présente dans le runtime

### Symptôme Render

Le build était réussi, mais le serveur refusait de démarrer avec :

```
Invalid production configuration:
MIGRATION_DATABASE_URL must not be present in the runtime environment.
```

### Cause

Le secret de migration avait été injecté dans le Web Service Render.

### Correction

```
MIGRATION_DATABASE_URL
```

a été supprimée de l'environnement du Web Service.

### Règle retenue

Le runtime applicatif utilise uniquement :

```
DATABASE_URL
    ↓
grc_app_runtime
```

Le secret :

```
MIGRATION_DATABASE_URL
    ↓
grc_migrator_runtime
```

ne doit pas être présent dans le processus long-running de production.

### Leçon

Les credentials de migration doivent être traités comme des credentials de privilège élevé et isolés du runtime applicatif.

---

## 13. Configuration production Render

Configuration minimale retenue pour le Web Service :

```
NODE_ENV=production
DATABASE_URL=<connexion Neon de grc_app_runtime>
GOOGLE_OAUTH_CLIENT_ID=<client OAuth Google>
CORS_ALLOWED_ORIGINS=<origine frontend>
```

Ne doivent pas être présents dans le Web Service :

```
MIGRATION_DATABASE_URL
GOOGLE_DRIVE_CREDENTIALS_PATH
```

Le frontend doit être l'origine autorisée par CORS. L'URL du backend ne doit pas être utilisée comme origine CORS.

---

## 14. Déploiement final

Le déploiement Render a finalement atteint :

```
Deploy succeeded | Live
```

Le build final a utilisé le commit :

```
5174bd2cbd7a5cf3ed3425c2a156708f4523cb24
```

Le pipeline a donc validé :

1. clonage du dépôt ;
2. checkout de `main` ;
3. build Docker ;
4. installation des dépendances ;
5. compilation TypeScript ;
6. création de l'image ;
7. démarrage du conteneur ;
8. validation de la configuration de production ;
9. mise en ligne du service.

---

## 15. Points de sécurité retenus

### Runtime

Le rôle applicatif :

```
grc_app_runtime
```

doit rester :

- non-superuser ;
- non-creator de rôles ;
- non-creator de bases ;
- sans CREATE sur `public` ;
- sans modification/suppression de `audit_log`.

### Migration

Le rôle :

```
grc_migrator_runtime
```

est réservé aux migrations.

Il ne doit pas devenir le rôle de connexion du backend.

### Audit

`audit_log` reste append-only au niveau PostgreSQL.

### Secrets

Les secrets ne doivent jamais être :

- committés dans Git ;
- copiés dans le frontend ;
- injectés inutilement dans le runtime ;
- partagés dans les messages ou logs.

---

## 16. Points d'attention pour la suite

### 16.1 Migrations de production

Le runner de migration exige en production :

```
MIGRATION_DATABASE_URL
```

mais cette variable ne doit pas être présente dans le Web Service.

Il faut donc utiliser un mécanisme séparé et contrôlé pour exécuter les migrations de production avec `grc_migrator_runtime`.

### 16.2 SSL PostgreSQL

Les chaînes de connexion doivent utiliser explicitement un mode SSL approprié, idéalement :

```
sslmode=verify-full
```

avec le paramétrage de channel binding retenu par l'environnement.

Les avertissements observés pendant les tests indiquent qu'il faut éviter de dépendre des anciens alias de `sslmode`.

### 16.3 CORS

La valeur temporaire de développement :

```
http://localhost:5173
```

devra être remplacée ou complétée par l'origine réelle du frontend de production.

### 16.4 WebSockets

Les WebSockets ne font pas partie de ce déploiement backend initial.

Ils constituent une couche ultérieure de l'architecture pour les notifications et actions temps réel déjà prévues dans le PRD.

---

## 17. Chronologie synthétique

| Étape | Résultat |
|---|---|
| Premier build Render | Échec : mauvais contexte/package.json |
| PR #81 | Dockerfile corrigé |
| Build Docker suivant | Succès |
| Rôle Neon initial | Trop privilégié |
| Création `grc_app_runtime` | Succès |
| Création `grc_migrator_runtime` | Succès |
| Contrôle des privilèges | Succès |
| Préflight ownership migrations | Ajouté |
| Migration 043 | Appliquée |
| Tests backend | 628/628 |
| `/health` local | OK |
| `/ready` local | Database OK |
| Render — Google Drive credentials | Corrigé |
| Render — migration credentials | Corrigé |
| Déploiement final | **Live** |

---

## 18. Conclusion

Le retour d'expérience montre que le principal enjeu du déploiement n'était pas le build applicatif, mais la cohérence entre :

- structure du monorepo ;
- Docker ;
- modèle de rôles Neon ;
- propriété des objets PostgreSQL ;
- privilèges runtime ;
- credentials de migration ;
- variables de production ;
- contrôles de démarrage.

La configuration finale sépare clairement le runtime applicatif du processus de migration et impose les contrôles de sécurité au démarrage.

Cette base est maintenant prête pour les étapes suivantes du projet : déploiement du frontend, configuration Cloudflare, intégration OAuth de production, puis ajout de la couche WebSocket.
