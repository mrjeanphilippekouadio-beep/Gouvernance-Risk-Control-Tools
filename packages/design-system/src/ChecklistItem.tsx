import type { ReactNode } from "react";
import { Ban, CheckCircle2, Circle } from "lucide-react";
import "./ChecklistItem.css";

export type ChecklistStatus = "done" | "todo" | "blocked";

interface ChecklistItemProps {
  label: string;
  status: ChecklistStatus;
  /** What is missing / why it is blocked. */
  detail?: string;
  /** Action link or button supplied by the caller (e.g. `<a href>`). */
  action?: ReactNode;
}

const STATUS = {
  done: { text: "Fait", Icon: CheckCircle2 },
  todo: { text: "À compléter", Icon: Circle },
  blocked: { text: "Bloqué", Icon: Ban },
} as const;

/** One checklist row: status as text + icon (never colour alone). */
export function ChecklistItem({ label, status, detail, action }: ChecklistItemProps) {
  const { text, Icon } = STATUS[status];
  return (
    <div className={`gs-checklist-item gs-checklist-${status}`}>
      <span className="gs-checklist-status">
        <Icon size={16} aria-hidden="true" />
        {text}
      </span>
      <div className="gs-checklist-text">
        <b>{label}</b>
        {detail && <span>{detail}</span>}
      </div>
      {action && <div className="gs-checklist-action">{action}</div>}
    </div>
  );
}
