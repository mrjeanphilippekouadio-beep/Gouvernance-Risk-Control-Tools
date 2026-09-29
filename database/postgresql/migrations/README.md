# Migrations — convention

## Comment les migrations forward sont appliquées

`npm run migrate` (backend/package.json) exécute
`backend/src/infrastructure/database/postgres/runMigrations.ts` : il lit
tous les fichiers `.sql` de ce dossier (hors `.down.sql`, voir plus bas),
les trie par nom, exécute ceux qui ne sont pas encore dans la table
`schema_migrations` (une ligne par fichier appliqué), chacun dans sa
propre transaction. **Forward-only** : ce runner n'a aucune commande de
rollback intégrée.

## Convention de rollback (down migration)

Avant cette convention, aucune migration de ce projet n'avait de rollback
documenté ou testé — signalé deux fois par Release Manager
(`.claude/agent-context/ACTION_ITEMS.md`) au sujet de
`027_raci_assignments.sql`. Cette convention s'applique à **toutes les
migrations**, passées et futures, pas seulement RACI.

**Règle** : toute nouvelle migration `NNN_nom.sql` qui modifie le schéma
ou les données doit être accompagnée d'un fichier `NNN_nom.down.sql` dans
ce même dossier, qui annule exactement ce que la migration forward a
fait — l'inverse, pas une réécriture.

- Le fichier `.down.sql` n'est **jamais** exécuté automatiquement par
  `npm run migrate` (le runner ignore tout fichier ne finissant pas
  strictement par `.sql`... en réalité il matche `*.sql`, donc
  `NNN_nom.down.sql` matche aussi `.endsWith(".sql")` et **serait** lu
  comme une migration forward si on le laissait dans ce dossier sans
  précaution — voir la note ci-dessous).
- Une migration destructive (`DROP TABLE`, `DROP COLUMN`, perte de
  données) doit documenter en commentaire, dans le `.down.sql`
  lui-même, à partir de quel moment le rollback n'est plus sûr (typiquement :
  dès qu'une migration ultérieure dépend de l'objet supprimé/modifié).

### Note sur le nom de fichier

Le runner filtrait à l'origine avec `.filter((f) => f.endsWith(".sql"))`,
ce qui aurait aussi matché `NNN_nom.down.sql` et tenté de l'appliquer
comme une migration forward normale. Corrigé dans
`backend/src/infrastructure/database/postgres/runMigrations.ts` (même
changement) :
`.filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))`. Un
`.down.sql` n'est donc jamais lu par `npm run migrate` — il ne s'exécute
que manuellement (voir ci-dessous).

### Comment exécuter un rollback

Manuellement, avec le client `psql` (ou tout client Postgres) pointé sur
la même base que `DATABASE_URL` du backend :

```bash
psql "$DATABASE_URL" -f database/postgresql/migrations/NNN_nom.down.sql
```

Le `.down.sql` doit se terminer par
`DELETE FROM schema_migrations WHERE filename = 'NNN_nom.sql';` pour que
le runner considère de nouveau cette migration comme non appliquée (utile
si on veut la rejouer après correction).

Pour rollback plusieurs migrations, exécuter les `.down.sql` dans l'ordre
**inverse** de leur application (le plus récent numéro d'abord).

## Rollback actuellement documenté

- `027_raci_assignments.down.sql` — `DROP TABLE raci_assignments`
  (l'index `raci_assignments_tenant_entity_idx` part avec la table).
  Destructif : supprime toutes les lignes RACI existantes. À exécuter
  après `028_raci_entity_type_snake_case.down.sql` si 028 a aussi été
  appliquée.
- `028_raci_entity_type_snake_case.down.sql` — inverse exact de la
  migration de données de 028 (UPDATE SNAKE_CASE → PascalCase) puis
  restaure l'ancienne `CHECK` constraint de 027. Non destructif tant
  qu'aucune ligne n'a été insérée avec une valeur SNAKE_CASE par du code
  applicatif déjà migré vers la nouvelle convention (à vérifier avant
  d'exécuter en environnement partagé).

Rejouer `027 → 028 → down(028) → down(027)` restitue l'état d'avant 027
(table absente), sans perte de données pour un rollback fait avant que
d'autres migrations ou tables ne dépendent de `raci_assignments` — ce qui
est le cas aujourd'hui (aucune FK entrante, `entity_id` est une référence
polymorphe non contrainte, cf. commentaire de tête de 027).

- `029_risks_process_id.down.sql` — `DROP INDEX risks_tenant_process_idx`
  puis `ALTER TABLE risks DROP COLUMN process_id`. Non destructif tant
  qu'aucun code applicatif n'a encore écrit de valeur dans cette colonne
  (nullable, jamais backfillée par la migration forward elle-même).
- `030_evaluation_mode.down.sql` — `ALTER TABLE processes/configs DROP
  COLUMN evaluation_mode` (les `CHECK` constraints partent avec la
  colonne). Non destructif pour `processes.evaluation_mode` (nullable,
  jamais backfillée) ; pour `configs.evaluation_mode` (NOT NULL DEFAULT
  'CLASSIQUE'), le rollback perd uniquement la distinction explicite
  d'un tenant qui aurait basculé sur 'PARTICIPATIF' — à vérifier avant
  d'exécuter en environnement partagé si `ConfigService.updateEvaluationMode`
  a déjà été appelé en production.
- `033_process_evaluation_mode_requests.down.sql` — `DROP TABLE
  process_evaluation_mode_requests` (les deux index partent avec la
  table). Destructif : supprime tout l'historique des demandes de
  changement de mode Classique/Participatif. Non destructif pour le
  reste du schéma : aucune table n'a de FK entrante vers celle-ci, et
  `processes.evaluation_mode` (030) n'est jamais écrit qu'indirectement
  par cette table — le rollback n'affecte pas le mode actuellement en
  vigueur sur un `Process`, seulement l'historique des propositions.
