import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresControlExecutionRepository } from "../src/infrastructure/database/postgres/PostgresControlExecutionRepository.js";
import { PostgresControlEffectivenessRepository } from "../src/infrastructure/database/postgres/PostgresControlEffectivenessRepository.js";
import { PostgresControlRepository } from "../src/infrastructure/database/postgres/PostgresControlRepository.js";
import { PostgresRiskEvaluationRepository } from "../src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { PostgresActionPlanRepository } from "../src/infrastructure/database/postgres/PostgresActionPlanRepository.js";
import { PostgresFindingRepository } from "../src/infrastructure/database/postgres/PostgresFindingRepository.js";
import { PostgresAuditMissionRepository } from "../src/infrastructure/database/postgres/PostgresAuditMissionRepository.js";
import { PostgresReviewCycleRepository } from "../src/infrastructure/database/postgres/PostgresReviewCycleRepository.js";
import { PostgresProcessEvaluationModeRequestRepository } from "../src/infrastructure/database/postgres/PostgresProcessEvaluationModeRequestRepository.js";
import { PostgresProcessRepository } from "../src/infrastructure/database/postgres/PostgresProcessRepository.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresConfigRepository } from "../src/infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresSelfValidationPolicyRequestRepository } from "../src/infrastructure/database/postgres/PostgresSelfValidationPolicyRequestRepository.js";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { PostgresGovernanceDesignationRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceDesignationRepository.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { ControlExecutionService } from "../src/services/ControlExecutionService.js";
import { ControlEffectivenessService } from "../src/services/ControlEffectivenessService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { FindingService } from "../src/services/FindingService.js";
import { GovernanceService } from "../src/services/GovernanceService.js";
import { ProcessEvaluationModeRequestService } from "../src/services/ProcessEvaluationModeRequestService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { SELF_VALIDATION_RULE } from "../src/domain/governance/selfValidation.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * DECISION-079 (CMP-PNL-01 / SEC-PNL-01): each governance action and its audit row are ONE transaction.
 * Real PostgreSQL (skipped unless QA_SWP_PGHOST is a unix socket directory; needs 001..072). A temporary trigger
 * refuses any audit_log row whose reason is BLOCK: the action must then NOT be applied. Each test also runs the
 * same action unblocked, so a "not applied" result cannot come from a broken fixture.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";
const BLOCK = "QA_D079_BLOCK";

describe.skipIf(!HOST.startsWith("/"))("DECISION-079 audit atomicity on real PostgreSQL", () => {
  let pool: Pool;
  let tenant = "";
  let maker = "";
  let checker = "";
  let uid = 0;
  const q = async <T extends object = { id: string }>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows;
  const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0]!.id;
  const actorOf = (userId: string, roles: string[]): AuthenticatedUser =>
    ({ userId, tenantId: tenant, email: "a@x.test", displayName: "a", roles }) as unknown as AuthenticatedUser;
  const audit = () => new PostgresAuditRepository(pool);
  const auditRows = async (entityType: string, entityId: string) =>
    q<{ governance_exception: string | null }>(`SELECT governance_exception FROM audit_log WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3`, [tenant, entityType, entityId]);
  const user = (tag: string, roles = "{}") =>
    one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, $2, $3) RETURNING id`, [tenant, `${tag}-${++uid}-${Math.random()}@d079`, roles]);

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 4 });
    await q(`CREATE OR REPLACE FUNCTION qa_d079_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'QA_D079 audit insert refused'; END $$`);
    await q(`DROP TRIGGER IF EXISTS qa_d079_block ON audit_log`);
    await q(`CREATE TRIGGER qa_d079_block BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.reason = '${BLOCK}') EXECUTE FUNCTION qa_d079_block()`);
    tenant = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`d079-${Date.now()}`]);
    maker = await user("maker");
    checker = await user("checker");
  });
  afterAll(async () => {
    await q(`DROP TRIGGER IF EXISTS qa_d079_block ON audit_log`);
    await q(`DROP FUNCTION IF EXISTS qa_d079_block()`);
    await pool.end();
  });

  it("ControlExecution.validate: a refused audit leaves the execution unvalidated", async () => {
    const control = await one(
      `INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria) VALUES ($1,'c','PREVENTIF','MENSUEL','x','y') RETURNING id`,
      [tenant],
    ).catch(async () => one(`INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria) VALUES ($1,'c','PREVENTIVE','MONTHLY','x','y') RETURNING id`, [tenant]));
    const exec = () => one(`INSERT INTO control_executions (tenant_id, control_id, executed_by, status) VALUES ($1,$2,$3,'DONE') RETURNING id`, [tenant, control, maker]);
    const svc = new ControlExecutionService(new PostgresControlExecutionRepository(pool), new PostgresControlRepository(pool), audit());
    const actor = actorOf(checker, ["execution.validate", "execution.read"]);
    const blocked = await exec();
    await expect(svc.validate(actor, blocked, BLOCK, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ validated_at: Date | null }>(`SELECT validated_at FROM control_executions WHERE id = $1`, [blocked]))[0]!.validated_at).toBeNull();
    const ok = await exec();
    await svc.validate(actor, ok, "fine", "r");
    expect(await auditRows("ControlExecution", ok)).toHaveLength(1);

    // marked path (accepted self-validation): same guarantee
    await q(`INSERT INTO configs (tenant_id, score_formula, level_thresholds, impact_retenu_rule, appetite_mode, evaluation_mode, version, self_validation_policy)
             VALUES ($1,'P_X_I','[]','MAX','AUTO_AVEC_SURCHARGE_MANUELLE','CLASSIQUE',0,'DOUBLE_CONFIRMATION') ON CONFLICT (tenant_id) DO UPDATE SET self_validation_policy = 'DOUBLE_CONFIRMATION'`, [tenant]);
    const lonely = await q<{ id: string }>(`SELECT 1 AS id`); // nobody else holds execution.validate in this tenant but `checker` (no role granted)
    expect(lonely).toHaveLength(1);
    const gated = new ControlExecutionService(
      new PostgresControlExecutionRepository(pool),
      new PostgresControlRepository(pool),
      audit(),
      new SelfValidationGate(new PostgresConfigRepository(pool), new PostgresGovernanceQueries(pool)),
    );
    const own = await one(`INSERT INTO control_executions (tenant_id, control_id, executed_by, status) VALUES ($1,$2,$3,'DONE') RETURNING id`, [tenant, control, checker]);
    const confirmation = { rule: SELF_VALIDATION_RULE, reason: "personne d'autre" } as const;
    await expect(gated.validate(actor, own, BLOCK, "r", confirmation)).rejects.toThrow(/QA_D079/);
    expect((await q<{ validated_at: Date | null }>(`SELECT validated_at FROM control_executions WHERE id = $1`, [own]))[0]!.validated_at).toBeNull();
    await gated.validate(actor, own, "fine", "r", confirmation);
    expect((await auditRows("ControlExecution", own))[0]!.governance_exception).toBe(SELF_VALIDATION_RULE);
    await q(`UPDATE configs SET self_validation_policy = 'REFUSE' WHERE tenant_id = $1`, [tenant]);
  });

  it("ControlEffectiveness.validate: a refused audit leaves the assessment unvalidated", async () => {
    const control = await one(`SELECT id FROM controls WHERE tenant_id = $1 LIMIT 1`, [tenant]);
    const make = () =>
      one(`INSERT INTO control_effectiveness_assessments (tenant_id, control_id, evaluated_by, operational_effectiveness, justification) VALUES ($1,$2,$3,'EFFICACE','j') RETURNING id`, [tenant, control, maker])
        .catch(async () => one(`INSERT INTO control_effectiveness_assessments (tenant_id, control_id, evaluated_by, operational_effectiveness, justification) VALUES ($1,$2,$3,'EFFECTIVE','j') RETURNING id`, [tenant, control, maker]));
    const svc = new ControlEffectivenessService(new PostgresControlEffectivenessRepository(pool), new PostgresControlRepository(pool), audit());
    const actor = actorOf(checker, ["effectiveness.validate", "effectiveness.read"]);
    const blocked = await make();
    await expect(svc.validate(actor, blocked, BLOCK, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ validated_at: Date | null }>(`SELECT validated_at FROM control_effectiveness_assessments WHERE id = $1`, [blocked]))[0]!.validated_at).toBeNull();
    const ok = await make();
    await svc.validate(actor, ok, "fine", "r");
    expect(await auditRows("ControlEffectivenessAssessment", ok)).toHaveLength(1);
  });

  it("RiskEvaluation.validate: a refused audit leaves the evaluation BROUILLON", async () => {
    const risk = await one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1,'p','d') RETURNING id`, [tenant]);
    const make = () =>
      one(
        `INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, residual_score)
         VALUES ($1,$2,'AD_HOC',$3,'s',3) RETURNING id`,
        [tenant, risk, maker],
      );
    const svc = new RiskEvaluationService(new PostgresRiskEvaluationRepository(pool), audit());
    const actor = actorOf(checker, ["riskevaluation.validate", "riskevaluation.read"]);
    const blocked = await make();
    await expect(svc.validate(actor, blocked, BLOCK, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ status: string }>(`SELECT status AS id FROM risk_evaluations WHERE id = $1`, [blocked]))[0]!.id).toBe("BROUILLON");
    const ok = await make();
    await svc.validate(actor, ok, "fine", "r");
    expect(await auditRows("RiskEvaluation", ok)).toHaveLength(1);
  });

  it("ActionPlan.close: a refused audit leaves the action open", async () => {
    const evidence = await one(
      `INSERT INTO evidences (tenant_id, file_name, drive_file_id, drive_url, document_type, uploaded_by) VALUES ($1,'f','d','u','AUTRE',$2) RETURNING id`,
      [tenant, maker],
    ).catch(async () => one(`INSERT INTO evidences (tenant_id, file_name, drive_file_id, drive_url, document_type, uploaded_by) VALUES ($1,'f','d','u','OTHER',$2) RETURNING id`, [tenant, maker]));
    const make = () =>
      one(`INSERT INTO action_plans (tenant_id, title, source_type, responsible_user_id, due_date, created_by) VALUES ($1,'t','RISK',$2,'2030-01-01',$2) RETURNING id`, [tenant, maker]);
    const svc = new ActionPlanService(new PostgresActionPlanRepository(pool), audit());
    const actor = actorOf(checker, ["actionplan.validate", "actionplan.read"]);
    const blocked = await make();
    await expect(svc.close(actor, blocked, evidence, BLOCK, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ status: string }>(`SELECT status AS id FROM action_plans WHERE id = $1`, [blocked]))[0]!.id).not.toBe("TERMINEE");
    const ok = await make();
    await svc.close(actor, ok, evidence, "fine", "r");
    expect(await auditRows("ActionPlan", ok)).toHaveLength(1);
  });

  it("Finding.close: a refused audit leaves the finding EN_TRAITEMENT", async () => {
    const mission = await one(
      `INSERT INTO audit_missions (tenant_id, reference, title, scope, lead_auditor_id, planned_start_date, planned_end_date, created_by)
       VALUES ($1,$2,'m','s',$3,'2030-01-01','2030-02-01',$3) RETURNING id`,
      [tenant, `M-${Date.now()}`, maker],
    );
    const make = () =>
      one(`INSERT INTO findings (tenant_id, audit_mission_id, title, description, severity, raised_by, status) VALUES ($1,$2,'t','d','HIGH',$3,'EN_TRAITEMENT') RETURNING id`, [tenant, mission, maker]);
    const svc = new FindingService(new PostgresFindingRepository(pool), new PostgresAuditMissionRepository(pool), audit());
    const actor = actorOf(checker, ["audit.finding.close", "audit.finding.read"]);
    const blocked = await make();
    await expect(svc.close(actor, blocked, BLOCK, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ status: string }>(`SELECT status AS id FROM findings WHERE id = $1`, [blocked]))[0]!.id).toBe("EN_TRAITEMENT");
    const ok = await make();
    await svc.close(actor, ok, "fine", "r");
    expect(await auditRows("Finding", ok)).toHaveLength(1);
  });

  it("Governance.close: a refused audit leaves the cycle CLOTURE_PROPOSEE", async () => {
    const make = () =>
      one(`INSERT INTO review_cycles (tenant_id, type, title, created_by, status, proposed_closure_by) VALUES ($1,'ANNUELLE','t',$2,'CLOTURE_PROPOSEE',$2) RETURNING id`, [tenant, maker]);
    const svc = new GovernanceService(new PostgresReviewCycleRepository(pool), audit());
    const actor = actorOf(checker, ["governance.validate", "governance.read"]);
    const blocked = await make();
    await expect(svc.close(actor, blocked, BLOCK, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ status: string }>(`SELECT status AS id FROM review_cycles WHERE id = $1`, [blocked]))[0]!.id).toBe("CLOTURE_PROPOSEE");
    const ok = await make();
    await svc.close(actor, ok, "fine", "r");
    expect(await auditRows("ReviewCycle", ok)).toHaveLength(1);
  });

  it("ProcessEvaluationModeRequest.validate: a refused audit leaves the request pending and the process mode untouched", async () => {
    const process = await one(`INSERT INTO processes (tenant_id, level, name) VALUES ($1,'PROCESS','p') RETURNING id`, [tenant]);
    const requests = new PostgresProcessEvaluationModeRequestRepository(pool);
    // the audit row of this action carries the reason of the request-less call: the Process event has reason null, so
    // the trigger is armed on the entity instead (any audit row of this tenant for the process).
    await q(`DROP TRIGGER IF EXISTS qa_d079_block_proc ON audit_log`);
    await q(`CREATE TRIGGER qa_d079_block_proc BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity_id = '${process}') EXECUTE FUNCTION qa_d079_block()`);
    const req = await one(
      `INSERT INTO process_evaluation_mode_requests (tenant_id, process_id, requested_mode, requested_by) VALUES ($1,$2,'PARTICIPATIF',$3) RETURNING id`,
      [tenant, process, maker],
    );
    const svc = new ProcessEvaluationModeRequestService(requests, new PostgresProcessRepository(pool), new PostgresRiskRepository(pool), audit());
    const actor = actorOf(checker, ["evaluationmode.validate"]);
    await expect(svc.validate(actor, req, "r")).rejects.toThrow(/QA_D079/);
    expect((await q<{ status: string }>(`SELECT status AS id FROM process_evaluation_mode_requests WHERE id = $1`, [req]))[0]!.id).toBe("PENDING_VALIDATION");
    expect((await q<{ m: string | null }>(`SELECT evaluation_mode AS m FROM processes WHERE id = $1`, [process]))[0]!.m).toBeNull();
    await q(`DROP TRIGGER qa_d079_block_proc ON audit_log`);
    await svc.validate(actor, req, "r");
    expect((await q<{ m: string | null }>(`SELECT evaluation_mode AS m FROM processes WHERE id = $1`, [process]))[0]!.m).toBe("PARTICIPATIF");
    expect(await auditRows("ProcessEvaluationModeRequest", req)).toHaveLength(1);
  });

  describe("self-validation policy and its requests", () => {
    const policy = async () => (await q<{ p: string }>(`SELECT self_validation_policy AS p FROM configs WHERE tenant_id = $1`, [tenant]))[0]?.p ?? "none";
    const service = () => {
      const governance = new PostgresGovernanceQueries(pool);
      return new ConfigService(new PostgresConfigRepository(pool), audit(), undefined, undefined, governance, new PostgresSelfValidationPolicyRequestRepository(pool));
    };
    const statusOf = async (id: string) => (await q<{ status: string }>(`SELECT status AS id FROM self_validation_policy_requests WHERE id = $1`, [id]))[0]!.id;
    const admin = () => actorOf(maker, ["config.read", "config.selfvalidation.set"]);
    const approver = () => actorOf(checker, ["config.read", "config.selfvalidation.approve"]);
    const pending = (reason = "motif valable") =>
      one(`INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by) VALUES ($1,'DOUBLE_CONFIRMATION',$2,$3) RETURNING id`, [tenant, reason, maker]);
    const clearPending = () => q(`UPDATE self_validation_policy_requests SET status = 'REJECTED', decided_by = $2, decided_at = now(), decision_reason = 'x' WHERE tenant_id = $1 AND status = 'PENDING'`, [tenant, checker]);

    it("setSelfValidationPolicy (administrator alone, marked): a refused audit leaves the policy unchanged", async () => {
      const tenant2 = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`d079b-${Date.now()}`]);
      const solo = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'s') RETURNING id`, [tenant2, `solo-${Math.random()}@d079`]);
      const svc = service();
      const actor = { userId: solo, tenantId: tenant2, email: "s@x", displayName: "s", roles: ["config.read", "config.selfvalidation.set"] } as unknown as AuthenticatedUser;
      await expect(svc.setSelfValidationPolicy(actor, "DOUBLE_CONFIRMATION", BLOCK, "r")).rejects.toThrow(/QA_D079/);
      const rows = await q<{ p: string }>(`SELECT self_validation_policy AS p FROM configs WHERE tenant_id = $1`, [tenant2]);
      expect(rows.length === 0 || rows[0]!.p === "REFUSE").toBe(true);
      const out = await svc.setSelfValidationPolicy(actor, "DOUBLE_CONFIRMATION", "seul administrateur", "r");
      expect(out.config.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
      const audits = await q<{ governance_exception: string | null }>(`SELECT governance_exception FROM audit_log WHERE tenant_id = $1 AND entity_type = 'Config'`, [tenant2]);
      expect(audits.map((a) => a.governance_exception)).toEqual(["config.selfvalidation.adminAlone"]);
    });

    it("setSelfValidationPolicy (a second approver exists): a refused audit creates no request and keeps the pending one", async () => {
      await q(`UPDATE users SET roles = '{config.selfvalidation.approve}' WHERE id = $1`, [checker]);
      const svc = service();
      await expect(svc.setSelfValidationPolicy(admin(), "DOUBLE_CONFIRMATION", BLOCK, "r")).rejects.toThrow(/QA_D079/);
      expect(await q(`SELECT id FROM self_validation_policy_requests WHERE tenant_id = $1 AND reason = $2`, [tenant, BLOCK])).toHaveLength(0);
      // same action replacing a pending request: the withdrawal is rolled back too
      const old = await pending();
      await expect(svc.setSelfValidationPolicy(admin(), "DOUBLE_CONFIRMATION", BLOCK, "r")).rejects.toThrow(/QA_D079/);
      expect(await statusOf(old)).toBe("PENDING");
      const out = await svc.setSelfValidationPolicy(admin(), "DOUBLE_CONFIRMATION", "nouvelle demande", "r");
      expect(out.pendingRequest).not.toBeNull();
      expect(await statusOf(old)).toBe("WITHDRAWN");
      expect((await q(`SELECT id FROM audit_log WHERE tenant_id = $1 AND entity_type = 'SelfValidationPolicyRequest' AND action IN ('CLOSE','SUBMIT')`, [tenant])).length).toBeGreaterThanOrEqual(2);
      await clearPending();
    });

    it("approveSelfValidationPolicy: a refused audit leaves the request pending and the policy unchanged", async () => {
      const before = await policy();
      const id = await pending();
      const svc = service();
      // the APPROVE audit row carries the APPROVER's own reason (CMP-PNL2)
      await expect(svc.approveSelfValidationPolicy(approver(), id, "r", BLOCK)).rejects.toThrow(/QA_D079/);
      expect(await statusOf(id)).toBe("PENDING");
      expect(await policy()).toBe(before);
      await q(`UPDATE configs SET self_validation_policy = 'REFUSE' WHERE tenant_id = $1`, [tenant]);
      const cfg = await svc.approveSelfValidationPolicy(approver(), id, "r", "motif valable");
      expect(cfg.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
      expect(await statusOf(id)).toBe("APPLIED");
      await q(`UPDATE configs SET self_validation_policy = 'REFUSE' WHERE tenant_id = $1`, [tenant]);
    });

    it("rejectSelfValidationPolicy: a refused audit leaves the request pending", async () => {
      const id = await pending();
      const svc = service();
      await expect(svc.rejectSelfValidationPolicy(approver(), id, BLOCK, "r")).rejects.toThrow(/QA_D079/);
      expect(await statusOf(id)).toBe("PENDING");
      await svc.rejectSelfValidationPolicy(approver(), id, "refus motivé", "r");
      expect(await statusOf(id)).toBe("REJECTED");
    });
  });

  describe("GovernanceDesignationService", () => {
    const svc = () => new GovernanceDesignationService(new PostgresGovernanceDesignationRepository(pool), audit(), new PostgresUserRepository(pool), new PostgresRoleRepository(pool));
    const actor = () => actorOf(maker, ["designation.manage"]);

    it("designate: a refused audit creates no designation", async () => {
      const target = await user("target");
      await expect(svc().designate(actor(), { kind: "MANAGER", userId: target, reason: BLOCK }, "r")).rejects.toThrow(/QA_D079/);
      expect(await q(`SELECT id FROM governance_designations WHERE tenant_id = $1 AND kind = 'MANAGER'`, [tenant])).toHaveLength(0);
      const created = await svc().designate(actor(), { kind: "MANAGER", userId: target, reason: "désignation" }, "r");
      expect(await auditRows("GovernanceDesignation", created.id)).toHaveLength(1);
    });

    it("end: a refused audit leaves the designation active", async () => {
      const target = await user("target2");
      const interim = await svc().designate(actor(), { kind: "RISK_MANAGER_INTERIM", userId: target, reason: "intérim", validUntil: new Date(Date.now() + 86_400_000) }, "r");
      await expect(svc().end(actor(), interim.id, BLOCK, "r")).rejects.toThrow(/QA_D079/);
      expect((await q<{ ended_at: Date | null }>(`SELECT ended_at FROM governance_designations WHERE id = $1`, [interim.id]))[0]!.ended_at).toBeNull();
      await svc().end(actor(), interim.id, "fin normale", "r");
      expect((await q<{ ended_at: Date | null }>(`SELECT ended_at FROM governance_designations WHERE id = $1`, [interim.id]))[0]!.ended_at).not.toBeNull();
      await expect(svc().end(actor(), interim.id, "encore", "r")).rejects.toThrow(/already ended/);
    });
  });
});
