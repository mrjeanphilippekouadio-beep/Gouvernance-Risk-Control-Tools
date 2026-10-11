import type { ReactElement } from "react";
import { cloneElement, useEffect, useId, useState } from "react";
import "./Tooltip.css";

interface TooltipProps {
  content: string;
  /** The single focusable element the tooltip describes. */
  children: ReactElement<{ "aria-describedby"?: string }>;
}

/**
 * Accessible tooltip: opens on hover and keyboard focus, closes on blur,
 * mouse leave or Escape (WCAG 1.4.13 — dismissible, hoverable, persistent).
 * The text supplements the trigger's own name; it never replaces it.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const existing = children.props["aria-describedby"];
  const trigger = cloneElement(children, {
    "aria-describedby": [existing, open ? id : undefined].filter(Boolean).join(" ") || undefined,
  });

  return (
    <span
      className="gs-tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      {open && (
        <span role="tooltip" id={id} className="gs-tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
