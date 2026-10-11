import { CircleAlert, CircleCheck, Info, Minus, TriangleAlert } from "lucide-react";
import "./StatusBadge.css";

export type StatusTone = "danger" | "warning" | "success" | "neutral" | "info";

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

const ICONS = {
  danger: CircleAlert,
  warning: TriangleAlert,
  success: CircleCheck,
  neutral: Minus,
  info: Info,
} as const;

/**
 * Single component for every status/level display in the app (Risk.status,
 * Role active/disabled, Feedback.status, and every future domain with a
 * lifecycle) — see DESIGN_NOTES.md section 5.3. Always couples color with
 * a text label and a tone-specific icon (never color alone, DESIGN_NOTES.md
 * 4.1, WCAG 1.4.1). The icon is decorative (`aria-hidden`): the label is
 * the accessible name.
 */
export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const Icon = ICONS[tone] ?? ICONS.neutral;
  return (
    <span className={`status-badge status-badge-${tone}`}>
      <Icon className="status-badge-icon" aria-hidden="true" />
      {label}
    </span>
  );
}
