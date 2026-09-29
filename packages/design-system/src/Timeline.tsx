import "./Timeline.css";

export type TimelineState = "done" | "current" | "pending";

export interface TimelineItem {
  label: string;
  /** Second line — date, source, any free-form context. */
  detail?: string;
  state?: TimelineState;
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

/**
 * Vertical timeline of dated steps (design system section "Occurrence").
 * One component for both readings the product needs — an approval trail
 * (done / current / pending) and a history of past events (all `done`).
 * Stays free of any domain field: callers format `label`/`detail`.
 */
export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={["gs-timeline", className].filter(Boolean).join(" ")}>
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`} className={`gs-timeline-item gs-timeline-${item.state ?? "pending"}`}>
          <span className="gs-timeline-dot" aria-hidden="true" />
          <div className="gs-timeline-text">
            <b>{item.label}</b>
            {item.detail && <span>{item.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
