-- RISK_MANAGEMENT_V1_FINAL_DECISIONS.md §8/§12 (Lot B) — TreatmentDecision:
-- the treatment option (Accepter/Surveiller/Réduire/Transférer/Éviter)
-- chosen for a Risk, rattachée à l'évaluation qui l'a déclenchée. See
-- backend/src/domain/entities/TreatmentDecision.ts for the full
-- rationale (OD-1/OD-2/OD-3).
--
-- No score/threshold snapshot: OD-1 only ever allows a decision to be
-- created against a RiskEvaluation already in an authoritative status
-- (AUTHORITATIVE_EVALUATION_STATUSES — risk_evaluations.status IN
-- ('VALIDATED', 'VALIDE_COMITE')), so that evaluation is already
-- immutable by the time a decision can exist — a plain FK
-- (risk_evaluation_id) suffices, the values behind it can never move.
--
-- Append-only in the same sense as risk_escalations (OD-3): a rejected
-- (INVALIDEE) decision is never retried in place — a later attempt on
-- the same evaluation is simply a new row. The only in-place mutations
-- ever allowed after creation are the single terminal transition
-- (PROPOSEE -> CONFIRMEE/INVALIDEE/VALIDEE_COMITE), each through its own
-- narrow repository method (recordConfirmation/recordInvalidation/
-- recordCommitteeValidation) — never a generic UPDATE.
--
-- validator_id is a snapshot of risks.superior_owner_id (021_risk_
-- ownership.sql) taken at proposal time, exactly like risk_escalations.
-- superior_owner_id — never re-derived from `risks` when read later.
--
-- risk_id is denormalized from risk_evaluations.risk_id, resolved
-- server-side (TreatmentDecisionService.create), never client-supplied
-- — avoids a join on every read/list that filters by risk.
--
-- No deleted_at, no DELETE: a treatment decision is never removed, only
-- superseded by a new proposal on a later evaluation cycle.

CREATE TABLE treatment_decisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  risk_evaluation_id   uuid NOT NULL REFERENCES risk_evaluations (id),
  risk_id              uuid NOT NULL REFERENCES risks (id),
  option               text NOT NULL CHECK (option IN ('ACCEPTER', 'SURVEILLER', 'REDUIRE', 'TRANSFERER', 'EVITER')),
  justification        text NOT NULL,
  status               text NOT NULL DEFAULT 'PROPOSEE' CHECK (status IN ('PROPOSEE', 'CONFIRMEE', 'INVALIDEE', 'VALIDEE_COMITE')),
  validator_id         uuid NOT NULL REFERENCES users (id),
  decided_by           uuid NOT NULL REFERENCES users (id),
  validated_by         uuid REFERENCES users (id),
  validated_at         timestamptz,
  comment              text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX treatment_decisions_tenant_risk_idx ON treatment_decisions (tenant_id, risk_id, created_at DESC);
CREATE INDEX treatment_decisions_tenant_evaluation_idx ON treatment_decisions (tenant_id, risk_evaluation_id);
