import { ValidationError } from "../domain/errors/DomainErrors.js";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";
import type { NotificationRepository } from "../domain/repositories/NotificationRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/** q257 (DECISION-121): notification type sent to the Risk Manager group when a risk or sub-process changes Dispositif. */
export const FRAMEWORK_MOVE_EVENT = "OBJECT_FRAMEWORK_CHANGED";

/** q257: a move to another Dispositif is never blocked, but it carries a motive (1 to 500 characters). */
export function requireFrameworkMoveReason(raw: string | undefined, what: string): string {
  const reason = raw?.trim() ?? "";
  if (!reason || reason.length > 500 || !isAcceptableReason(reason)) {
    throw new ValidationError(`A reason (1 to 500 characters) is required to move a ${what} to another Dispositif`);
  }
  return reason;
}

/**
 * q257: tells the Risk Manager group (holders of `riskframework.activate`, the mover excluded). Best effort, after the
 * write; never names the object (it may be restricted), the audit row carries the detail. Optional deps: absent = nothing.
 */
export async function notifyFrameworkMove(
  deps: { notifications?: Pick<NotificationRepository, "create">; users?: Pick<UserRepository, "listWithPermission"> },
  actor: AuthenticatedUser,
  resourceId: string,
  message: string,
  requestId: string,
): Promise<void> {
  if (!deps.notifications || !deps.users?.listWithPermission) return;
  try {
    const managers = await deps.users.listWithPermission(actor.tenantId, "riskframework.activate", actor.userId);
    for (const m of managers) {
      try {
        await deps.notifications.create({
          tenantId: actor.tenantId,
          recipientUserId: m.id,
          resourceType: "MANAGEMENT",
          resourceId,
          eventType: FRAMEWORK_MOVE_EVENT,
          message,
        });
      } catch (err) {
        console.error(`${FRAMEWORK_MOVE_EVENT} ${resourceId}: a Risk Manager could not be notified (requestId ${requestId})`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error(`${FRAMEWORK_MOVE_EVENT} ${resourceId}: Risk Managers could not be resolved (requestId ${requestId})`, err instanceof Error ? err.message : err);
  }
}
