import type { ApproverGroup, ChangeApprover } from "./entities/RiskFramework.js";

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
