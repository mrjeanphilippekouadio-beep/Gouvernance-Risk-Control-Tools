import type { NextFunction, Request, Response } from "express";
import { canonicalId, uuidHex } from "../../domain/ids.js";

/**
 * SEC-ID-01: every uuid-looking value of the path, query and JSON body is rewritten to its canonical
 * form before routing, so no service compares a client spelling (upper case, no hyphens, braces) of
 * an id with a canonical one read from the database. Strings that are not uuids are left untouched.
 */
const canon = (v: string): string => (uuidHex(v.trim()) ? canonicalId(v) : v);

function canonBody(v: unknown): unknown {
  if (typeof v === "string") return canon(v);
  if (Array.isArray(v)) return v.map(canonBody);
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = canonBody(x);
  }
  return v;
}

export function canonicalIdsMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const q = req.url.indexOf("?");
  const path = q === -1 ? req.url : req.url.slice(0, q);
  // Percent-encoded hex digits, hyphens or braces would be decoded only after this rewrite.
  const segments = path.split("/").map((seg) => {
    const decoded = seg.replace(/%(3[0-9]|4[1-6]|6[1-6]|2d|7b|7d)/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    return uuidHex(decoded) ? canonicalId(decoded) : seg;
  });
  let url = segments.join("/");
  if (q !== -1) {
    const query = req.url.slice(q + 1);
    const pairs = [...new URLSearchParams(query)];
    // Rebuilt only when an id changes, keeping repeated keys and the original encoding otherwise.
    url += pairs.some(([, v]) => uuidHex(v.trim()) && canonicalId(v) !== v)
      ? `?${new URLSearchParams(pairs.map(([k, v]) => [k, canon(v)])).toString()}`
      : `?${query}`;
  }
  req.url = url;
  if (req.body !== undefined) req.body = canonBody(req.body);
  next();
}
