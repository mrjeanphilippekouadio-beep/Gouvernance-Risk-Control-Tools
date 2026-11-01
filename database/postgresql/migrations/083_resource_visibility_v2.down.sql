-- Rollback of 083_resource_visibility_v2.sql : supprime les fonctions de visibilité du lot V2. Aucune donnée n'est
-- réécrite : les niveaux déjà posés sur les contrôles, anomalies, plans et KPI restent (colonne de 080) ; le code
-- d'avant 083 ne les lit pas autrement que « CLIENT seulement ». Les accès accordés restent (révocation, jamais DELETE).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP FUNCTION IF EXISTS action_plan_visible_to(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS anomaly_visible_to(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS kpi_visible_to(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS control_visible_to(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS visibility_granted(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS visibility_in_department_group(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS visibility_sees_everything(uuid, uuid);

DELETE FROM schema_migrations WHERE filename = '083_resource_visibility_v2.sql';

COMMIT;
