import type { ReactNode } from "react";
import "./Card.css";

interface CardProps {
  /** Card header — rendered only when provided. */
  header?: ReactNode;
  /** Card footer, right-aligned action row. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Selected state: thicker primary border + hidden "Sélectionné" text (not colour alone). */
  selected?: boolean;
  /** Unavailable state: muted, not interactive. */
  disabled?: boolean;
}

/**
 * Generic header / body / footer container (design system section "Card").
 * The `max-width` the artifact demo carried is intentionally not baked in —
 * width belongs to the layout using the card, not to the card.
 */
export function Card({ header, footer, children, className, selected, disabled }: CardProps) {
  const classes = ["gs-card", selected && "gs-card-selected", disabled && "gs-card-disabled", className];
  return (
    <div className={classes.filter(Boolean).join(" ")} data-selected={selected || undefined} aria-disabled={disabled || undefined}>
      {selected && <span className="gs-visually-hidden">Sélectionné.</span>}
      {header !== undefined && <div className="gs-card-head">{header}</div>}
      {children !== undefined && <div className="gs-card-body">{children}</div>}
      {footer !== undefined && <div className="gs-card-foot">{footer}</div>}
    </div>
  );
}
