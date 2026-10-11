# Mémoire dev-db (A07)

## 2026-10-11 — incident staging, migration 050 (scale 3→6)
- 050 faisait `DROP CONSTRAINT risks_probability_check` : échec sur Neon staging.
  Cause réelle : ces CHECK (probability/impact/residual_*) vivent sur
  `risk_assessments` (003), la table `risks` n'a pas ces colonnes. Le nom était
  deviné ET la table était fausse.
- Règle : ne jamais `DROP CONSTRAINT` par nom deviné sur une base existante.
  Vérifier table/colonne dans la migration d'origine (grep CREATE TABLE), puis
  utiliser un bloc `DO $$` qui retrouve les CHECK mono-colonne via `pg_constraint`
  (contype='c', conkey = ARRAY[attnum], conrelid = schéma courant) et les supprime.
- Vérifier une migration sur un Postgres local jetable (initdb dans /tmp, rôle
  `grc_app_runtime` + table `schema_migrations` à créer avant 043) en appliquant
  003…N avec ET sans noms de contraintes altérés. Un fichier non enregistré dans
  `schema_migrations` (rollback transactionnel) peut être corrigé en place.
