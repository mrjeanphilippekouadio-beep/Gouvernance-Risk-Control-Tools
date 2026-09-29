import type { ReactNode } from "react";
import "./Panel.css";

export interface PanelTab {
  value: string;
  label: string;
}

interface PanelProps {
  /** Panel heading; omit for a headless panel. */
  title?: ReactNode;
  /** Optional tab strip under the heading. */
  tabs?: PanelTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  /** Rows — typically `PanelRow` children. */
  children?: ReactNode;
  className?: string;
}

/**
 * Generic titled container with an optional tab strip and a list of rows
 * (design system section "Panel"). Used for any secondary list attached to
 * a record. Deliberately distinct from the domain side-rail panel, which
 * carries its own tab semantics and stays outside this library.
 */
export function Panel({ title, tabs, activeTab, onTabChange, children, className }: PanelProps) {
  return (
    <div className={["gs-panel", className].filter(Boolean).join(" ")}>
      {title !== undefined && <div className="gs-panel-head">{title}</div>}
      {tabs && tabs.length > 0 && (
        <div className="gs-panel-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={tab.value === activeTab}
              className={tab.value === activeTab ? "gs-panel-tab gs-panel-tab-active" : "gs-panel-tab"}
              onClick={() => onTabChange?.(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

interface PanelRowProps {
  /** Leading icon, rendered before the label. */
  icon?: ReactNode;
  children?: ReactNode;
  /** Right-aligned slot — a badge, a count, an action. */
  trailing?: ReactNode;
}

/** One row of a `Panel`: leading icon + label on the left, trailing slot on the right. */
export function PanelRow({ icon, children, trailing }: PanelRowProps) {
  return (
    <div className="gs-panel-row">
      <span className="gs-panel-row-left">
        {icon}
        {children}
      </span>
      {trailing}
    </div>
  );
}
