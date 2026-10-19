import { StatusBadge } from "@djamo/design-system";
import type { ValidationIndependence } from "../api/client";

/** Display only (q142): renders nothing unless the server says the act was applied without independent validation. */
export function WithoutReviewBadge({ value }: { value?: ValidationIndependence }) {
  return value === "WITHOUT_INDEPENDENT_REVIEW" ? <StatusBadge label="Appliqué sans validation indépendante" tone="warning" /> : null;
}
