import { useEffect, useState } from "react";
import { Card, MessageBanner, Table, type TableColumn } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { restrictedResourcesApi, type RestrictedResource } from "../../api/visibility";
import { RiskVisibilityBadge } from "./RiskVisibility";

/**
 * q208 (DECISION-107): the restricted resources of the client, for the Risk Manager group. Display only: the server
 * decides who may read this list and what it contains.
 */
const TYPE_LABELS: Record<RestrictedResource["type"], string> = {
  RISK: "Risque",
  CONTROL: "Contrôle",
  ANOMALY: "Anomalie",
  ACTION_PLAN: "Plan d'action",
  KPI: "KPI",
};

const describe = (err: unknown) =>
  err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : "Une erreur inattendue est survenue.";

export function RestrictedResourcesPage({ token }: Readonly<{ token: string }>) {
  const [rows, setRows] = useState<RestrictedResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    restrictedResourcesApi.list(token)
      .then((r) => { if (live) setRows(r); })
      .catch((err: unknown) => { if (live) setError(describe(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  const columns: TableColumn<RestrictedResource>[] = [
    { key: "type", header: "Type", render: (r) => TYPE_LABELS[r.type] },
    { key: "label", header: "Ressource", render: (r) => r.label },
    { key: "visibility", header: "Niveau", render: (r) => <RiskVisibilityBadge visibility={r.visibility} /> },
    { key: "access", header: "Personnes nommées", render: (r) => r.accessCount },
    { key: "updated", header: "Dernière modification", render: (r) => new Date(r.updatedAt).toLocaleDateString("fr-FR") },
    { key: "change", header: "Dernier changement de visibilité", render: (r) => r.lastChange
      ? <>{new Date(r.lastChange.at).toLocaleDateString("fr-FR")}{r.lastChange.byName ? ` par ${r.lastChange.byName}` : ""}{r.lastChange.widening ? " · élargissement" : ""}<div className="muted">{r.lastChange.reason ?? "—"}</div></>
      : "—" },
  ];

  return <section className="core-page">
    <div className="core-page__heading"><div>
      <p className="core-page__eyebrow">CONFIDENTIALITÉ · 2E LIGNE</p>
      <h1>Ressources restreintes</h1>
      <p className="core-page__subtitle">Risques, contrôles, anomalies, plans d'action et KPI dont la lecture est restreinte au périmètre ou à des personnes nommées.</p>
    </div></div>
    {error && <MessageBanner tone="danger">{error}</MessageBanner>}
    <Card header={<strong>{loading ? "Chargement…" : `${rows.length} ressource(s) restreinte(s)`}</strong>}>
      <Table columns={columns} rows={rows} rowKey={(r) => `${r.type}:${r.id}`} loading={loading} emptyMessage="Aucune ressource restreinte." />
    </Card>
  </section>;
}
