import type { ReactNode } from "react";
import { Checkbox } from "./Fields";
import "./Table.css";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Header becomes a sort button (needs `sort` + `onSort` on the table). */
  sortable?: boolean;
}

export interface TableSort {
  key: string;
  direction: "asc" | "desc";
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  /** Shown instead of the table body when `rows` is empty and not loading. */
  emptyMessage: string;
  /** Accessible table name, rendered as a visually hidden `<caption>`. */
  caption?: string;
  /** Row height: "default" (40 px) or "compact" (32 px). */
  density?: "default" | "compact";
  /** Zebra striping on even rows. */
  striped?: boolean;
  /**
   * Row selection: when `onSelectionChange` is given a checkbox column is
   * added. `selectedKeys` marks rows (`aria-selected`, highlighted). The
   * table only reports the choice; what it means is the screen's business.
   */
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Accessible name of each row checkbox. */
  selectionLabel?: (row: T) => string;
  /** Current sort, displayed only (`aria-sort`); sorting itself is the caller's. */
  sort?: TableSort;
  onSort?: (key: string) => void;
}

/**
 * Single reusable table for every list screen (Risk, Role, Feedback, and
 * every future domain module) — see DESIGN_NOTES.md section 5.1. Handles
 * the Default/Loading/Empty states every list must define (section 4.3
 * point 5); pagination/sorting deliberately left out for now (not yet
 * needed at current data volumes — DESIGN_NOTES.md flags it as the next
 * addition once a screen actually needs it).
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  loading,
  emptyMessage,
  caption,
  density = "default",
  striped,
  selectedKeys,
  onSelectionChange,
  selectionLabel,
  sort,
  onSort,
}: TableProps<T>) {
  if (loading) {
    return (
      <p className="table-status" role="status" aria-busy="true">
        Chargement…
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="table-status">{emptyMessage}</p>;
  }

  const selectable = Boolean(onSelectionChange);
  const selected = new Set(selectedKeys ?? []);
  const keys = rows.map(rowKey);
  const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));
  const someSelected = keys.some((k) => selected.has(k));
  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onSelectionChange?.([...next]);
  };
  const tableClasses = ["gs-table", density === "compact" && "gs-table-compact", striped && "gs-table-striped"];

  return (
    <div className="table-scroll">
      <table className={tableClasses.filter(Boolean).join(" ")}>
        {caption && <caption className="gs-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="gs-table-select">
                <Checkbox
                  label={<span className="gs-visually-hidden">Tout sélectionner</span>}
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={(e) => onSelectionChange?.(e.target.checked ? keys : [])}
                />
              </th>
            )}
            {columns.map((col) => {
              const sorted = sort?.key === col.key ? sort.direction : undefined;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                >
                  {col.sortable && onSort ? (
                    <button type="button" className="gs-table-sort" onClick={() => onSort(col.key)}>
                      {col.header}
                      <span aria-hidden="true">{sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : " ↕"}</span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const isSelected = selected.has(key);
            return (
            <tr key={key} aria-selected={selectable ? isSelected : undefined} className={isSelected ? "gs-table-row-selected" : undefined}>
              {selectable && (
                <td className="gs-table-select">
                  <Checkbox
                    label={<span className="gs-visually-hidden">{selectionLabel ? selectionLabel(row) : "Sélectionner la ligne"}</span>}
                    checked={isSelected}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                </td>
              )}
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
