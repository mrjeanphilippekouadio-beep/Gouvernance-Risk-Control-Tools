import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import { ConflictError, ForbiddenError } from "../domain/errors/DomainErrors.js";
import {
  SELF_VALIDATION_RULE,
  selfValidationOutcome,
  type EligibleValidatorQuery,
  type GovernanceConfirmation,
} from "../domain/governance/selfValidation.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/** What a service adds to its audit record when a self-validation was accepted. */
export interface AcceptedSelfValidation {
  governanceException: typeof SELF_VALIDATION_RULE;
  /** Merge into `newValue`: the fact that nobody else could validate, and the confirmation reason (q141). */
  newValueExtra: { selfValidation: { otherValidatorExists: false; reason: string } };
}

/**
 * Shared by every existing "cannot validate one's own input" guard. Wired as an OPTIONAL constructor parameter of
 * those services: without it (or without its two ports) a self-validation is refused exactly as before (fail closed).
 */
export class SelfValidationGate {
  constructor(
    private readonly configs?: Pick<ConfigRepository, "getByTenant">,
    private readonly eligible?: EligibleValidatorQuery,
  ) {}

  /**
   * Call where the service used to `throw ForbiddenError(refusal)` for a self-validation. Returns `null` when the
   * actor is not validating their own input; throws the original refusal unless policy is DOUBLE_CONFIRMATION, nobody
   * else can validate, and the request carries the explicit confirmation.
   */
  async check(
    actor: AuthenticatedUser,
    args: {
      isSelf: boolean;
      /** The permission that makes someone a validator of this object. */
      permission: string;
      /** The makers of the object: never counted as "another validator". */
      makerIds: string[];
      refusal: string;
      confirmation?: GovernanceConfirmation;
    },
  ): Promise<AcceptedSelfValidation | null> {
    if (!args.isSelf) return null;
    if (!this.configs || !this.eligible) throw new ForbiddenError(args.refusal);

    const policy = (await this.configs.getByTenant(actor.tenantId))?.selfValidationPolicy ?? "REFUSE";
    // Skip the validator query when it cannot change the answer.
    const otherValidatorExists =
      policy === "DOUBLE_CONFIRMATION"
        ? await this.eligible.existsOther(actor.tenantId, actor.userId, args.permission, args.makerIds)
        : false;

    const outcome = selfValidationOutcome(policy, true, otherValidatorExists, args.confirmation);
    if (outcome === "REFUSE") throw new ForbiddenError(args.refusal);
    // q140/R-4.1: never name the other validator.
    if (outcome === "OTHER_VALIDATOR_EXISTS") {
      throw new ForbiddenError(`${args.refusal} (un autre validateur existe : demandez-lui de valider)`);
    }
    if (outcome === "CONFIRMATION_REQUIRED") {
      throw new ConflictError(
        `GOVERNANCE_CONFIRMATION_REQUIRED: ${args.refusal} Personne d'autre ne peut valider : renvoyez la demande avec ` +
          `governanceConfirmation { rule: "${SELF_VALIDATION_RULE}", reason } pour l'appliquer sans validation indépendante.`,
      );
    }
    return {
      governanceException: SELF_VALIDATION_RULE,
      newValueExtra: { selfValidation: { otherValidatorExists: false, reason: args.confirmation!.reason.trim() } },
    };
  }
}

/** For services whose gate is an optional dependency: without it, a self-validation is refused as it always was. */
export async function checkSelfValidation(
  gate: SelfValidationGate | undefined,
  actor: AuthenticatedUser,
  args: Parameters<SelfValidationGate["check"]>[1],
): Promise<AcceptedSelfValidation | null> {
  if (gate) return gate.check(actor, args);
  if (args.isSelf) throw new ForbiddenError(args.refusal);
  return null;
}
