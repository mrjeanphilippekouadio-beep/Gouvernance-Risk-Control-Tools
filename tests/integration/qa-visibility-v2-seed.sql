-- OUTILLAGE DE TEST (QA visibility V2). Jeu complementaire du jeu V1 (meme tenant, memes comptes <nom>@vv1.test), PostgreSQL 16 LOCAL (jamais Neon).
-- UUID : controles ...0c0x, executions ...0b0x, efficacite ...0e0x, preuves ...0f0x, anomalies ...0d0x, plans ...0a0x, KPI ...0900x -> voir I("..") du test.
-- Textes « CANARY-V2-<objet>-<niveau> » : ne doivent jamais apparaitre chez un lecteur hors perimetre.
\set T '''aaaaaaaa-0000-4000-8000-000000000001'''
\set OWN '''aaaaaaaa-0000-4000-8000-000000000101'''
\set RACI '''aaaaaaaa-0000-4000-8000-000000000103'''
\set DEPT '''aaaaaaaa-0000-4000-8000-000000000105'''
\set NAMED '''aaaaaaaa-0000-4000-8000-000000000106'''
\set OUT '''aaaaaaaa-0000-4000-8000-000000000107'''
\set FIN '''aaaaaaaa-0000-4000-8000-000000000201'''
\set PROC '''aaaaaaaa-0000-4000-8000-000000000401'''
-- Controles : CLIENT / PERIMETRE (Finance, processus 0401, RACI `raci`, liste `named`) / NOMINATIF (liste `named`) / PERIMETRE orphelin (sans departement ni processus).
INSERT INTO controls (id, tenant_id, label, control_type, frequency, executor, compliance_criteria, department_id, process_id, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000c01', :T, 'CANARY-V2-CTL-CLIENT', 'PREVENTIVE', 'MONTHLY', 'x', 'y', :FIN, :PROC, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000c02', :T, 'CANARY-V2-CTL-PERIM', 'PREVENTIVE', 'MONTHLY', 'x', 'y', :FIN, :PROC, 'PERIMETRE'),
 ('aaaaaaaa-0000-4000-8000-000000000c03', :T, 'CANARY-V2-CTL-NOMIN', 'PREVENTIVE', 'MONTHLY', 'x', 'y', :FIN, :PROC, 'NOMINATIF'),
 ('aaaaaaaa-0000-4000-8000-000000000c04', :T, 'CANARY-V2-CTL-ORPHAN', 'PREVENTIVE', 'MONTHLY', 'x', 'y', NULL, NULL, 'PERIMETRE');
INSERT INTO raci_assignments (tenant_id, entity_type, entity_id, user_id, role, created_by)
 VALUES (:T, 'CONTROL', 'aaaaaaaa-0000-4000-8000-000000000c02', :RACI, 'C', :OWN);
-- Executions (0b01 : executant `out` = « assigne » ; les autres : `own`), efficacite, preuves (0f04 : sans execution = niveau 1).
INSERT INTO control_executions (id, tenant_id, control_id, planned_date, executed_by, status, observed_anomalies) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000b01', :T, 'aaaaaaaa-0000-4000-8000-000000000c02', current_date, :OUT, 'DONE', 'CANARY-V2-EXEC-ASSIGNED-PERIM'),
 ('aaaaaaaa-0000-4000-8000-000000000b02', :T, 'aaaaaaaa-0000-4000-8000-000000000c02', current_date, :OWN, 'DONE', 'CANARY-V2-EXEC-OWN-PERIM'),
 ('aaaaaaaa-0000-4000-8000-000000000b03', :T, 'aaaaaaaa-0000-4000-8000-000000000c03', current_date, :OWN, 'DONE', 'CANARY-V2-EXEC-NOMIN'),
 ('aaaaaaaa-0000-4000-8000-000000000b04', :T, 'aaaaaaaa-0000-4000-8000-000000000c01', current_date, :OWN, 'DONE', 'CANARY-V2-EXEC-CLIENT');
INSERT INTO control_effectiveness_assessments (id, tenant_id, control_id, evaluated_by, operational_effectiveness, justification) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000e01', :T, 'aaaaaaaa-0000-4000-8000-000000000c02', :OWN, 'EFFECTIVE', 'CANARY-V2-EFF-PERIM'),
 ('aaaaaaaa-0000-4000-8000-000000000e02', :T, 'aaaaaaaa-0000-4000-8000-000000000c03', :OWN, 'EFFECTIVE', 'CANARY-V2-EFF-NOMIN'),
 ('aaaaaaaa-0000-4000-8000-000000000e03', :T, 'aaaaaaaa-0000-4000-8000-000000000c01', :OWN, 'EFFECTIVE', 'CANARY-V2-EFF-CLIENT');
INSERT INTO evidences (id, tenant_id, control_execution_id, file_name, drive_file_id, drive_url, document_type, uploaded_by) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000f01', :T, 'aaaaaaaa-0000-4000-8000-000000000b02', 'CANARY-V2-EVID-PERIM.pdf', 'drv-f01', 'https://drive.invalid/f01', 'PDF', :OWN),
 ('aaaaaaaa-0000-4000-8000-000000000f02', :T, 'aaaaaaaa-0000-4000-8000-000000000b03', 'CANARY-V2-EVID-NOMIN.pdf', 'drv-f02', 'https://drive.invalid/f02', 'PDF', :OWN),
 ('aaaaaaaa-0000-4000-8000-000000000f03', :T, 'aaaaaaaa-0000-4000-8000-000000000b01', 'CANARY-V2-EVID-ASSIGNED.pdf', 'drv-f03', 'https://drive.invalid/f03', 'PDF', :OUT),
 ('aaaaaaaa-0000-4000-8000-000000000f04', :T, NULL, 'CANARY-V2-EVID-ORPHAN.pdf', 'drv-f04', 'https://drive.invalid/f04', 'PDF', :OWN);
-- Anomalies. 0d02 : declarant `out` d'une anomalie sur un risque masque. 0d08 : niveau propre NOMINATIF mais risque CLIENT (le niveau propre ne s'applique pas).
INSERT INTO anomalies (id, tenant_id, risk_id, control_id, description, severity, detected_by, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000d01', :T, 'aaaaaaaa-0000-4000-8000-000000000502', NULL, 'CANARY-V2-ANO-RISKHID', 'LOW', :OWN, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000d02', :T, 'aaaaaaaa-0000-4000-8000-000000000502', NULL, 'CANARY-V2-ANO-DECL-RISKHID', 'LOW', :OUT, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000d03', :T, NULL, 'aaaaaaaa-0000-4000-8000-000000000c02', 'CANARY-V2-ANO-CTL', 'LOW', :OWN, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000d04', :T, NULL, NULL, 'CANARY-V2-ANO-PERIM', 'LOW', :DEPT, 'PERIMETRE'),
 ('aaaaaaaa-0000-4000-8000-000000000d05', :T, NULL, NULL, 'CANARY-V2-ANO-NOMIN', 'LOW', :OWN, 'NOMINATIF'),
 ('aaaaaaaa-0000-4000-8000-000000000d06', :T, NULL, NULL, 'CANARY-V2-ANO-CLIENT', 'LOW', :OWN, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000d07', :T, 'aaaaaaaa-0000-4000-8000-000000000501', NULL, 'CANARY-V2-ANO-RISKCLIENT', 'LOW', :OWN, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000d08', :T, 'aaaaaaaa-0000-4000-8000-000000000501', NULL, 'CANARY-V2-ANO-IGNORED-OWN-LEVEL', 'LOW', :OWN, 'NOMINATIF');
-- Plans d'action. 0a01/0a09 : responsable `out` (assigne). (kris.risk_id est NOT NULL : le cas « KRI sans risque » est inatteignable).
INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by, department_id, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000a01', :T, 'CANARY-V2-PLAN-ASSIGNED', 'RISK', 'aaaaaaaa-0000-4000-8000-000000000502', :OUT, current_date + 30, :OWN, NULL, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000a02', :T, 'CANARY-V2-PLAN-RISKHID', 'RISK', 'aaaaaaaa-0000-4000-8000-000000000502', :OWN, current_date + 30, :OWN, NULL, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000a03', :T, 'CANARY-V2-PLAN-CTLHID', 'CONTROL', 'aaaaaaaa-0000-4000-8000-000000000c02', :OWN, current_date + 30, :OWN, NULL, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000a04', :T, 'CANARY-V2-PLAN-KRIHID', 'KRI', 'aaaaaaaa-0000-4000-8000-000000000720', :OWN, current_date + 30, :OWN, NULL, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000a06', :T, 'CANARY-V2-PLAN-PERIM', 'MANAGEMENT', NULL, :OWN, current_date + 30, :OWN, :FIN, 'PERIMETRE'),
 ('aaaaaaaa-0000-4000-8000-000000000a07', :T, 'CANARY-V2-PLAN-NOMIN', 'MANAGEMENT', NULL, :OWN, current_date + 30, :OWN, :FIN, 'NOMINATIF'),
 ('aaaaaaaa-0000-4000-8000-000000000a08', :T, 'CANARY-V2-PLAN-CLIENT', 'MANAGEMENT', NULL, :OWN, current_date + 30, :OWN, :FIN, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000a09', :T, 'CANARY-V2-PLAN-OUTNOM', 'MANAGEMENT', NULL, :OUT, current_date + 30, :OWN, :FIN, 'NOMINATIF');
INSERT INTO raci_assignments (tenant_id, entity_type, entity_id, user_id, role, created_by)
 VALUES (:T, 'ACTION_PLAN', 'aaaaaaaa-0000-4000-8000-000000000a06', :RACI, 'C', :OWN);
-- KPI : CLIENT / PERIMETRE (Finance + processus) / NOMINATIF + une mesure chacun.
INSERT INTO kpis (id, tenant_id, label, target_value, unit, frequency, owner, department_id, process_id, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000009001', :T, 'CANARY-V2-KPI-CLIENT', 10, '%', 'MONTHLY', 'x', :FIN, :PROC, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000009002', :T, 'CANARY-V2-KPI-PERIM', 10, '%', 'MONTHLY', 'x', :FIN, :PROC, 'PERIMETRE'),
 ('aaaaaaaa-0000-4000-8000-000000009003', :T, 'CANARY-V2-KPI-NOMIN', 10, '%', 'MONTHLY', 'x', :FIN, :PROC, 'NOMINATIF');
INSERT INTO kpi_measures (tenant_id, kpi_id, period, value, comment, recorded_by)
 SELECT :T, k.id, date '2026-01-01', 5, 'CANARY-V2-KPIM-' || right(k.label, 5), :OWN FROM kpis k WHERE k.label LIKE 'CANARY-V2-KPI-%';
-- Listes nominatives : `named` (jamais le posant).
INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason)
 SELECT :T, t, i::uuid, :NAMED, :OWN, 'QA' FROM (VALUES
  ('CONTROL','aaaaaaaa-0000-4000-8000-000000000c02'), ('CONTROL','aaaaaaaa-0000-4000-8000-000000000c03'),
  ('ANOMALY','aaaaaaaa-0000-4000-8000-000000000d04'), ('ANOMALY','aaaaaaaa-0000-4000-8000-000000000d05'),
  ('ACTION_PLAN','aaaaaaaa-0000-4000-8000-000000000a06'), ('ACTION_PLAN','aaaaaaaa-0000-4000-8000-000000000a07'),
  ('KPI','aaaaaaaa-0000-4000-8000-000000009002'), ('KPI','aaaaaaaa-0000-4000-8000-000000009003')) v(t, i);
-- Croisements inter-modules. 0d09 : anomalie sur un risque CLIENT qui cite un controle et une execution masques (NOMINATIF).
-- 0a0a / 0a0b : plans CLIENT autonomes (pour la cloture avec preuve masquee et le remplacement des liens) ; 0a0b porte des liens vers des objets masques.
INSERT INTO anomalies (id, tenant_id, risk_id, control_id, control_execution_id, description, severity, detected_by, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000d09', :T, 'aaaaaaaa-0000-4000-8000-000000000501', 'aaaaaaaa-0000-4000-8000-000000000c03', 'aaaaaaaa-0000-4000-8000-000000000b03', 'CANARY-V2-ANO-CITES-HIDDEN-CTL', 'LOW', :OWN, 'CLIENT');
INSERT INTO action_plans (id, tenant_id, title, source_type, source_id, responsible_user_id, due_date, created_by, department_id, visibility) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000a0a', :T, 'CANARY-V2-PLAN-TOCLOSE', 'MANAGEMENT', NULL, :OWN, current_date + 30, :OWN, :FIN, 'CLIENT'),
 ('aaaaaaaa-0000-4000-8000-000000000a0b', :T, 'CANARY-V2-PLAN-LINKS', 'MANAGEMENT', NULL, :OWN, current_date + 30, :OWN, :FIN, 'CLIENT');
INSERT INTO action_links (tenant_id, action_id, resource_type, resource_id) VALUES
 (:T, 'aaaaaaaa-0000-4000-8000-000000000a0b', 'CONTROL', 'aaaaaaaa-0000-4000-8000-000000000c03'),
 (:T, 'aaaaaaaa-0000-4000-8000-000000000a0b', 'ANOMALY', 'aaaaaaaa-0000-4000-8000-000000000d05'),
 (:T, 'aaaaaaaa-0000-4000-8000-000000000a0b', 'RISK', 'aaaaaaaa-0000-4000-8000-000000000503');
-- Risque 360 / couverture : les controles et plans restreints sont relies au risque CLIENT 0501 (la fiche du risque ne doit montrer que ce que le lecteur voit).
INSERT INTO control_risks (tenant_id, control_id, risk_id) VALUES
 (:T, 'aaaaaaaa-0000-4000-8000-000000000c02', 'aaaaaaaa-0000-4000-8000-000000000501'),
 (:T, 'aaaaaaaa-0000-4000-8000-000000000c03', 'aaaaaaaa-0000-4000-8000-000000000501');
INSERT INTO action_links (tenant_id, action_id, resource_type, resource_id) VALUES
 (:T, 'aaaaaaaa-0000-4000-8000-000000000a06', 'RISK', 'aaaaaaaa-0000-4000-8000-000000000501'),
 (:T, 'aaaaaaaa-0000-4000-8000-000000000a07', 'RISK', 'aaaaaaaa-0000-4000-8000-000000000501');
INSERT INTO evidences (id, tenant_id, control_execution_id, file_name, drive_file_id, drive_url, document_type, uploaded_by) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000f05', :T, 'aaaaaaaa-0000-4000-8000-000000000b03', 'CANARY-V2-EVID-DELETE.pdf', 'drv-f05', 'https://drive.invalid/f05', 'PDF', :OWN);
