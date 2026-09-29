import { ChevronLeft, ChevronRight } from "lucide-react";
import "./Pagination.css";

interface PaginationProps {
  /** Current page, 1-based. */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  previousLabel?: string;
  nextLabel?: string;
  ariaLabel?: string;
}

/**
 * Builds the visible page list: always first and last, a window around the
 * current page, ellipses for the gaps. Under 8 pages everything fits, so
 * no ellipsis is produced.
 */
function pageList(page: number, pageCount: number): (number | "ellipsis")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < pageCount);
  const out: (number | "ellipsis")[] = [1];
  if (around[0] > 2) out.push("ellipsis");
  out.push(...around);
  if (around[around.length - 1] < pageCount - 1) out.push("ellipsis");
  out.push(pageCount);
  return out;
}

/**
 * Page navigation for any paged list (design system section "Pagination").
 * Renders nothing below two pages — a single-page list needs no control.
 */
export function Pagination({
  page,
  pageCount,
  onChange,
  previousLabel = "Précédent",
  nextLabel = "Suivant",
  ariaLabel = "Pagination",
}: PaginationProps) {
  if (pageCount < 2) return null;

  return (
    <nav className="gs-pagination" aria-label={ariaLabel}>
      <button
        type="button"
        className="gs-pagination-nav"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft aria-hidden="true" />
        {previousLabel}
      </button>

      {pageList(page, pageCount).map((entry, index) =>
        entry === "ellipsis" ? (
          <span key={`gap-${index}`} className="gs-pagination-ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            className={entry === page ? "gs-pagination-page gs-pagination-page-active" : "gs-pagination-page"}
            aria-current={entry === page ? "page" : undefined}
            onClick={() => onChange(entry)}
          >
            {entry}
          </button>
        ),
      )}

      <button
        type="button"
        className="gs-pagination-nav"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        {nextLabel}
        <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  );
}
