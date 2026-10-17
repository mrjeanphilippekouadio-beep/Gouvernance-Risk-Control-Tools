import { DEFAULT_CONTRACT_PARAMS, type ApproverGroup, type BootstrapJustification, type ChangeApprover, type FrameworkParams } from "./entities/RiskFramework.js";

/** Active members of each group, minus the people excluded from deciding (requester, authors of the version). */
export type EligibleMembers = Record<ApproverGroup, string[]>;

export type ResolvedDecider =
  /** A Risk Manager decides (`FALLBACK` = the rule's groups were unavailable; comment mandatory, ratification pending). */
  | { kind: "RISK_MANAGER"; regime: "NORMAL" | "FALLBACK" }
  /** A group vote decides — not available before B-12. */
  | { kind: "VOTE"; groups: ApproverGroup[] };

/** q72: a group is only called upon when it has at least 2 eligible members. */
export const MIN_VOTERS = 2;

/**
 * Spec §5.4, pure. `eligible` already excludes the requester and the authors.
 * AUDIT_AND_COMMITTEE (Q3): every eligible group votes; none eligible -> Risk Manager fallback.
 */
export function resolveDecider(approver: ChangeApprover, eligible: EligibleMembers): ResolvedDecider {
  const ok = (g: ApproverGroup) => eligible[g].length >= MIN_VOTERS;
  switch (approver) {
    case "RISK_MANAGER":
      return { kind: "RISK_MANAGER", regime: "NORMAL" };
    case "COMMITTEE":
      if (ok("COMMITTEE")) return { kind: "VOTE", groups: ["COMMITTEE"] };
      if (ok("AUDIT")) return { kind: "VOTE", groups: ["AUDIT"] };
      return { kind: "RISK_MANAGER", regime: "FALLBACK" };
    case "AUDIT":
      if (ok("AUDIT")) return { kind: "VOTE", groups: ["AUDIT"] };
      if (ok("COMMITTEE")) return { kind: "VOTE", groups: ["COMMITTEE"] };
      return { kind: "RISK_MANAGER", regime: "FALLBACK" };
    case "AUDIT_AND_COMMITTEE": {
      const groups = (["COMMITTEE", "AUDIT"] as const).filter(ok);
      return groups.length > 0 ? { kind: "VOTE", groups } : { kind: "RISK_MANAGER", regime: "FALLBACK" };
    }
  }
}

/**
 * q100 (spec §5.4.1), pure. Before B-12 nobody can exercise a Committee/Audit vote: a VOTE is folded into the
 * existing Risk Manager FALLBACK (third-party RM, comment mandatory, ratification pending), with a traced cause.
 * Applied in `RiskFrameworkService.resolveFor`; B-12 removes the call (decisions already taken keep their cause).
 */
export type FallbackCause = "LEGACY_APPROVER_PRE_B12";
export function foldVoteBeforeB12(decider: ResolvedDecider): {
  decider: Extract<ResolvedDecider, { kind: "RISK_MANAGER" }>;
  fallbackCause: FallbackCause | null;
  bypassedGroups: ApproverGroup[];
} {
  if (decider.kind === "VOTE") {
    return { decider: { kind: "RISK_MANAGER", regime: "FALLBACK" }, fallbackCause: "LEGACY_APPROVER_PRE_B12", bypassedGroups: decider.groups };
  }
  return { decider, fallbackCause: null, bypassedGroups: [] };
}

// -- Bootstrap (B-6d, spec §5.6) ---------------------------------------------------------------------------

/**
 * I-D9 (A13 position, PENDING PO confirmation): the administrator "asked to designate a second member" must be
 * someone other than the requester. Set to true to let a Risk Manager who is also an administrator name
 * themselves (declarative path); this constant is the only thing that depends on the PO's answer.
 */
export const BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF = false;

export type BootstrapKind = "ACTIVATE_VERSION" | "ASSIGN_PROCESS" | "SET_DEFAULT" | "DESIGNATION";
export type ActiveMembers = { RISK_MANAGER: number; COMMITTEE: number; AUDIT: number };

export interface BootstrapContext {
  kind: BootstrapKind;
  /** q102: tenants.risk_framework_bootstrap_ended_at read under the tenant lock; non-null = definitive end. */
  endedAt: Date | null;
  /** Active members per fixed group (assignment not revoked, user not suspended), read under the lock. */
  activeMembers: ActiveMembers;
  /** The requester (= decider) is an active member of the Risk Manager group. */
  requesterIsActiveRiskManager: boolean;
  /** ACTIVATE_VERSION: no version of the tenant has ever been activated (q81). */
  firstActivationOfTenant: boolean;
  /** ACTIVATE_VERSION: contractDefaultViolations(...) is empty (q98). */
  contractDefaultsOnly: boolean;
  /** The request would switch self-proposal on (q65). */
  switchesSelfProposalOn: boolean;
}

export type BootstrapRefusal =
  | "ENDED" | "CIRCUIT_FUNCTIONAL" | "NOT_SOLE_RISK_MANAGER" | "OUT_OF_SCOPE"
  | "NOT_FIRST_ACTIVATION" | "NOT_CONTRACT_DEFAULTS" | "SELF_PROPOSAL";

/** q101: a circuit works when the Risk Manager, Committee or Audit group has at least MIN_VOTERS (q72) active members. */
export function isCircuitFunctional(m: ActiveMembers): boolean {
  return m.RISK_MANAGER >= MIN_VOTERS || m.COMMITTEE >= MIN_VOTERS || m.AUDIT >= MIN_VOTERS;
}

/** null = allowed; otherwise the first reason, in the spec's order. */
export function bootstrapRefusal(ctx: BootstrapContext): BootstrapRefusal | null {
  if (ctx.endedAt !== null) return "ENDED";
  // Safety net: the end marker should already be set; the service never sets it itself.
  if (isCircuitFunctional(ctx.activeMembers)) return "CIRCUIT_FUNCTIONAL";
  if (!ctx.requesterIsActiveRiskManager || ctx.activeMembers.RISK_MANAGER !== 1) return "NOT_SOLE_RISK_MANAGER";
  if (ctx.switchesSelfProposalOn) return "SELF_PROPOSAL";
  if (ctx.kind === "ASSIGN_PROCESS" || ctx.kind === "SET_DEFAULT") return "OUT_OF_SCOPE";
  if (ctx.kind === "ACTIVATE_VERSION") {
    if (!ctx.firstActivationOfTenant) return "NOT_FIRST_ACTIVATION";
    if (!ctx.contractDefaultsOnly) return "NOT_CONTRACT_DEFAULTS";
  }
  return null;
}
export const isBootstrapAllowed = (ctx: BootstrapContext): boolean => bootstrapRefusal(ctx) === null;

/**
 * q98 (I-D8, open): names of the parameters that differ from the contract default (§5.6 point 2). Only parameters
 * for which the contract gives a value are checked; scale, appetite, "low" threshold, delegation duration and the
 * treatment threshold stay free. If A13 wants more, only this function changes.
 */
export function contractDefaultViolations(
  v: Pick<FrameworkParams,
    "defaultEvaluationMode" | "committeeEvaluationMinScore" | "committeeEvaluationEnforced" | "changeApprover"
    | "selfProposalAllowed" | "riskOwnerExecutorCumulAllowed" | "delegateExecutorCumulAllowed" | "hybridPolicyEnabled"
    | "masteryAuthoritativeSource" | "committeeVoteRule" | "committeeVoteCustom">,
  scaleSize: number,
): string[] {
  const d = DEFAULT_CONTRACT_PARAMS;
  const checks: Array<[string, boolean]> = [
    ["defaultEvaluationMode", v.defaultEvaluationMode === "CLASSIQUE"],
    // q71: n x n x 15 / 25, rounded down (5, 9, 15, 21 for sizes 3 to 6).
    ["committeeEvaluationMinScore", v.committeeEvaluationMinScore === Math.floor((scaleSize * scaleSize * 15) / 25)],
    ["committeeEvaluationEnforced", v.committeeEvaluationEnforced === true],
    ["changeApprover", v.changeApprover === "RISK_MANAGER"],
    ["selfProposalAllowed", v.selfProposalAllowed === false],
    ["riskOwnerExecutorCumulAllowed", v.riskOwnerExecutorCumulAllowed === d.riskOwnerExecutorCumulAllowed],
    ["delegateExecutorCumulAllowed", v.delegateExecutorCumulAllowed === d.delegateExecutorCumulAllowed],
    ["hybridPolicyEnabled", v.hybridPolicyEnabled === d.hybridPolicyEnabled],
    ["masteryAuthoritativeSource", v.masteryAuthoritativeSource === d.masteryAuthoritativeSource],
    ["committeeVoteRule", v.committeeVoteRule === d.committeeVoteRule],
    ["committeeVoteCustom", v.committeeVoteCustom === d.committeeVoteCustom],
  ];
  return checks.filter(([, ok]) => !ok).map(([name]) => name);
}

/** q99 / I-D8 (A13): the notice shows what the sole Risk Manager fixed freely, so the first Audit/Committee member can judge it. */
export function bootstrapNoticeMessage(j: BootstrapJustification): string {
  const f = j.freeParameters;
  const low = f.lowCriticalityThreshold === null ? "non renseigné" : `${f.lowCriticalityThreshold}${f.lowThresholdToExamine ? " (valeur à examiner)" : ""}`;
  return (
    "Un Dispositif a été activé en amorçage par un Risk Manager seul, sans ratification. Valeurs fixées librement : "
    + `échelle ${f.scaleSize}x${f.scaleSize}, seuil « faible » ${low}, ${f.appetiteThresholds.length} appétence(s), `
    + `durée de délégation ${f.delegationMaxDays ?? "non fixée"}, seuil Comité de traitement ${f.committeeTreatmentMinScore ?? "non fixé"}. `
    + "Détail : consultation des décisions BOOTSTRAP."
  );
}
