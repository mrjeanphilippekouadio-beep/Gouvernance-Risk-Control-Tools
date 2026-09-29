import type { ReactNode } from "react";
import "./Card.css";

interface CardProps {
  /** Card header — rendered only when provided. */
  header?: ReactNode;
  /** Card footer, right-aligned action row. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * Generic header / body / footer container (design system section "Card").
 * The `max-width` the artifact demo carried is intentionally not baked in —
 * width belongs to the layout using the card, not to the card.
 */
export function Card({ header, footer, children, className }: CardProps) {
  return (
    <div className={["gs-card", className].filter(Boolean).join(" ")}>
      {header !== undefined && <div className="gs-card-head">{header}</div>}
      {children !== undefined && <div className="gs-card-body">{children}</div>}
      {footer !== undefined && <div className="gs-card-foot">{footer}</div>}
    </div>
  );
}
