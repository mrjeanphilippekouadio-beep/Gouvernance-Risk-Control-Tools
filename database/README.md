# Database — Neon PostgreSQL

## Mise en place

1. Créer un projet sur [neon.tech](https://neon.tech) (le plan gratuit
   suffit pour le développement).
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

## Convention

- `migrations/NNN_description.sql` — appliquées dans l'ordre, une seule
  fois chacune, suivies dans `schema_migrations`. Ne jamais modifier une
  migration déjà appliquée en production : en écrire une nouvelle.
- `seed/` — données de confort pour le développement local uniquement,
  jamais exécutées automatiquement, jamais visées pour la production.

## Vérification de sécurité (avant tout déploiement)

Avant de pointer un environnement de production vers une base Neon,
vérifier manuellement (l'automatisation de ce contrôle est un chantier
futur, pas encore fait) :

- [ ] `sslmode=require` dans la connection string (Neon l'impose par
      défaut — ne pas le désactiver).
- [ ] Le rôle applicatif utilisé par le backend n'est **pas** le rôle
      propriétaire/admin Neon.
- [ ] Aucune connection string n'est committée (`.env` est gitignoré —
      vérifier `git status` avant de commit si un fichier `.env*` apparaît).
- [ ] Le frontend ne reçoit jamais `DATABASE_URL` (le backend est le seul
      composant qui s'y connecte — voir ADR-001).
- [x] **Protection DB de l'intégrité du journal** : la migration
      `038_audit_log_append_only.sql` interdit explicitement à `PUBLIC`
      `UPDATE`/`DELETE`/`TRUNCATE` et ajoute des triggers PostgreSQL qui
      rejettent ces opérations. Cela protège aussi le cas où le backend
      utilise le propriétaire de la table : les `REVOKE` seuls ne suffiraient
      pas dans ce cas.
- [ ] **À vérifier avant production** : le rôle utilisé par le backend
      doit rester un rôle applicatif dédié, distinct du propriétaire/admin de
      la base. Un propriétaire ou superuser peut toujours désactiver/supprimer
      le trigger ou modifier le schéma ; ce contrôle opérationnel reste donc
      nécessaire en complément de la migration.
