import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { setupApi, type DeploymentMode, type Tenant } from "../../api/setup";
import { FormModal, dateOnly, describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

const MODE_LABELS: Record<DeploymentMode, string> = { managed_saas: "SaaS géré", customer_managed: "Géré par le client", on_premise: "Sur site" };

/**

 * NON EXPOSÉ avant q260 / SEC-F8-01 : retiré de la navigation et des routes (App.tsx), composant conservé isolé.
 * F8 R1 (q165) : clients (tenants). Réservé au super-administrateur côté serveur (config.manage).
 * Pas de désactivation ici : le serveur l'accepte sans motif (écart signalé), l'écran ne l'expose pas.
 */
export function ClientsPage({ token }: { token: string }) {
  const [rows, setRows] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tenant | "new" | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<DeploymentMode>("managed_saas");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await setupApi.tenants(token)); } catch (err) { setError(describeError(err)); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  function open(target: Tenant | "new") {
    setName(target === "new" ? "" : target.name);
    setMode(target === "new" ? "managed_saas" : target.deploymentMode);
    setFormError(null);
    setEditing(target);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setFormError(null);
    try {
      if (editing === "new") await setupApi.createTenant(token, { name: name.trim(), deploymentMode: mode });
      else await setupApi.updateTenant(token, editing.id, { name: name.trim(), deploymentMode: mode });
      setNotice(editing === "new" ? "Client créé." : "Client modifié.");
      setEditing(null);
      await refresh();
    } catch (err) {
      setFormError(describeError(err));
      if (isForbidden(err)) setEditing(null);
    } finally { setSaving(false); }
  }

  const columns: TableColumn<Tenant>[] = [
    { key: "name", header: "Client", render: (t) => t.name },
    { key: "mode", header: "Déploiement", render: (t) => MODE_LABELS[t.deploymentMode] ?? t.deploymentMode },
    { key: "active", header: "État", render: (t) => <StatusBadge label={t.active ? "Actif" : "Inactif"} tone={t.active ? "success" : "neutral"} /> },
    { key: "created", header: "Créé le", render: (t) => dateOnly(t.createdAt) },
    { key: "action", header: "Action", render: (t) => <Button onClick={() => open(t)}>Modifier</Button> },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · MISE EN SERVICE</p>
        <h1>Clients</h1>
        <p className="core-page__subtitle">Liste des clients (tenants) de la plateforme. Réservé au super-administrateur : le serveur refuse tout autre compte.</p>
      </div>
      <Button variant="primary" onClick={() => open("new")}>Nouveau client</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success" title="Changement appliqué">{notice}</MessageBanner>}
    <Card header={<strong>Clients</strong>}>
      <Table columns={columns} rows={rows} rowKey={(t) => t.id} loading={loading} emptyMessage="Aucun client enregistré." />
    </Card>
    <FormModal open={editing !== null} onClose={() => { if (!saving) setEditing(null); }} title={editing === "new" ? "Nouveau client" : "Modifier le client"} formId="client-form" saving={saving} submitLabel="Enregistrer">
      <form id="client-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Nom du client" htmlFor="client-name">
          <input id="client-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </FormField>
        <FormField label="Mode de déploiement" htmlFor="client-mode">
          <select id="client-mode" value={mode} onChange={(e) => setMode(e.target.value as DeploymentMode)}>
            {(Object.keys(MODE_LABELS) as DeploymentMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </FormField>
      </form>
    </FormModal>
  </section>;
}
