import type { ReactNode } from "react";
import { Fragment } from "react";
import "./Menu.css";

export interface MenuItem {
  label: string;
  /** Renders an anchor when set, a button otherwise. */
  href?: string;
  onSelect?: () => void;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
}

export interface MenuGroup {
  /** Uppercase group heading; omit for an ungrouped block. */
  label?: string;
  items: MenuItem[];
}

interface MenuProps {
  groups: MenuGroup[];
  ariaLabel?: string;
  className?: string;
}

/**
 * Compact grouped list for contextual menus — quick actions, view
 * switches, export targets (design system section "Menu"). Same visual
 * language as the side navigation but explicitly *not* the main nav.
 */
export function Menu({ groups, ariaLabel, className }: MenuProps) {
  return (
    <div className={["gs-menu", className].filter(Boolean).join(" ")} role="menu" aria-label={ariaLabel}>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.label ?? groupIndex}>
          {group.label && <div className="gs-menu-group">{group.label}</div>}
          {group.items.map((item, itemIndex) => {
            const classes = ["gs-menu-item", item.active ? "gs-menu-item-active" : null]
              .filter(Boolean)
              .join(" ");
            const content = (
              <>
                {item.icon}
                {item.label}
              </>
            );
            return item.href ? (
              <a
                key={`${item.label}-${itemIndex}`}
                role="menuitem"
                className={classes}
                href={item.href}
                aria-current={item.active ? "true" : undefined}
                onClick={item.onSelect}
              >
                {content}
              </a>
            ) : (
              <button
                key={`${item.label}-${itemIndex}`}
                type="button"
                role="menuitem"
                className={classes}
                disabled={item.disabled}
                aria-current={item.active ? "true" : undefined}
                onClick={item.onSelect}
              >
                {content}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
