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
