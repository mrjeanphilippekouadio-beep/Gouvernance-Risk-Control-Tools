import { Table } from "./Table";
import type { TableColumn } from "./Table";

export interface VersionChange {
  /** Name of the field that changed. */
  field: string;
  /** Previous value as supplied by the backend; null when the field was empty. */
  before: string | null;
  after: string | null;
}

interface VersionComparisonProps {
  changes: VersionChange[];
  loading?: boolean;
  caption?: string;
}

const EMPTY = "(vide)";

const columns: TableColumn<VersionChange>[] = [
  { key: "field", header: "Champ modifié", render: (c) => c.field },
  { key: "before", header: "Ancienne valeur", render: (c) => c.before ?? EMPTY },
  { key: "after", header: "Nouvelle valeur", render: (c) => c.after ?? EMPTY },
];

/**
 * Field-by-field comparison of two versions (M15). Displays the differences
 * the backend computed; it never diffs anything itself.
 */
export function VersionComparison({ changes, loading = false, caption = "Comparaison de versions" }: VersionComparisonProps) {
  return (
    <Table
      columns={columns}
      rows={changes}
      rowKey={(c) => c.field}
      loading={loading}
      emptyMessage="Aucune différence entre ces deux versions."
      caption={caption}
    />
  );
}
