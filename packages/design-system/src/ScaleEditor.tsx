import type { KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import "./FormField.css";
import "./Fields.css";
import "./ScaleEditor.css";

export interface ScaleLevel {
  id: string;
  label: string;
}
export interface ScaleAxis {
  id: string;
  label: string;
}
/** Descriptions by axis id, then by level id. Missing / empty = "À compléter". */
export type ScaleValue = Record<string, Record<string, string>>;

interface ScaleEditorProps {
  levels: ScaleLevel[];
  axes: ScaleAxis[];
  value: ScaleValue;
  onChange: (next: ScaleValue) => void;
  /** Limits come from the backend; used only to flag a count out of range. */
  minLevels: number;
  maxLevels: number;
  maxAxes: number;
  ariaLabel: string;
}

const cellText = (value: ScaleValue, axis: string, level: string) => value[axis]?.[level] ?? "";

/**
 * Editable grid of descriptions: one text per level (columns) and per axis
 * (rows). Controlled, no calculation. Keyboard: arrows move between cells
 * when the caret is at the matching edge of the text (so text editing keeps
 * its arrows); one tab stop for the whole grid (roving tabindex).
 */
export function ScaleEditor({ levels, axes, value, onChange, minLevels, maxLevels, maxAxes, ariaLabel }: ScaleEditorProps) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [rawActive, setActive] = useState<[number, number]>([0, 0]);
  // Keep the single tab stop inside the grid when axes or levels are removed.
  const active: [number, number] = [
    Math.min(rawActive[0], Math.max(axes.length - 1, 0)),
    Math.min(rawActive[1], Math.max(levels.length - 1, 0)),
  ];
  const idPrefix = useId();

  const total = levels.length * axes.length;
  const filled = axes.reduce((n, a) => n + levels.filter((l) => cellText(value, a.id, l.id).trim() !== "").length, 0);
  const problems = [
    levels.length < minLevels || levels.length > maxLevels
      ? `Le nombre de niveaux doit être compris entre ${minLevels} et ${maxLevels}.`
      : null,
    axes.length < 1 || axes.length > maxAxes ? `Le nombre d'axes doit être compris entre 1 et ${maxAxes}.` : null,
  ].filter(Boolean);

  const focusCell = (row: number, col: number) => {
    const axis = axes[row];
    const level = levels[col];
    if (axis && level) refs.current[`${axis.id}:${level.id}`]?.focus();
  };

  const jump = () => {
    for (let r = 0; r < axes.length; r++)
      for (let c = 0; c < levels.length; c++)
        if (cellText(value, axes[r].id, levels[c].id).trim() === "") return focusCell(r, c);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, row: number, col: number) => {
    const t = event.currentTarget;
    if (t.selectionStart !== t.selectionEnd) return;
    const atStart = t.selectionStart === 0;
    const atEnd = t.selectionStart === t.value.length;
    const move: Record<string, [boolean, number, number]> = {
      ArrowLeft: [atStart, row, col - 1],
      ArrowRight: [atEnd, row, col + 1],
      ArrowUp: [atStart, row - 1, col],
      ArrowDown: [atEnd, row + 1, col],
    };
    const m = move[event.key];
    if (!m || !m[0] || m[1] < 0 || m[2] < 0 || m[1] >= axes.length || m[2] >= levels.length) return;
    event.preventDefault();
    focusCell(m[1], m[2]);
  };

  return (
    <div className="gs-scale">
      <div className="gs-scale-bar">
        <span aria-live="polite">
          {filled} / {total} renseignés
        </span>
        <button type="button" className="gs-scale-jump" onClick={jump} disabled={filled === total}>
          Aller à la première cellule vide
        </button>
      </div>
      {problems.length > 0 && (
        <p className="form-field__error" role="alert">
          {problems.join(" ")}
        </p>
      )}
      <div className="gs-scale-scroll">
        <table role="grid" aria-label={ariaLabel} className="gs-scale-grid">
          <thead>
            <tr>
              <td />
              {levels.map((l) => (
                <th key={l.id} scope="col">
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {axes.map((a, row) => (
              <tr key={a.id}>
                <th scope="row">{a.label}</th>
                {levels.map((l, col) => {
                  const text = cellText(value, a.id, l.id);
                  const emptyId = `${idPrefix}-${a.id}-${l.id}-empty`;
                  return (
                    <td key={l.id}>
                      <textarea
                        ref={(el) => {
                          refs.current[`${a.id}:${l.id}`] = el;
                        }}
                        className="gs-control gs-scale-cell"
                        rows={2}
                        aria-label={`${a.label}, ${l.label}`}
                        aria-describedby={text.trim() === "" ? emptyId : undefined}
                        tabIndex={active[0] === row && active[1] === col ? 0 : -1}
                        value={text}
                        onFocus={() => setActive([row, col])}
                        onKeyDown={(e) => onKeyDown(e, row, col)}
                        onChange={(e) => onChange({ ...value, [a.id]: { ...value[a.id], [l.id]: e.target.value } })}
                      />
                      {text.trim() === "" && (
                        <span id={emptyId} className="gs-scale-empty">
                          À compléter
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
