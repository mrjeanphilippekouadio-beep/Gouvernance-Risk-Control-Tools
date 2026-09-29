import type { ReactNode } from "react";
import "./Table.css";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  /** Shown instead of the table body when `rows` is empty and not loading. */
  emptyMessage: string;
}

/**
 * Single reusable table for every list screen (Risk, Role, Feedback, and
 * every future domain module) — see DESIGN_NOTES.md section 5.1. Handles
 * the Default/Loading/Empty states every list must define (section 4.3
 * point 5); pagination/sorting deliberately left out for now (not yet
 * needed at current data volumes — DESIGN_NOTES.md flags it as the next
 * addition once a screen actually needs it).
 */
export function Table<T>({ columns, rows, rowKey, loading, emptyMessage }: TableProps<T>) {
  if (loading) {
    return <p className="table-status">Chargement…</p>;
  }

  if (rows.length === 0) {
    return <p className="table-status">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll">
      <table className="gs-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
