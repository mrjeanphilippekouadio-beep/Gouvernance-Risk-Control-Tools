import { Chart, Legend, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { Scatter } from "react-chartjs-2";
import { colorAt } from "./shared";

Chart.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

export interface ScatterSeries {
  label: string;
  points: { x: number; y: number }[];
  /** CSS color. Falls back to the shared palette when omitted. */
  color?: string;
  /** Plot this series against the right-hand axis. Requires `secondaryYAxis`. */
  secondary?: boolean;
}

export interface ScatterChartProps {
  series: ScatterSeries[];
  /**
   * Adds a second, independently scaled y axis on the right; series opt into
   * it with `secondary: true`. Use when two series share an x axis but not a
   * unit or an order of magnitude.
   */
  secondaryYAxis?: boolean;
  xLabel?: string;
  yLabel?: string;
  secondaryYLabel?: string;
  /** Pixel height of the chart area. */
  height?: number;
}

/**
 * Generic scatter chart over one or more {x, y} series, optionally with a
 * second y axis. Carries no domain semantics.
 */
export function ScatterChart({
  series,
  secondaryYAxis = false,
  xLabel,
  yLabel,
  secondaryYLabel,
  height = 280,
}: ScatterChartProps) {
  const data = {
    datasets: series.map((s, i) => {
      const color = colorAt(i, s.color);
      return {
        label: s.label,
        data: s.points,
        backgroundColor: color,
        borderColor: color,
        pointRadius: 4,
        yAxisID: secondaryYAxis && s.secondary ? "y1" : "y",
      };
    }),
  };

  return (
    <div style={{ height }}>
      <Scatter
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: series.length > 1, position: "bottom" } },
          scales: {
            x: { title: { display: Boolean(xLabel), text: xLabel ?? "" } },
            y: {
              type: "linear",
              position: "left",
              title: { display: Boolean(yLabel), text: yLabel ?? "" },
            },
            ...(secondaryYAxis && {
              y1: {
                type: "linear" as const,
                position: "right" as const,
                title: { display: Boolean(secondaryYLabel), text: secondaryYLabel ?? "" },
                // The right axis owns its own scale; its gridlines would double
                // up with the left axis's.
                grid: { drawOnChartArea: false },
              },
            }),
          },
        }}
      />
    </div>
  );
}
