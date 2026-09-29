import { Chart, Legend, LinearScale, PointElement, Tooltip } from "chart.js";
import { Bubble } from "react-chartjs-2";
import { colorAt, withAlpha } from "./shared";

Chart.register(LinearScale, PointElement, Tooltip, Legend);

export interface BubblePoint {
  x: number;
  y: number;
  /** Radius in pixels — the third dimension. */
  r: number;
  /** Shown in the tooltip in place of the raw coordinates. */
  label?: string;
}

export interface BubbleSeries {
  label: string;
  points: BubblePoint[];
  /** CSS color. Falls back to the shared palette when omitted. */
  color?: string;
}

export interface BubbleChartProps {
  series: BubbleSeries[];
  xLabel?: string;
  yLabel?: string;
  /** Pixel height of the chart area. */
  height?: number;
}

/**
 * Generic bubble chart: two numeric axes plus a radius. Carries no domain
 * semantics; the caller decides what x, y and r mean.
 */
export function BubbleChart({ series, xLabel, yLabel, height = 280 }: BubbleChartProps) {
  const data = {
    datasets: series.map((s, i) => {
      const color = colorAt(i, s.color);
      return {
        label: s.label,
        data: s.points,
        backgroundColor: withAlpha(color, 0.45),
        borderColor: color,
        borderWidth: 1,
      };
    }),
  };

  return (
    <div style={{ height }}>
      <Bubble
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: series.length > 1, position: "bottom" },
            tooltip: {
              callbacks: {
                label: (item) => {
                  const point = item.raw as BubblePoint;
                  const coords = `(${point.x}, ${point.y}, r${point.r})`;
                  return point.label ? `${point.label} ${coords}` : `${item.dataset.label} ${coords}`;
                },
              },
            },
          },
          scales: {
            x: { title: { display: Boolean(xLabel), text: xLabel ?? "" } },
            y: { title: { display: Boolean(yLabel), text: yLabel ?? "" }, beginAtZero: true },
          },
        }}
      />
    </div>
  );
}
