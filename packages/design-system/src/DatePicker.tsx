import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import "./DatePicker.css";

interface DatePickerProps {
  /** ISO calendar date, `YYYY-MM-DD`, or null when empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** BCP-47 tag driving month names, weekday initials and the input format. */
  locale?: string;
  todayLabel?: string;
  clearLabel?: string;
}

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Parses at local midnight — `new Date("2026-09-30")` would be UTC and can shift a day. */
const fromIso = (iso: string | null) => {
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Monday-first offset of the 1st of `month`, 0..6. */
const leadingBlanks = (month: Date) => (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;

/**
 * Text field plus a monthly calendar popover (design system section
 * "Sélecteur de date"). A bare `<input type="date">` is deliberately not
 * used: its rendering and format differ between browsers, which the
 * validated design rules out.
 *
 * Month names, weekday initials and the displayed format all come from
 * `Intl` rather than hardcoded French strings, so the component travels
 * with the rest of the library.
 */
export function DatePicker({
  value,
  onChange,
  label,
  placeholder = "jj/mm/aaaa",
  disabled = false,
  locale = "fr-FR",
  todayLabel = "Aujourd'hui",
  clearLabel = "Effacer",
}: DatePickerProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = fromIso(value);
  const [month, setMonth] = useState(() => {
    const base = selected ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // Re-centre the calendar when the caller changes the value from outside.
  useEffect(() => {
    const parsed = fromIso(value);
    if (parsed) setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  }, [value]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    // 2024-01-01 is a Monday — the anchor for a Monday-first week.
    return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, 1 + index)));
  }, [locale]);

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month),
    [locale, month],
  );

  const days = useMemo(() => {
    const blanks = leadingBlanks(month);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cellCount = Math.ceil((blanks + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(month.getFullYear(), month.getMonth(), index - blanks + 1);
      return { date, outside: date.getMonth() !== month.getMonth() };
    });
  }, [month]);

  const todayIso = toIso(new Date());
  const shiftMonth = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const pick = (date: Date) => {
    onChange(toIso(date));
    setOpen(false);
  };

  return (
    <div className="gs-datepicker" ref={rootRef}>
      {label && (
        <label className="gs-datepicker-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="gs-datepicker-field">
        <input
          id={id}
          type="text"
          readOnly
          disabled={disabled}
          placeholder={placeholder}
          value={selected ? new Intl.DateTimeFormat(locale).format(selected) : ""}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-popover` : undefined}
          onClick={() => !disabled && setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (!disabled) setOpen((current) => !current);
            }
          }}
        />
        <CalendarDays className="gs-datepicker-icon" aria-hidden="true" />
      </div>

      {open && (
        <div id={`${id}-popover`} className="gs-datepicker-popover" role="dialog" aria-label={monthTitle}>
          <div className="gs-datepicker-head">
            <button type="button" aria-label="Mois précédent" onClick={() => shiftMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <b>{monthTitle}</b>
            <button type="button" aria-label="Mois suivant" onClick={() => shiftMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>

          <div className="gs-datepicker-grid">
            {weekdays.map((day, index) => (
              <span key={`${day}-${index}`} className="gs-datepicker-dow">
                {day}
              </span>
            ))}
            {days.map(({ date, outside }) => {
              const iso = toIso(date);
              const classes = [
                outside ? "gs-datepicker-day-outside" : null,
                iso === todayIso ? "gs-datepicker-day-today" : null,
                iso === value ? "gs-datepicker-day-selected" : null,
              ].filter(Boolean);
              return (
                <button
                  key={iso}
                  type="button"
                  className={["gs-datepicker-day", ...classes].join(" ")}
                  aria-current={iso === todayIso ? "date" : undefined}
                  aria-pressed={iso === value}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="gs-datepicker-foot">
            <button type="button" onClick={() => pick(new Date())}>
              {todayLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {clearLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
