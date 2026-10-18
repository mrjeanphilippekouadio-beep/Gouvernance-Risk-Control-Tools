/**
 * DECISION-074 (q141, q142, q153) — client-chosen handling of "validating one's own input".
 * Pure domain: no I/O. The services call `selfValidationOutcome` where they used to `throw` directly.
 */

export const SELF_VALIDATION_POLICIES = ["REFUSE", "DOUBLE_CONFIRMATION"] as const;
export type SelfValidationPolicy = (typeof SELF_VALIDATION_POLICIES)[number];

/** Value written to `audit_log.governance_exception` when a self-validation is accepted. */
export const SELF_VALIDATION_RULE = "noSelfValidation";

export type SelfValidationOutcome =
  /** Not a self-validation, or an accepted double confirmation: the action goes through. */
  | "ALLOW"
  /** Policy REFUSE (or nothing wired): 403 as before. */
  | "REFUSE"
  /** Policy DOUBLE_CONFIRMATION but another person can validate (q141): 403. */
  | "OTHER_VALIDATOR_EXISTS"
  /** Policy DOUBLE_CONFIRMATION, nobody else can validate, no explicit confirmation yet: 409. */
  | "CONFIRMATION_REQUIRED";

/** `governanceConfirmation` of a request: the explicit second confirmation, with a mandatory reason. */
export interface GovernanceConfirmation {
  rule: typeof SELF_VALIDATION_RULE;
  reason: string;
}

/**
 * A reason (q141 and every governance reason) must hold at least one visible character and no control character
 * (SEC-PNL-01: a NUL makes PostgreSQL refuse the audit row; F-PNL-11: a zero-width space is not a reason).
 * Single definition, shared by the zod helper (`api/validation.ts`) and the service-level checks.
 */
export function isAcceptableReason(reason: string): boolean {
  return !/\p{Cc}/u.test(reason) && /[\p{L}\p{N}\p{P}\p{S}\p{M}]/u.test(reason);
}

export function selfValidationOutcome(
  policy: SelfValidationPolicy,
  isSelf: boolean,
  otherValidatorExists: boolean,
  confirmation?: GovernanceConfirmation,
): SelfValidationOutcome {
  if (!isSelf) return "ALLOW";
  if (policy !== "DOUBLE_CONFIRMATION") return "REFUSE";
  if (otherValidatorExists) return "OTHER_VALIDATOR_EXISTS";
  if (confirmation?.rule === SELF_VALIDATION_RULE && isAcceptableReason(confirmation.reason)) return "ALLOW";
  return "CONFIRMATION_REQUIRED";
}

/**
 * Port: can anybody other than the actor validate? An active account (not suspended), different from the actor
 * and from every maker in `excludeUserIds`, that holds `permission` through a non-revoked assignment of a
 * non-deleted role or through the legacy `users.roles` — the same union the identity resolver uses, so the answer
 * matches what `requirePermission` would accept. Modules are not department-scoped for these permissions, so no
 * department scope is applied.
 */
export interface EligibleValidatorQuery {
  existsOther(tenantId: string, actorId: string, permission: string, excludeUserIds?: string[]): Promise<boolean>;
}

/**
 * Port (DECISION-072 hybrid rule): does anybody else hold governance authority? An active account other than the
 * actor that belongs to the Risk Manager, Audit or Committee group.
 */
export interface GovernanceThirdPartyQuery {
  existsGovernanceThirdParty(tenantId: string, actorId: string): Promise<boolean>;
}

/** q142: how an object's validation is shown. Derived from the audit marker, never stored on the object. */
export type ValidationIndependence = "INDEPENDENT" | "WITHOUT_INDEPENDENT_REVIEW" | "REVIEWED_BY_THIRD_PARTY";

/** Port: single lookup used by every response and export. `REVIEWED_BY_THIRD_PARTY` arrives with lot D5. */
export interface GovernanceExceptionLookup {
  forEntities(tenantId: string, entityType: string, ids: string[]): Promise<Map<string, ValidationIndependence>>;
}
