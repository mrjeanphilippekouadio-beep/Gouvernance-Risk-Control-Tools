# Database — Neon PostgreSQL

## Mise en place

1. Créer un projet sur https://neon.tech (le plan gratuit suffit pour le développement).
2. Copier la connection string (`postgresql://...?sslmode=require`) dans
   `backend/.env` sous `DATABASE_URL`. Utiliser une **branche Neon
   dédiée** pour le développement (`neon branches create`) plutôt que la
   branche `main` — c'est l'intérêt de Neon : réinitialiser la base de
   dev sans toucher à la donnée de référence.
3. Appliquer les migrations :
   ```bash
   cd backend
   npm install
   npm run migrate
   ```
4. (Optionnel, dev uniquement) Charger le jeu de données de démonstration :
   ```bash
   psql "$DATABASE_URL" -f database/postgresql/seed/dev_seed.sql
   ```

## Séparation des rôles PostgreSQL

Le backend et le processus de migration ne doivent **pas** utiliser le même
rôle PostgreSQL en production :

```text
Cloud Run runtime
  DATABASE_URL
      ↓
  grc_runtime
  DML applicatif uniquement
  + protections audit_log

Migration job / maintenance
  MIGRATION_DATABASE_URL
      ↓
  grc_migrator
  privilèges DDL nécessaires
```

Règle opérationnelle :
- `DATABASE_URL` est le seul secret DB injecté dans le conteneur Cloud Run
  qui reste en exécution.
- `MIGRATION_DATABASE_URL` est réservé au job de migration / à une
  opération de maintenance contrôlée.
- En production, `npm run migrate` refuse de fonctionner sans
  `MIGRATION_DATABASE_URL`, refuse de réutiliser `DATABASE_URL`, puis
  compare les rôles PostgreSQL réellement connectés.
- Le runtime refuse de démarrer si `MIGRATION_DATABASE_URL` est présent
  dans son environnement production.
- Le rôle runtime doit rester sans privilèges `CREATE ROLE`,
  `CREATE DATABASE` ou `CREATE` dans le schéma `public`.

## Vérification de sécurité (avant tout déploiement)

Avant de pointer un environnement de production vers une base Neon,
vérifier manuellement :

- [ ] `sslmode=require` dans la connection string.
- [x] Le backend vérifie au démarrage que le rôle runtime est distinct du
      propriétaire/admin Neon, n'est pas `SUPERUSER`, ne peut pas créer de
      rôle/base et ne peut pas créer dans le schéma `public`.
- [x] Le rôle runtime ne possède pas `UPDATE`/`DELETE`/`TRUNCATE`
      sur `audit_log` et possède les droits `SELECT`/`INSERT` nécessaires.
- [x] La migration 038 protège `audit_log` au niveau PostgreSQL contre
      `UPDATE`/`DELETE`/`TRUNCATE`.
- [x] Le runner de migrations utilise une connexion dédiée en production
      via `MIGRATION_DATABASE_URL` et vérifie que le rôle de migration
      est différent du rôle runtime.
- [x] Le runtime production refuse la présence de
      `MIGRATION_DATABASE_URL`.
- [ ] Le compte de migration réellement configuré dans l'infrastructure
      possède uniquement les privilèges DDL nécessaires aux migrations et
      n'est pas utilisé par Cloud Run.
- [ ] Aucune connection string n'est committée.
- [x] Le contrôle Gitleaks est exécuté dans la CI et bloque une PR lorsqu'un secret détectable est trouvé dans le dépôt ou son historique.
- [ ] Le frontend ne reçoit jamais `DATABASE_URL` ou
      `MIGRATION_DATABASE_URL`.

## Limite importante

Cette séparation est maintenant imposée par le code du runner et du runtime,
mais la création des rôles, la distribution des secrets et l'autorisation du
job de migration restent des contrôles d'infrastructure à configurer dans
Neon / Google Cloud.