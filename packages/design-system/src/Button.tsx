import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { useId } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Busy state: keeps the label, sets `aria-busy`, ignores clicks. */
  loading?: boolean;
  /**
   * Unavailable but explained: the button stays focusable (`aria-disabled`,
   * not `disabled`) and the reason is announced on focus through
   * `aria-describedby`. Clicks are ignored. Native `disabled` still works
   * unchanged for the cases that need no explanation.
   */
  disabledReason?: string;
}

/**
 * DESIGN_NOTES.md section 5.4: primary/secondary/destructive hierarchy so
 * a destructive action (Désactiver, Révoquer) never carries the same
 * visual weight as a primary one (Créer). Defaults to "secondary" since
 * most actions in the app today are not the primary action of their form.
 */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  loading = false,
  disabledReason,
  onClick,
  children,
  "aria-describedby": describedBy,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const blocked = loading || Boolean(disabledReason);
  const classes = ["btn", `btn-${variant}`, className].filter(Boolean).join(" ");
  const describedIds = [describedBy, disabledReason ? reasonId : undefined].filter(Boolean).join(" ") || undefined;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        type={type}
        className={classes}
        aria-busy={loading || undefined}
        aria-disabled={blocked || undefined}
        aria-describedby={describedIds}
        onClick={handleClick}
        {...rest}
      >
        {loading && <span className="btn-spinner" aria-hidden="true" />}
        {children}
      </button>
      {/* Sibling, not child: keeps the reason out of the button's accessible name. */}
      {disabledReason && (
        <span id={reasonId} className="gs-visually-hidden">
          {disabledReason}
        </span>
      )}
    </>
  );
}
