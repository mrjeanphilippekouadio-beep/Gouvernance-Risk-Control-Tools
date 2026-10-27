import type { GovernanceAuditRow, GovernanceEventSource } from "../domain/governance/governanceEvents.js";
import type { NotificationService } from "./NotificationService.js";
import { RISK_MANAGER_VACANCY_EXCEPTION } from "./RoleService.js";

const GROUP_LABELS: Record<string, string> = {
  RISK_MANAGER: "Risk Manager",
  RISK_COMMITTEE: "Comité des risques",
  AUDIT: "Audit",
};
const FIXED_GROUPS = Object.keys(GROUP_LABELS);
const HANDLED_MEMORY = 5000;

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

/**
 * DECISION-074 R-6.3 / R-6.4, q157, q158, SEC-PNL-04 (lot D5): the mandatory governance notifications.
 *
 * Called by the HTTP layer once a mutating request has been answered with a success status, i.e. AFTER the commit. It
 * reads the audit rows that request wrote (same request id, same actor) and emits through `NotificationService.emit`:
 *  - an action marked `governance_exception` (not the Risk Manager vacancy: q160 = trace only) -> the designated manager
 *    and the holders of `governanceexception.review` (R-6.4), the author excluded;
 *  - an organization-profile submission that lowers the size -> the Audit is told (q157) and can contest; when it waits
 *    for a second confirmation, the possible approvers are told too;
 *  - a relaxation request of the self-validation policy -> the possible approvers (q158);
 *  - a principle acceptance waiting for confirmation -> the possible confirmers;
 *  - a contestation -> Risk Manager, Committee and the manager;
 *  - a role assigned in Audit or Committee -> the new member learns how many exceptions are not reviewed (R-6.3, q144);
 *  - a member removed from Risk Manager / Committee / Audit (SEC-PNL-04), except a hand-over to an interim (a replacement)
 *    and the Risk Manager vacancy (q160) -> the remaining members of the three groups.
 * Types are mandatory (not unsubscribable). Messages never name a person (recipients may lack `audit.read`).
 * Best effort: a failure is logged without personal data and never reaches the request.
 */
export class GovernanceNotifier {
  private readonly handled = new Set<string>();

  constructor(
    private readonly notifications: Pick<NotificationService, "emit">,
    private readonly source: GovernanceEventSource,
    private readonly logError: (message: string, detail?: unknown) => void = (m, d) => console.error(m, d),
  ) {}

  async processRequest(tenantId: string, actorId: string, requestId: string): Promise<void> {
    try {
      const rows = (await this.source.rowsForRequest(tenantId, requestId, actorId)).filter((r) => !this.handled.has(r.id));
      for (const row of rows) {
        this.remember(row.id);
        try {
          await this.notifyRow(tenantId, actorId, requestId, row, rows);
        } catch (err) {
          this.logError(`governance notification for audit row ${row.id} failed (requestId ${requestId})`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      this.logError(`governance notifications for request ${requestId} failed`, err instanceof Error ? err.message : err);
    }
  }

  private remember(id: string): void {
    this.handled.add(id);
    if (this.handled.size > HANDLED_MEMORY) this.handled.delete(this.handled.values().next().value as string);
  }

  private async notifyRow(tenantId: string, actorId: string, requestId: string, row: GovernanceAuditRow, all: GovernanceAuditRow[]): Promise<void> {
    const told = new Set<string>([actorId]);
    const send = async (recipients: Iterable<string>, eventType: string, resourceId: string, message: string): Promise<void> => {
      for (const recipient of new Set(recipients)) {
        if (told.has(recipient)) continue;
        told.add(recipient);
        // F-PNL2-04: one failing recipient (deleted between the lookup and the emit...) must not silence the others.
        try {
          await this.notifications.emit({
            tenantId,
            recipientUserId: recipient,
            resourceType: "MANAGEMENT",
            resourceId,
            eventType,
            message,
            triggeredBy: actorId,
            requestId,
            skipIfUnread: true,
          });
        } catch (err) {
          this.logError(`governance notification ${eventType} for audit row ${resourceId} failed for one recipient (requestId ${requestId})`, err instanceof Error ? err.message : err);
        }
      }
    };
    const nv = asRecord(row.newValue);
    const ov = asRecord(row.oldValue);

    // q157: every size reduction is told to the Audit, which may contest (and never decides).
    if (row.entityType === "OrganizationProfile" && row.action === "SUBMIT" && nv["lowersSize"] === true) {
      const pending = nv["status"] === "PENDING";
      await send(
        await this.source.holdersOf(tenantId, "audit.read"),
        "ORGPROFILE_SIZE_LOWERED",
        row.id,
        pending
          ? "La taille du profil d’organisation est abaissée, en attente de confirmation. Vous pouvez la contester."
          : "La taille du profil d’organisation a été abaissée. Vous pouvez la contester.",
      );
      if (pending) {
        await send(
          await this.source.holdersOf(tenantId, "orgprofile.approve"),
          "ORGPROFILE_APPROVAL_PENDING",
          typeof nv["id"] === "string" ? nv["id"] : row.entityId,
          "Une baisse de taille du profil d’organisation attend votre confirmation.",
        );
      }
    }

    // R-6.4 (+ SEC-PNL-04: an action with no second person must be visible to those who can review it).
    if (row.governanceException && row.governanceException !== RISK_MANAGER_VACANCY_EXCEPTION) {
      const manager = await this.source.managerId(tenantId);
      await send(
        [...(await this.source.holdersOf(tenantId, "governanceexception.review")), ...(manager ? [manager] : [])],
        "GOVERNANCE_EXCEPTION_RECORDED",
        row.id,
        "Une action a été appliquée sans validation indépendante. Vous pouvez la revoir ou la contester.",
      );
    }

    if (row.entityType === "SelfValidationPolicyRequest" && row.action === "SUBMIT") {
      await send(
        await this.source.holdersOf(tenantId, "config.selfvalidation.approve"),
        "SELF_VALIDATION_POLICY_REQUEST_PENDING",
        row.entityId,
        "Une demande d’assouplissement de la politique d’auto-validation attend votre décision.",
      );
    }

    if (row.entityType === "GovernancePrincipleAcceptance" && row.action === "CREATE" && nv["status"] === "PENDING") {
      await send(
        await this.source.holdersOf(tenantId, "governanceprinciple.acceptance.confirm"),
        "PRINCIPLE_ACCEPTANCE_PENDING",
        row.entityId,
        "L’acceptation d’un principe de gouvernance non respecté attend votre confirmation.",
      );
    }

    // q170 (DECISION-083): an early end by someone else (the Audit, typically) is told to the person who accepted.
    // `revoke` stores the whole previous row as oldValue; the expiry close done by a new acceptance does not (no status).
    if (
      row.entityType === "GovernancePrincipleAcceptance" && row.action === "CLOSE" && nv["status"] === "REVOKED" &&
      (ov["status"] === "ACTIVE" || ov["status"] === "PENDING") && typeof nv["acceptedBy"] === "string"
    ) {
      await send(
        [nv["acceptedBy"]],
        "PRINCIPLE_ACCEPTANCE_REVOKED",
        row.entityId,
        "Votre acceptation d’un principe de gouvernance non respecté a été retirée. Le principe redevient « non respecté ».",
      );
    }

    if (row.entityType === "GovernanceExceptionReview" && row.action === "CREATE" && nv["outcome"] === "CONTESTED") {
      const manager = await this.source.managerId(tenantId);
      await send(
        [...(await this.source.groupMembers(tenantId, ["RISK_MANAGER", "RISK_COMMITTEE"])), ...(manager ? [manager] : [])],
        "GOVERNANCE_EXCEPTION_CONTESTED",
        typeof nv["auditLogId"] === "string" ? nv["auditLogId"] : row.entityId,
        "Une action appliquée sans validation indépendante a été contestée.",
      );
    }

    if (row.entityType === "Role" && row.action === "ROLE_CHANGE" && row.systemGroup && FIXED_GROUPS.includes(row.systemGroup)) {
      if (row.oldValue === null && row.newValue !== null) {
        // R-6.3 / q144: a new Audit or Committee member learns about what is waiting for review.
        const newcomer = nv["userId"];
        if ((row.systemGroup === "AUDIT" || row.systemGroup === "RISK_COMMITTEE") && typeof newcomer === "string") {
          const count = await this.source.unreviewedExceptionCount(tenantId);
          if (count > 0) {
            await send(
              [newcomer],
              "GOVERNANCE_EXCEPTIONS_TO_REVIEW",
              row.id,
              `${count} action(s) appliquée(s) sans validation indépendante n’ont pas encore été revues. Consultez le panel de gouvernance.`,
            );
          }
        }
      } else if (row.newValue === null && typeof ov["userId"] === "string") {
        const replaced = all.some((r) => r.id !== row.id && r.entityType === "Role" && r.entityId === row.entityId && r.oldValue === null && r.newValue !== null);
        if (!replaced) {
          const removed = ov["userId"];
          told.add(removed);
          await send(
            await this.source.groupMembers(tenantId, FIXED_GROUPS),
            "GOVERNANCE_MEMBER_REMOVED",
            row.id,
            `Un membre du groupe ${GROUP_LABELS[row.systemGroup]} a été retiré.`,
          );
        }
      }
    }
  }
}
