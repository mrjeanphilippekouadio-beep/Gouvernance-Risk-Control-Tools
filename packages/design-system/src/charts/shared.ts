import type { Chart, ChartOptions, ScriptableContext } from "chart.js";

/**
 * Derived from tokens.css (`--gs-primary`, `--gs-success`, `--gs-warning`,
 * `--gs-danger`, `--gs-neutral`). Chart.js paints on canvas and cannot read
 * CSS custom properties, so the values are duplicated here on purpose — keep
 * them in sync with tokens.css.
 */
export const PALETTE = ["#2a3fff", "#1e7a46", "#8a5a00", "#b3261e", "#5a6472"];

export const colorAt = (index: number, override?: string) =>
  override ?? PALETTE[index % PALETTE.length];

/** `#rrggbb` → `rgba(...)`. Any other notation is returned untouched. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const n = Number.parseInt(hex[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Fill styles available on area-capable charts. */
export type FillStyle = "solid" | "linear-gradient" | "radial-gradient";

/**
 * Canvas fill for one series. Gradients are scriptable because they need the
 * measured `chartArea`, which does not exist on the very first render pass —
 * a flat translucent fill is used until it does.
 */
export function fillFor(color: string, style: FillStyle) {
  if (style === "solid") return withAlpha(color, 0.25);
  return (ctx: ScriptableContext<"line">) => {
    const { ctx: canvas, chartArea } = ctx.chart;
    if (!chartArea) return withAlpha(color, 0.25);
    const { top, bottom, left, right } = chartArea;
    const gradient =
      style === "linear-gradient"
        ? canvas.createLinearGradient(0, top, 0, bottom)
        : canvas.createRadialGradient(
            (left + right) / 2,
            (top + bottom) / 2,
            0,
            (left + right) / 2,
            (top + bottom) / 2,
            Math.max(right - left, bottom - top) / 2,
          );
    gradient.addColorStop(0, withAlpha(color, 0.5));
    gradient.addColorStop(1, withAlpha(color, 0));
    return gradient;
  };
}

/** Subset of the Chart.js animation context we need, plus our own latch flags. */
interface AnimationContext {
  type: string;
  index: number;
  datasetIndex: number;
  chart: Chart;
  [flag: string]: unknown;
}

/**
 * Left-to-right "progressive line" draw — the Chart.js sample of the same name
 * (https://www.chartjs.org/docs/latest/samples/animations/progressive-line.html):
 * each point is animated from its predecessor with a delay proportional to its
 * index. The `delay` callbacks latch on the context so the delay is computed
 * once per point instead of on every animation frame.
 */
export function progressiveAnimation(pointCount: number): ChartOptions<"line">["animation"] {
  const step = 1500 / Math.max(pointCount, 1);
  const once = (flag: string) => (ctx: AnimationContext) => {
    if (ctx.type !== "data" || ctx[flag]) return 0;
    ctx[flag] = true;
    return ctx.index * step;
  };
  return {
    x: {
      type: "number" as const,
      easing: "linear" as const,
      duration: step,
      from: Number.NaN,
      delay: once("gsXStarted"),
    },
    y: {
      type: "number" as const,
      easing: "linear" as const,
      duration: step,
      from: (ctx: AnimationContext) => {
        const scale = ctx.chart.scales.y;
        if (ctx.index === 0) return scale.getPixelForValue(scale.min);
        const previous = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1];
        return previous.getProps(["y"], true).y;
      },
      delay: once("gsYStarted"),
    },
    // Per-property animation specs keyed on scale axes: valid Chart.js config
    // (the sample above is built on it) that the public option type, which only
    // describes the flat `duration`/`easing` form, does not cover.
  } as unknown as ChartOptions<"line">["animation"];
}
