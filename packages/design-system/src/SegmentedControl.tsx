import "./SegmentedControl.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group — what the toggle switches. */
  ariaLabel?: string;
}

/**
 * Two-or-more-way view toggle (design system section "Filtre segmenté"):
 * inherent/residual, by-process/by-owner… Unlike `Tabs` it switches the
 * *reading* of one view rather than navigating between views.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className="gs-seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "gs-seg-btn gs-seg-btn-active" : "gs-seg-btn"}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
