import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import "./MessageBanner.css";

export type MessageTone = "info" | "success" | "warning" | "danger";

interface MessageBannerProps {
  tone: MessageTone;
  /** Bold first line; omit for a single-paragraph banner. */
  title?: string;
  children?: ReactNode;
  /** Set false to drop the leading icon. */
  showIcon?: boolean;
}

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
} as const;

/**
 * Contextual notification box (design system section "Message"). Named
 * `MessageBanner` rather than `Message` to avoid colliding with the
 * `Message` export of UI kits commonly present in the same app (antd,
 * semantic, …) — the class prefix stays `gs-msg`.
 *
 * `role="alert"` only on the two tones that interrupt (warning/danger);
 * info/success are `role="status"` so they do not preempt a screen reader.
 */
export function MessageBanner({ tone, title, children, showIcon = true }: MessageBannerProps) {
  const Icon = ICONS[tone];
  return (
    <div
      className={`gs-msg gs-msg-${tone}`}
      role={tone === "warning" || tone === "danger" ? "alert" : "status"}
    >
      {showIcon && <Icon className="gs-msg-icon" aria-hidden="true" />}
      <div className="gs-msg-content">
        {title && <div className="gs-msg-head">{title}</div>}
        {children !== undefined && <p>{children}</p>}
      </div>
    </div>
  );
}
