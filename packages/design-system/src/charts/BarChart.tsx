import { BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from "chart.js";
import { Bar } from "react-chartjs-2";
import { colorAt } from "./shared";

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export interface BarSeries {
  label: string;
  /** One value per entry of `labels`. */
  data: (number | null)[];
  /** CSS color. Falls back to the shared palette when omitted. */
  color?: string;
}

export interface BarChartProps {
  labels: string[];
  series: BarSeries[];
  /** Sum series into a single bar per label instead of grouping them side by side. */
  stacked?: boolean;
  /** `"horizontal"` puts the labels on the y axis (Chart.js `indexAxis: "y"`). */
  orientation?: "vertical" | "horizontal";
  /** Pixel height of the chart area. */
  height?: number;
}

/**
 * Generic bar chart — grouped or stacked, vertical or horizontal. Carries no
 * domain semantics; the caller decides what the numbers mean.
 */
export function BarChart({
  labels,
  series,
  stacked = false,
  orientation = "vertical",
  height = 240,
}: BarChartProps) {
  const data = {
    labels,
    datasets: series.map((s, i) => ({
      label: s.label,
      data: s.data,
      backgroundColor: colorAt(i, s.color),
      borderRadius: 4,
      borderSkipped: false as const,
    })),
  };

  return (
    <div style={{ height }}>
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: orientation === "horizontal" ? "y" : "x",
          plugins: { legend: { display: series.length > 1, position: "bottom" } },
          scales: { x: { stacked }, y: { stacked, beginAtZero: true } },
        }}
      />
    </div>
  );
}
