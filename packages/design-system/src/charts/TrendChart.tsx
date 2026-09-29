import {
  CategoryScale,
  Chart,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export interface TrendSeries {
  label: string;
  /** One value per entry of `labels`; `null` leaves a gap in the line. */
  data: (number | null)[];
  /** CSS color. Falls back to the palette below when omitted. */
  color?: string;
}

export interface TrendChartProps {
  labels: string[];
  series: TrendSeries[];
  /** Pixel height of the chart area. */
  height?: number;
}

/** Derived from tokens.css; Chart.js paints on canvas and cannot read CSS custom properties. */
const PALETTE = ["#2a3fff", "#1e7a46", "#8a5a00", "#b3261e", "#5a6472"];

/**
 * Generic time-series line chart: labels on the x axis, one or more numeric
 * series. Carries no domain semantics — the caller decides what the numbers
 * mean.
 */
export function TrendChart({ labels, series, height = 240 }: TrendChartProps) {
  const data = {
    labels,
    datasets: series.map((s, i) => {
      const color = s.color ?? PALETTE[i % PALETTE.length];
      return {
        label: s.label,
        data: s.data,
        borderColor: color,
        backgroundColor: color,
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
          plugins: { legend: { display: series.length > 1, position: "bottom" } },
          scales: { y: { beginAtZero: true } },
        }}
      />
    </div>
  );
}
