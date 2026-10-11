import "./Skeleton.css";

interface SkeletonProps {
  /** Number of text lines (the last one is shorter). */
  lines?: number;
  /** Accessible loading message. */
  label?: string;
  className?: string;
}

/** Loading placeholder. Animation is disabled under `prefers-reduced-motion`. */
export function Skeleton({ lines = 3, label = "Chargement en cours", className }: SkeletonProps) {
  return (
    <div role="status" aria-busy="true" className={["gs-skeleton", className].filter(Boolean).join(" ")}>
      <span className="gs-visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="gs-skeleton-line"
          data-last={i === lines - 1 && lines > 1 ? "true" : undefined}
        />
      ))}
    </div>
  );
}
