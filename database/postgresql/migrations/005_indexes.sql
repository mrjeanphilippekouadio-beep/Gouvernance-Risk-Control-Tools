CREATE INDEX risks_tenant_status_idx ON risks (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX risk_assessments_risk_effective_idx ON risk_assessments (risk_id, effective_from DESC);
CREATE INDEX evidences_control_execution_idx ON evidences (control_execution_id);
CREATE INDEX audit_log_entity_idx ON audit_log (tenant_id, entity_type, entity_id, "timestamp" DESC);
CREATE INDEX audit_log_request_idx ON audit_log (request_id);
