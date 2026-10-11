import { useId } from "react";
import "./Tabs.css";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Unavailable but explained: stays focusable (`aria-disabled`), click ignored. */
  disabled?: boolean;
  /** Why the tab is unavailable; announced on focus. */
  disabledReason?: string;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (value: T) => void;
}

/**
 * Navigation between pages, not a tablist (`aria-current="page"`, no
 * `role="tab"`): real tabs only when a screen needs them.
 *
 * Fixes a real accessibility bug (DESIGN_NOTES.md section 1): the previous
 * pattern used `disabled={isActive}` to mark the current tab, which pulls
 * it out of the tab order and gets announced as "disabled" rather than
 * "current page" by screen readers. Uses `aria-current="page"` and a
 * visual class instead — the tab stays keyboard-activatable either way.
 */
export function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  const baseId = useId();
  return (
    <nav className="gs-tabs">
      {items.map((item) => {
        const reasonId = item.disabled && item.disabledReason ? `${baseId}-${item.value}` : undefined;
        const classes = ["gs-tab", item.value === active && "gs-tab-active", item.disabled && "gs-tab-disabled"];
        return (
          <span key={item.value} className="gs-tab-wrap">
            <button
              type="button"
              className={classes.filter(Boolean).join(" ")}
              aria-current={item.value === active ? "page" : undefined}
              aria-disabled={item.disabled || undefined}
              aria-describedby={reasonId}
              onClick={() => {
                if (!item.disabled) onChange(item.value);
              }}
            >
              {item.label}
            </button>
            {reasonId && (
              <span id={reasonId} className="gs-visually-hidden">
                {item.disabledReason}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
