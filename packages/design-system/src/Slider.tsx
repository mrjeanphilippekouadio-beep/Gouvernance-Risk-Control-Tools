import { useId } from "react";
import "./Slider.css";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Formats the value readout. Defaults to the raw number. */
  formatValue?: (value: number) => string;
}

/**
 * Continuous numeric input with an always-visible readout (design system
 * section "Slider") — measured effectiveness, weighting, any 0-to-N scale.
 * Native `input[type=range]` on purpose: it already ships keyboard support
 * and the correct ARIA slider semantics.
 */
export function Slider({
  value,
  onChange,
  label,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  formatValue = String,
}: SliderProps) {
  const id = useId();
  return (
    <div className="gs-slider">
      {label && (
        <label className="gs-slider-label" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="gs-slider-value">{formatValue(value)}</span>
    </div>
  );
}
