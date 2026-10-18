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

## 2026-10-12 — validation migration 055 (lot B-6a, risk_frameworks)
- Première exécution réelle de 055 (écrite sans jamais tourner) : 2 défauts trouvés, corrigés en place
  (fichier jamais enregistré dans `schema_migrations`).
  1. Un `CONSTRAINT x_kind_check` de niveau table portait le même nom que l'auto-nom du CHECK de colonne
     `kind` -> 42710 « already exists ». Règle : ne jamais nommer un CHECK de table `<table>_<col>_check`
     si la colonne `<col>` a elle-même un CHECK inline ; utiliser un nom distinct (ici `_kind_columns_check`).
  2. `risk_frameworks` n'avait pas de trigger `BEFORE TRUNCATE` alors que l'en-tête promettait les 3 tables
     (protégée seulement indirectement via FK + garde des versions). Ajouté.
- Méthode : `runMigrations.ts` impose SSL (`rejectUnauthorized: true`) donc inutilisable sur un Postgres local
  sans TLS ; j'ai rejoué la même boucle en shell (psql, BEGIN; fichier; INSERT schema_migrations; COMMIT par
  fichier, ordre trié, `.down.sql` exclus). initdb doit tourner sous l'utilisateur `postgres` (refuse root) :
  `su postgres -c`, socket unix dans /tmp, `listen_addresses=''`. Créer le rôle `grc_app_runtime` avant 043.
- Fixtures utiles pour tester un DO$$ de reprise : tenants avec/sans config, échelle ACTIVE vs DRAFT/ARCHIVED,
  un pg_dump -Fc avant la migration pour rejouer proprement ; comparer `pg_dump -s` (hors lignes \restrict)
  d'une base « up » et d'une base « up→down→up » pour prouver que le down est complet.
- Constats de comportement à connaître côté app : une version ACTIVE refuse même un UPDATE de `updated_at`
  seul ; le runtime a UPDATE sur les change requests (append-only garanti par trigger, pas par GRANT) ;
  DELETE/TRUNCATE révoqués sur les 3 tables.

## 2026-10-12 — suivi B-6a (F-B6a-08, C-B6a-08, analyse F-B6a-06)
- `dev_seed.sql` crée les groupes fixes APRÈS les migrations : toute migration qui ajoute des permissions aux
  groupes fixes (UPDATE roles ... WHERE system_group) ne touche pas le tenant de seed. Réflexe : à chaque
  migration de ce type, aligner le tableau de permissions du seed dans le même lot. Vérifié : RISK_MANAGER 6,
  RISK_COMMITTEE 1, AUDIT 1 `riskframework.*`, seed rejouable (ON CONFLICT DO NOTHING, ne met pas à jour une ligne existante).
- Un `.down.sql` qui détruit une piste d'audit porte un avertissement en tête de fichier ; `psql -1` est
  incompatible avec un fichier qui contient son propre BEGIN/COMMIT (utiliser `-v ON_ERROR_STOP=1 -f` seul).
- Une migration poussée est figée : on corrige par migration suivante, pas en place (contrairement à la fenêtre
  « jamais enregistrée » du 2026-10-12 ci-dessus).
- F-B6a-06 : analysé, non implémenté, en attente de décision (voir rapport : lien version<->demande APPROVED
  par un tiers, interdiction BOOTSTRAP tant que B-6d absent).

## 2026-10-12 — migration 056 (F-B6a-06, garde d'activation du Dispositif)
- 056 implémente F-B6a-06 : UNIQUE (id, tenant_id, framework_id, version_id) sur les demandes + FK composite
  NOT VALID `risk_framework_versions_activation_request_fk` (MATCH SIMPLE, ignorée si activation_request_id NULL) ;
  garde `risk_framework_versions_guard()` : PENDING_APPROVAL -> ACTIVE exige une demande ACTIVATE_VERSION de CETTE version
  (même tenant/Dispositif), APPROVED, decided_by non nul <> requested_by, régime NORMAL/FALLBACK ;
  activation_request_id interdit sur DRAFT, immuable une fois ACTIVE ; index unique partiel (1 demande = 1 version) ;
  CHECK `..._no_bootstrap_check` (NOT VALID) refuse BOOTSTRAP jusqu'à B-6d (nom distinct de tout auto-nom -> pas de 42710).
- B-6d devra : DROP du CHECK no_bootstrap par une migration dédiée ET adapter la garde (`decision_regime IN ('NORMAL','FALLBACK')`
  devra accepter BOOTSTRAP sous conditions) -- sinon l'activation BOOTSTRAP resterait refusée par le trigger.
- Le down de 056 redéfinit la fonction avec le corps de 055 (copie) : si 055 change un jour, resynchroniser.
- Compat code : `recordDecision` (d51e0c8) met la demande APPROVED d'abord, puis la version ACTIVE avec activation_request_id
  dans le même UPDATE : compatible sans modification. Le trigger voit la demande car même transaction.
- Validé sur Postgres 16 jetable (001->056, 056 x2, down x2, up->down->up identique en pg_dump -s) ; 14 cas SQL.
- Technique de test : fonctions pg_temp (run/prep) avec sous-transaction forcée au rollback ; défense en profondeur testée en
  désactivant seulement le trigger utilisateur (FK et index restent actifs).

## 2026-10-12 — migration 057 (F-B6a-09, garde INSERT du Dispositif)
- Les triggers de garde de 055/056 étaient `BEFORE UPDATE OR DELETE` : un INSERT direct (version ACTIVE, demande déjà
  APPROVED) contournait tout. Réflexe : une garde de cycle de vie couvre les 3 événements (INSERT, UPDATE, DELETE) ;
  toujours se demander « et si la ligne naît déjà dans l'état final ? ».
- 057 : triggers `BEFORE INSERT` `risk_framework_versions_insert_guard` (DRAFT, activation_request_id/activated_at/archived_*
  NULL) et `risk_framework_change_requests_insert_guard` (PENDING, 6 champs de décision NULL, `requested_by` du tenant) ;
  `risk_framework_change_requests_guard()` (UPDATE) gagne le contrôle `decided_by` du même tenant (via `users`). SQLSTATE 42501.
  Pas de FK composite users(id, tenant_id) : elle exigerait un UNIQUE (id, tenant_id) sur `users` (table partagée), le
  trigger suffit et ne touche pas aux lignes existantes.
- Le down de 057 restaure le corps de la garde UPDATE de 055 (copie) : si 055 change, resynchroniser (comme pour 056).
- Compat code : createWithDraft/createDraftFrom (DRAFT), createActivationRequest (PENDING par défaut), recordDecision/withdraw
  (UPDATE seulement), brouillon de reprise 055 (DRAFT) : aucun changement de code. Les requêtes de test avec tenant
  de `decided_by` différent sont refusées ; la décision nominale par un tiers du même tenant passe.
- Test : un nominal « DRAFT » échoue en 23505 (index d'une seule version ouverte) tant qu'un brouillon existe : tester
  le nominal APRÈS l'activation de v1, sinon on confond refus de trigger et contrainte d'unicité.
- Environnement : l'agent worktree refuse les `$VAR` en position de commande, `su -c` et les pipes ; passer par de petits
  scripts dans le scratchpad (`sh script`), et appeler psql par chemin complet.

## 2026-10-12 — migration 058 (F-B6a-11 search_path des gardes, F-B6a-13)
- RÈGLE : toute fonction de trigger (surtout si elle lit une table) fixe son `search_path`, **pg_temp en dernier** :
  `SET search_path = pg_catalog, public, pg_temp`. Sinon pg_temp est cherché en premier pour les relations et le runtime
  (TEMP par défaut sur la base) masque la vraie table par une table temporaire homonyme -> garde contournée (rejoué :
  version ACTIVE avec demande réelle PENDING ; `users` factice contre le contrôle tenant ; gel d'échelle contourné).
- Un `CREATE OR REPLACE FUNCTION` sans SET remet la config de la fonction à zéro : toute future redéfinition de ces
  fonctions DOIT répéter le SET (les down de 056/057 restaurent volontairement l'état non protégé : down de 058 d'abord).
  058 = `ALTER FUNCTION` sur les 6 fonctions de 055/056/057 (dont truncate_guard, par uniformité).
- Convention down : chaque `.down.sql` supprime sa ligne de `schema_migrations` (057 l'oubliait, corrigé : F-B6a-13).
- Test : clone `CREATE DATABASE ... TEMPLATE` avant/après la migration pour rejouer le même scénario (le nominal committe
  des lignes) ; `\set VERBOSITY sqlstate` ; 25P02 après une erreur dans une tx est du bruit, pas un résultat.
- Environnement agent : pas de `. fichier` ni `sh` dans une commande composée ; scripts du scratchpad lancés seuls.

## 2026-10-12 — migration 060 (F-B6b-02, gel de l'instantané risk_evaluations)
- 060 : trigger `BEFORE UPDATE OF` les 5 colonnes d'instantané (risk_framework_version_id, 3x committee_*, rating_scale_id) :
  non NULL => immuable (même retour à NULL), SQLSTATE 42501. NULL -> valeur permis SEULEMENT pour rating_scale_id (BROUILLON
  pré-Dispositif, recordInherentScoring, spec 8.1) ; refusé pour les 4 autres (aucun chemin applicatif ne le fait).
  Tenant : UNIQUE (tenant_id, id) sur risk_framework_versions (trivial, id = PK) + FK composite NOT VALID MATCH SIMPLE
  `risk_evaluations_framework_version_tenant_fk` ; la FK simple de 059 est conservée. search_path épinglé (inline + ALTER).
- Conséquence app à connaître : un 2e scoring inhérent qui résoudrait une AUTRE échelle (mode legacy sans Dispositif, via
  resolveActiveRatingScale) serait refusé ; en mode Dispositif le service réutilise e.ratingScaleId donc rien ne change.
- Vérifié sur PG16 jetable (001->060, 060 x2, down x2, up->down->up identique en pg_dump -s, 17 cas SQL). Tests :
  backend/test/QA-FB6b02.test.ts (statique) et QA-FB6b02-pg.test.ts (QA_FB6B02_PGHOST = dossier socket, QA_FB6B02_PGDB).
- Skill `ponytail` introuvable dans cet environnement (Unknown skill) : principe appliqué à la main (pas d'abstraction en plus).
- Script PG jetable : `runuser -u postgres -- sh pg.sh` (initdb + pg_ctl -k <scratchpad>, listen_addresses='') puis boucle psql -1.

## 2026-10-17 — migration 061 (F-B6b-06, F-B6b-07, F-CAT-02 partie DB)
- 061 : trigger `risk_evaluations_snapshot_insert_guard` (BEFORE INSERT, 42501) : version NULL => tout l'instantané NULL
  (échelle, version d'échelle, 3 seuils) ; version renseignée => version du MÊME tenant ET `ACTIVE` (le service résout
  getActiveVersion) et rating_scale_id / rating_scale_version (= rating_scales.version) / 3 seuils identiques à la version.
  UNIQUE (tenant_id,id) sur rating_scales + FK composite NOT VALID `risk_evaluations_rating_scale_tenant_fk` ;
  `rating_scale_version` rejoint le gel UPDATE de 060 (fonction redéfinie AVEC son SET search_path, trigger recréé).
  risk_categories : UNIQUE (tenant_id,id) + FK composite NOT VALID `risk_categories_parent_tenant_fk` (FK simple conservée).
- Down de 061 restaure le corps de la garde UPDATE de 060 (copie : resynchroniser si 060 change).
- Validé sur PG16 jetable (001->060, 061 x2, down x2 = pg_dump -s identique à l'état 060, re-up identique au up).
- Effet de bord tests : les fixtures pg de QA-FB6b02-pg et QA-B6bF-pg insérait un instantané « fabriqué » -> corrigées
  (version passée ACTIVE par `SET LOCAL session_replication_role = replica`, snapshot cohérent). Le refus de version
  étrangère devient 42501 (garde avant FK). Un test qui fait ALTER TABLE ... TRIGGER prend un verrou : lancer les fichiers pg
  avec `--no-file-parallelism` (deadlock constaté sinon). Attention : replica désactive aussi les FK.
- Rappel : toute nouvelle écriture d'un instantané devra venir d'une version ACTIVE ; une évaluation créée alors que la
  version n'est plus ACTIVE (course avec archivage) est refusée par le trigger : le service doit réessayer/retourner 409.
- Env : psql en root sur le socket du cluster (le postgres ne traverse pas /tmp/claude-0) ; `runuser -u postgres -- sh < script`.

## 2026-10-18 — migration 062 (B-6d), écrite par A06 (A07 non spawné)
- Rejouée sur PG16 jetable : up x2, down x2, up->down->up OK ; 7 cas SQL dans `backend/test/B6dBootstrap-pg.test.ts` (fin posée par 2e RM/Audit/Comité, un seul membre non, révocation sans effet, UPDATE tenants refusé 42501, réactivation, activation BOOTSTRAP 1re seulement et seulement avant la fin, CHECK de forme).
- À revoir par A07/A08 : concurrence réelle de deux affectations (verrou `tenants FOR UPDATE` dans le trigger), limite connue (changement de `roles.system_group` / réactivation d'un rôle ne déclenchent pas le marqueur), nom de contrainte <= 63 caractères.
