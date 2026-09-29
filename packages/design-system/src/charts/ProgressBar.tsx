import { useEffect, useState } from "react";
import "./ProgressBar.css";

export interface ProgressBarProps {
  /** Percentage, 0-100. Values outside the range are clamped. */
  value: number;
  /** Ease the fill to its value (and up from 0 on mount) instead of snapping. */
  animated?: boolean;
  /** Accessible name — required when no visible label sits next to the bar. */
  label?: string;
  /** Hide the numeric readout on the right. */
  hideValue?: boolean;
  /** CSS color of the fill. Defaults to the brand accent. */
  color?: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Animated progress bar. Deliberately not a Chart.js chart — a single
 * percentage needs a div and a CSS transition, not a canvas renderer.
 * Generic: the caller decides what the percentage measures.
 */
export function ProgressBar({
  value,
  animated = false,
  label,
  hideValue = false,
  color,
}: ProgressBarProps) {
  const target = clamp(value);
  // Start at 0 when animated so the fill eases in on mount, then settle.
  const [width, setWidth] = useState(animated ? 0 : target);
  useEffect(() => setWidth(target), [target]);

  return (
    <div className={`gs-progress${animated ? " gs-progress--animated" : ""}`}>
      <div
        className="gs-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={target}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="gs-progress-fill" style={{ width: `${width}%`, background: color }} />
      </div>
      {!hideValue && <span className="gs-progress-value">{Math.round(target)}%</span>}
    </div>
  );
}
