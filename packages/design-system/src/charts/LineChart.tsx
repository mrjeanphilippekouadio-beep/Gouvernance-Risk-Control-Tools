import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { colorAt, fillFor, progressiveAnimation, type FillStyle } from "./shared";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

export interface LineSeries {
  label: string;
  /** One value per entry of `labels`; `null` leaves a gap in the line. */
  data: (number | null)[];
  /** CSS color. Falls back to the shared palette when omitted. */
  color?: string;
}

export interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  /** Area under the line. Omitted = no fill, just the stroke. */
  fill?: FillStyle;
  /** Sum series on top of each other instead of overlaying them. */
  stacked?: boolean;
  /** Animate the line drawing left-to-right on first render. */
  progressive?: boolean;
  /** Pixel height of the chart area. */
  height?: number;
}

/**
 * Generic line / area chart: labels on the x axis, one or more numeric series.
 * Carries no domain semantics — the caller decides what the numbers mean.
 *
 * Supersedes the former `TrendChart`, which was this component without the
 * `fill` / `stacked` / `progressive` options; a "trend" is just a line over
 * ordered labels, so there was no second component to keep.
 */
export function LineChart({
  labels,
  series,
  fill,
  stacked = false,
  progressive = false,
  height = 240,
}: LineChartProps) {
  const data = {
    labels,
    datasets: series.map((s, i) => {
      const color = colorAt(i, s.color);
      return {
        label: s.label,
        data: s.data,
        borderColor: color,
        backgroundColor: fill ? fillFor(color, fill) : color,
        fill: fill ? (stacked ? (i === 0 ? "origin" : "-1") : "origin") : false,
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        spanGaps: false,
      };
    }),
  };

  return (
    <div style={{ height }}>
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          animation: progressive ? progressiveAnimation(labels.length) : undefined,
          plugins: { legend: { display: series.length > 1, position: "bottom" } },
          scales: { y: { beginAtZero: true, stacked }, x: { stacked } },
        }}
      />
    </div>
  );
}
