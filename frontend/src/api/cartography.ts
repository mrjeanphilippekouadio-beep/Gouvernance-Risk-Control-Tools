import { apiRequest } from "./client";

export interface CartographyBand {
  label: string;
  min: number;
  max: number;
}

export interface CartographyScale {
  scaleId: string;
  name: string;
  version: number;
  size: number | null;
  probabilityLevels: number;
  impactLevels: number;
  maxScore: number;
  /** Triées par score croissant. */
  bands: CartographyBand[];
  bandsSource: "CONFIGURED" | "DEFAULT";
}

export const cartographyApi = {
  /** `null` tant qu'aucune échelle de cotation n'est active. */
  getScale: (token: string) =>
    apiRequest<CartographyScale | null>("/api/v1/cartography/scale", { token }),
};
