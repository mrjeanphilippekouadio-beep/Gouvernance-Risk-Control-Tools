import { ArcElement, Chart, Legend, Tooltip } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { colorAt } from "./shared";

Chart.register(ArcElement, Tooltip, Legend);

export interface DoughnutSegment {
  label: string;
  value: number;
  /** CSS color. Falls back to the shared palette when omitted. */
  color?: string;
}

export interface DoughnutChartProps {
  segments: DoughnutSegment[];
  /** Size of the hole, as a percentage string. `"0%"` gives a pie chart. */
  cutout?: string;
  /** Pixel height of the chart area. */
  height?: number;
}

/**
 * Generic doughnut (or pie, with `cutout="0%"`) chart over a flat list of
 * labelled values. Carries no domain semantics.
 */
export function DoughnutChart({ segments, cutout = "60%", height = 240 }: DoughnutChartProps) {
  const data = {
    labels: segments.map((s) => s.label),
    datasets: [
      {
        data: segments.map((s) => s.value),
        backgroundColor: segments.map((s, i) => colorAt(i, s.color)),
        borderColor: "#ffffff",
        borderWidth: 2,
      },
    ],
  };

  return (
    <div style={{ height }}>
      <Doughnut
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          cutout,
          plugins: { legend: { position: "bottom" } },
        }}
      />
    </div>
  );
}
