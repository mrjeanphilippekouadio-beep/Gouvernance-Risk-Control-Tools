-- 095 — Conservation L1 (q245, DECISION-120, cadrage 8.2) : masquage logique du journal d'audit à 10 ans.
-- Rien n'est supprimé : audit_log et sa garde 038 restent intacts (aucune colonne ajoutée, aucun UPDATE). Une ligne « marquée » reste
-- en base ; seules les trois lectures de consultation de PostgresAuditRepository la filtrent. Les lectures techniques (dernier
-- PERMISSION_CHANGE, santé de la gouvernance) ne filtrent pas.
-- Le marquage se lance à la main, en SQL, par le seul propriétaire de la base (EXECUTE retiré à PUBLIC et à grc_app_runtime, qui ne
-- peut ni écrire dans la table de marques ni lancer la fonction) :
--   SELECT * FROM mark_expired_audit_log('<tenant uuid>');
-- La fonction refuse toute durée de moins de 10 ans (calendaires). Pas réversible par l'application : une correction passe par une migration.

CREATE TABLE IF NOT EXISTS audit_log_retention_marks (
  audit_log_id uuid PRIMARY KEY REFERENCES audit_log (id),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  marked_at    timestamptz NOT NULL DEFAULT now(),
  marked_by    text NOT NULL DEFAULT current_user,
  run_id       uuid NOT NULL
);

CREATE OR REPLACE FUNCTION audit_log_retention_marks_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_retention_marks is append-only: % is not permitted', TG_OP USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION audit_log_retention_marks_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS audit_log_retention_marks_mutation ON audit_log_retention_marks;
CREATE TRIGGER audit_log_retention_marks_mutation BEFORE UPDATE OR DELETE ON audit_log_retention_marks
  FOR EACH ROW EXECUTE FUNCTION audit_log_retention_marks_guard();
DROP TRIGGER IF EXISTS audit_log_retention_marks_truncate ON audit_log_retention_marks;
CREATE TRIGGER audit_log_retention_marks_truncate BEFORE TRUNCATE ON audit_log_retention_marks
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_retention_marks_guard();

REVOKE ALL ON TABLE audit_log_retention_marks FROM PUBLIC;
REVOKE ALL ON TABLE audit_log_retention_marks FROM grc_app_runtime;
GRANT SELECT ON TABLE audit_log_retention_marks TO grc_app_runtime;

CREATE OR REPLACE FUNCTION mark_expired_audit_log(p_tenant_id uuid, p_older_than interval DEFAULT '10 years')
  RETURNS TABLE (marked_count bigint, out_run_id uuid)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_count bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_older_than IS NULL OR now() - p_older_than > now() - interval '10 years' THEN
    RAISE EXCEPTION 'mark_expired_audit_log: a tenant and a duration of at least 10 years are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO audit_log_retention_marks (audit_log_id, tenant_id, run_id)
    SELECT a.id, a.tenant_id, v_run FROM audit_log a
    WHERE a.tenant_id = p_tenant_id AND a."timestamp" < now() - p_older_than
      AND NOT EXISTS (SELECT 1 FROM audit_log_retention_marks m WHERE m.audit_log_id = a.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count, v_run;
END;
$$;
ALTER FUNCTION mark_expired_audit_log(uuid, interval) SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION mark_expired_audit_log(uuid, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_expired_audit_log(uuid, interval) FROM grc_app_runtime;
