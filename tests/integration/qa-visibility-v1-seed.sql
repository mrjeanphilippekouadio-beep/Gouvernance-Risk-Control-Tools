-- OUTILLAGE DE TEST (QA visibility V1). Jeu de donnees deterministe pour PostgreSQL 16 LOCAL (jamais Neon).
-- Prerequis : migrations 001..082 + groupes fixes inseres (ils dependent de FIXED_GROUP_PERMISSIONS, ajoutes par l'appelant).
-- UUID fixes : tenant ...0001 ; comptes ...01xx ; departements ...02xx ; processus ...03xx ; risques ...04xx ; enfants ...05xx.
\set T '''aaaaaaaa-0000-4000-8000-000000000001'''
-- (tenant insere par le script d'appel)
INSERT INTO departments (id, tenant_id, name) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000201', :T, 'Finance QA'), ('aaaaaaaa-0000-4000-8000-000000000202', :T, 'Operations QA');
-- Comptes : mailles de lecture identiques (LINE1) pour que SEUL le niveau de visibilite change le resultat.
CREATE TEMP TABLE _u (n text, id uuid, extra text[]);
INSERT INTO _u VALUES
 ('own','aaaaaaaa-0000-4000-8000-000000000101','{}'),   ('n1','aaaaaaaa-0000-4000-8000-000000000102','{}'),
 ('raci','aaaaaaaa-0000-4000-8000-000000000103','{}'),  ('pown','aaaaaaaa-0000-4000-8000-000000000104','{}'),
 ('dept','aaaaaaaa-0000-4000-8000-000000000105','{}'),  ('named','aaaaaaaa-0000-4000-8000-000000000106','{}'),
 ('out','aaaaaaaa-0000-4000-8000-000000000107','{}'),   ('out2','aaaaaaaa-0000-4000-8000-000000000108','{control.create,control.update,kri.create,kri.update,raci.assign,riskevaluation.create,treatmentdecision.create,actionplan.create}'),
 ('rm','aaaaaaaa-0000-4000-8000-000000000109','{}'),    ('com','aaaaaaaa-0000-4000-8000-00000000010a','{}'),
 ('aud','aaaaaaaa-0000-4000-8000-00000000010b','{}'),
 ('adm','aaaaaaaa-0000-4000-8000-00000000010c','{role.read,role.create,role.update,role.assign,user.read,user.create,user.update,risk.update,risk.delete,riskevaluation.create,kri.create,kri.update,resourcevisibility.set}');
INSERT INTO users (id, tenant_id, email, display_name, roles)
SELECT id, :T, n || '@vv1.test', 'QA ' || n,
  ARRAY['risk.read','risk.create','kri.read','riskevaluation.read','treatmentdecision.read','raci.read','cartography.read','dashboard.read','dashboard.executive',
        'control.read','anomaly.read','actionplan.read','kpi.read','notification.read','process.read','department.read','riskappetite.read','ratingscale.read']
  || CASE WHEN n IN ('rm','com','aud') THEN '{}'::text[] ELSE '{}'::text[] END || extra
FROM _u;
-- Groupes : RM, Comite, Audit (system_group) ; groupe du departement Finance (roles.department_id) pour 'dept' ; Operations pour 'out2'.
INSERT INTO roles (id, tenant_id, name, permissions, department_id) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000301', :T, 'Groupe Finance QA', '{risk.read}', 'aaaaaaaa-0000-4000-8000-000000000201'),
 ('aaaaaaaa-0000-4000-8000-000000000302', :T, 'Groupe Operations QA', '{risk.read}', 'aaaaaaaa-0000-4000-8000-000000000202');
INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by)
SELECT :T, r.id, u.id, 'aaaaaaaa-0000-4000-8000-00000000010c' FROM roles r JOIN _u u ON
  (r.system_group = 'RISK_MANAGER' AND u.n = 'rm') OR (r.system_group = 'RISK_COMMITTEE' AND u.n = 'com') OR (r.system_group = 'AUDIT' AND u.n = 'aud')
  OR (r.id = 'aaaaaaaa-0000-4000-8000-000000000301' AND u.n = 'dept') OR (r.id = 'aaaaaaaa-0000-4000-8000-000000000302' AND u.n = 'out2')
WHERE r.tenant_id = :T;
INSERT INTO processes (id, tenant_id, level, name, owner_user_id, department_id) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000401', :T, 'PROCESS', 'Processus QA V1', 'aaaaaaaa-0000-4000-8000-000000000104', 'aaaaaaaa-0000-4000-8000-000000000201');
-- Risques : 0501 CLIENT (temoin), 0502 PERIMETRE, 0503 NOMINATIF. Textes « CANARY-<niveau> » : ne doivent jamais apparaitre chez un lecteur hors perimetre.
INSERT INTO risks (id, tenant_id, process, description, owner_department_id, status, owner_id, superior_owner_id, process_id, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000501', :T, 'CANARY-CLIENT-PROC', 'CANARY-CLIENT-DESC', 'aaaaaaaa-0000-4000-8000-000000000201', 'ACTIVE', 'aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000401', 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000502', :T, 'CANARY-PERIM-PROC', 'CANARY-PERIM-DESC', 'aaaaaaaa-0000-4000-8000-000000000201', 'ACTIVE', 'aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000401', 'PERIMETRE'),
 ('aaaaaaaa-0000-4000-8000-000000000503', :T, 'CANARY-NOMIN-PROC', 'CANARY-NOMIN-DESC', 'aaaaaaaa-0000-4000-8000-000000000201', 'ACTIVE', 'aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000401', 'NOMINATIF');
INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason)
SELECT :T, 'RISK', r, 'aaaaaaaa-0000-4000-8000-000000000106', 'aaaaaaaa-0000-4000-8000-000000000101', 'QA'
FROM unnest(ARRAY['aaaaaaaa-0000-4000-8000-000000000502','aaaaaaaa-0000-4000-8000-000000000503']::uuid[]) r;
INSERT INTO raci_assignments (tenant_id, entity_type, entity_id, user_id, role, created_by)
SELECT :T, 'RISK', r, 'aaaaaaaa-0000-4000-8000-000000000103', 'C', 'aaaaaaaa-0000-4000-8000-000000000101'
FROM unnest(ARRAY['aaaaaaaa-0000-4000-8000-000000000501','aaaaaaaa-0000-4000-8000-000000000502','aaaaaaaa-0000-4000-8000-000000000503']::uuid[]) r;
-- Enfants par risque (suffixe = 5xx du risque) : evaluation, decision, KRI + mesure, escalade, controle, anomalie, plan d'action.
DO $$
DECLARE r text; k int := 0; t uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; own uuid := 'aaaaaaaa-0000-4000-8000-000000000101';
        lbl text; ev uuid; kri uuid; ctl uuid; act uuid;
BEGIN
  FOREACH r IN ARRAY ARRAY['501','502','503'] LOOP
    k := k + 1;
    lbl := CASE r WHEN '501' THEN 'CLIENT' WHEN '502' THEN 'PERIM' ELSE 'NOMIN' END;
    ev := ('aaaaaaaa-0000-4000-8000-000000000' || (5 + k)::text || '1' || '0')::uuid;  -- 0610/0710/0810 ... distinct par risque
    INSERT INTO risk_evaluations (id, tenant_id, risk_id, evaluation_type, status, evaluator_id, sub_category, entity, comment, inherent_probability, inherent_impact_retained, inherent_score, residual_probability, residual_impact_retained, residual_score)
      VALUES (ev, t, ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid, 'AD_HOC', 'VALIDATED', own, 'CANARY-' || lbl || '-EVAL', 'E', 'CANARY-' || lbl || '-EVALCOMMENT', 4, 4, 16, 3, 3, 9);
    INSERT INTO treatment_decisions (tenant_id, risk_evaluation_id, risk_id, option, justification, validator_id, decided_by)
      VALUES (t, ev, ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid, 'ACCEPTER', 'CANARY-' || lbl || '-DECISION', 'aaaaaaaa-0000-4000-8000-000000000109', own);
    kri := ('aaaaaaaa-0000-4000-8000-000000000' || (5 + k)::text || '2' || '0')::uuid;
    INSERT INTO kris (id, tenant_id, label, formula, threshold_green, threshold_orange, threshold_red, frequency, risk_id)
      VALUES (kri, t, 'CANARY-' || lbl || '-KRI', 'f', 1, 2, 3, 'MONTHLY', ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid);
    INSERT INTO kri_risks (tenant_id, kri_id, risk_id) VALUES (t, kri, ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid);
    INSERT INTO kri_measures (tenant_id, kri_id, measure_date, value, source, comment, recorded_by)
      VALUES (t, kri, current_date, 1.5, 'CANARY-' || lbl || '-MEASURE', 'c', own);
    INSERT INTO risk_escalations (tenant_id, risk_id, escalated_by, superior_owner_id, reason)
      VALUES (t, ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid, own, 'aaaaaaaa-0000-4000-8000-000000000102', 'CANARY-' || lbl || '-ESCALATION');
    ctl := ('aaaaaaaa-0000-4000-8000-000000000' || (5 + k)::text || '3' || '0')::uuid;
    INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria)
      VALUES (ctl, t, 'Controle QA ' || lbl, 'PREVENTIVE', 'MONTHLY', 'x', 'y');
    INSERT INTO control_risks (tenant_id, control_id, risk_id) VALUES (t, ctl, ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid);
    INSERT INTO anomalies (tenant_id, risk_id, description, severity, detected_by)
      VALUES (t, ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid, 'Anomalie QA ' || lbl, 'LOW', own);
    act := ('aaaaaaaa-0000-4000-8000-000000000' || (5 + k)::text || '4' || '0')::uuid;
    INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by)
      VALUES (act, t, 'Plan QA ' || lbl, 'RISK', ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid, own, current_date + 30, own);
    INSERT INTO action_links (tenant_id, action_id, resource_type, resource_id) VALUES (t, act, 'RISK', ('aaaaaaaa-0000-4000-8000-000000000' || r)::uuid);
  END LOOP;
END $$;
