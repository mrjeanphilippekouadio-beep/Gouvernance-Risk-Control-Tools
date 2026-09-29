import { Fragment } from "react";
import "./Breadcrumb.css";

export interface BreadcrumbItem {
  label: string;
  /** Omit on the last (current) item — it is rendered as plain bold text. */
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Accessible name of the nav landmark. */
  ariaLabel?: string;
}

/**
 * Trail of ancestors, last entry never clickable (design system section
 * "Breadcrumb"). Carries `aria-current="page"` on that last entry so the
 * position is announced, not just shown in bold.
 */
export function Breadcrumb({ items, ariaLabel = "Fil d'Ariane" }: BreadcrumbProps) {
  return (
    <nav className="gs-breadcrumb" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 && (
              <span className="gs-breadcrumb-sep" aria-hidden="true">
                /
              </span>
            )}
            {isLast || !item.href ? (
              <span className="gs-breadcrumb-current" aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            ) : (
              <a className="gs-breadcrumb-link" href={item.href}>
                {item.label}
              </a>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
