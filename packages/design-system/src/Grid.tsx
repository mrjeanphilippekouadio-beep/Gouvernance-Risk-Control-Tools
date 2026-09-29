import type { CSSProperties, ReactNode } from "react";
import "./Grid.css";

interface GridProps {
  /** Column count above the 640px breakpoint. Below it the grid is always 2 columns. */
  columns?: number;
  children?: ReactNode;
  className?: string;
}

/**
 * Responsive column grid (design system section "Grid") — the base layout
 * for any card disposition (dashboards, indicator tiles). Collapses to two
 * columns under 640px, per the validated CSS.
 */
export function Grid({ columns = 4, children, className }: GridProps) {
  return (
    <div
      className={["gs-grid", className].filter(Boolean).join(" ")}
      style={{ "--gs-grid-columns": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}

interface GridItemProps {
  /** Number of columns this cell spans. */
  span?: number;
  children?: ReactNode;
  className?: string;
}

/** A grid cell that spans more than one column. Plain children span one column. */
export function GridItem({ span = 1, children, className }: GridItemProps) {
  return (
    <div
      className={["gs-grid-item", className].filter(Boolean).join(" ")}
      style={{ gridColumn: `span ${span}` }}
    >
      {children}
    </div>
  );
}
