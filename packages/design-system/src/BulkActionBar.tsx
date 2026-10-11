import type { ReactNode } from "react";
import { Button } from "./Button";
import "./BulkActionBar.css";

interface BulkActionBarProps {
  /** Number of selected rows; the bar renders nothing when 0. */
  count: number;
  /** Action buttons; what they do (and the per-row result) is the screen's business. */
  children?: ReactNode;
  onClear: () => void;
}

/**
 * Bar shown above a selectable Table (M14). The count is a polite live
 * region so a screen reader hears "3 éléments sélectionnés" as it changes.
 */
export function BulkActionBar({ count, children, onClear }: BulkActionBarProps) {
  if (count <= 0) return null;
  return (
    <section className="gs-bulkbar" aria-label="Actions en lot">
      <span className="gs-bulkbar-count" role="status">
        {count} {count > 1 ? "éléments sélectionnés" : "élément sélectionné"}
      </span>
      <div className="gs-bulkbar-actions">
        {children}
        <Button size="sm" onClick={onClear}>
          Tout désélectionner
        </Button>
      </div>
    </section>
  );
}
