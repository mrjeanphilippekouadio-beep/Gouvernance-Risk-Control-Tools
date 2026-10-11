import type { ReactNode } from "react";
import { Button } from "./Button";
import "./BulkActionBar.css";

interface BulkActionBarProps {
  /** Number of selected rows; the bar is hidden when 0 (the live region stays mounted). */
  count: number;
  /** Action buttons; what they do (and the per-row result) is the screen's business. */
  children?: ReactNode;
  onClear: () => void;
}

/**
 * Bar shown above a selectable Table (M14). The live region is always
 * mounted (empty at 0) so a screen reader also hears the 0 -> 1 change.
 */
export function BulkActionBar({
  count,
  children,
  onClear,
}: BulkActionBarProps) {
  const active = !(count <= 0);
  const label = `${count} ${count > 1 ? "éléments sélectionnés" : "élément sélectionné"}`;
  return (
    <>
      <span className="gs-visually-hidden" role="status">
        {active ? label : ""}
      </span>
      {active && (
        <section className="gs-bulkbar" aria-label="Actions en lot">
          <span className="gs-bulkbar-count" aria-hidden="true">
            {label}
          </span>
          <div className="gs-bulkbar-actions">
            {children}
            <Button size="sm" onClick={onClear}>
              Tout désélectionner
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
