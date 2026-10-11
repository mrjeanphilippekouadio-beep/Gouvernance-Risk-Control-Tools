import { StatusBadge } from "./StatusBadge";
import type { StatusTone } from "./StatusBadge";
import "./MatrixView.css";

export interface MatrixCell {
  /** Value shown in the cell (a level or score supplied by the backend). */
  value: string;
  /** Text label; the tone alone never carries the meaning. */
  label: string;
  tone: StatusTone;
}

interface MatrixViewProps {
  /** Row headers, top to bottom (e.g. impact levels). Any length. */
  rows: string[];
  /** Column headers, left to right (e.g. probability levels). Any length. */
  columns: string[];
  rowTitle: string;
  columnTitle: string;
  cell: (row: number, column: number) => MatrixCell;
  caption: string;
}

/**
 * Read-only P x I style matrix of variable size (M4). Pure display: the
 * value, label and tone of every cell come from the caller; nothing is
 * computed here (no impact retained, no appetite).
 */
export function MatrixView({ rows, columns, rowTitle, columnTitle, cell, caption }: MatrixViewProps) {
  return (
    <div className="table-scroll">
      <table className="gs-matrix">
        <caption className="gs-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              {rowTitle} / {columnTitle}
            </th>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {columns.map((c, ci) => {
                const data = cell(ri, ci);
                return (
                  <td key={c}>
                    <span className="gs-matrix-value">{data.value}</span>
                    <StatusBadge tone={data.tone} label={data.label} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
