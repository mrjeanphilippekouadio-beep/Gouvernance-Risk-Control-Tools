import "./StatusBadge.css";

export type StatusTone = "danger" | "warning" | "success" | "neutral" | "info";

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

/**
 * Single component for every status/level display in the app (Risk.status,
 * Role active/disabled, Feedback.status, and every future domain with a
 * lifecycle) — see DESIGN_NOTES.md section 5.3. Always couples color with
 * a text label (never color alone, DESIGN_NOTES.md 4.1).
 */
export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{label}</span>;
}
