import { useEffect, useState } from "react";
import { hiddenCountsApi, type RestrictedResource } from "../../api/visibility";

/**
 * V3 (q196, q198): « X éléments non visibles » under a list. One number per type over the whole client, computed by the
 * server, never broken down, never linked; nothing shown at 0, on error, or for the groups that see everything.
 */
export function HiddenCountNotice({ token, type }: Readonly<{ token: string; type: RestrictedResource["type"] }>) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    hiddenCountsApi.get(token)
      .then((c) => { if (live) setCount(c?.[type] ?? 0); })
      .catch(() => { if (live) setCount(0); });
    return () => { live = false; };
  }, [token, type]);
  if (count <= 0) return null;
  return <p className="muted" role="note">{count} élément{count > 1 ? "s" : ""} non visible{count > 1 ? "s" : ""} (accès restreint).</p>;
}
