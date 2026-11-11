import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { setupApi, type ModuleToggle } from "../../api/setup";
import { FormModal, dateOnly, describeError, isForbidden } from "../indicators/shared";
import { usePermissions } from "../../auth/usePermissions";
import "../core/CorePages.css";

/** Libellés d'affichage des noms de module renvoyés par le serveur ; un nom inconnu s'affiche tel quel. */
const MODULE_LABELS: Record<string, string> = {
  RISK: "Risques", CONTROL: "Contrôles", KRI: "KRI", KPI: "KPI", DASHBOARD: "Tableaux de bord", ANOMALY: "Anomalies",
  ACTION_PLAN: "Plans d'action", EVIDENCE: "Preuves", CARTOGRAPHY: "Cartographie", AUDIT: "Audit",
};

/** F8 R1 (q165, DECISION-058) : activation des modules. Le motif est obligatoire et exigé aussi par le serveur (PATCH /modules/:name/toggle). */
export function ModulesPage({ token }: { token: string }) {
  const { can } = usePermissions(token);
  const [rows, setRows] = useState<ModuleToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ModuleToggle | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await setupApi.modules(token)); } catch (err) { setError(describeError(err)); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setSaving(true); setFormError(null);
    try {
      const next = await setupApi.toggleModule(token, target.moduleName, !target.enabled, reason.trim());
      setNotice(`Module « ${MODULE_LABELS[next.moduleName] ?? next.moduleName} » ${next.enabled ? "activé" : "désactivé"}.`);
      setTarget(null);
      await refresh();
    } catch (err) {
      setFormError(describeError(err));
      if (isForbidden(err)) setTarget(null); // the global permission dialog explains it
    } finally { setSaving(false); }
  }

  const columns: TableColumn<ModuleToggle>[] = [
    { key: "name", header: "Module", render: (m) => MODULE_LABELS[m.moduleName] ?? m.moduleName },
    { key: "state", header: "État", render: (m) => <StatusBadge label={m.enabled ? "Activé" : "Désactivé"} tone={m.enabled ? "success" : "neutral"} /> },
    { key: "date", header: "Dernier changement", render: (m) => (m.id ? dateOnly(m.updatedAt) : "Jamais modifié") },
    { key: "action", header: "Action", render: (m) => (can("config.manage") ? <Button onClick={() => { setReason(""); setFormError(null); setTarget(m); }}>{m.enabled ? "Désactiver" : "Activer"}</Button> : "—") },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · MISE EN SERVICE</p>
        <h1>Activation des modules</h1>
        <p className="core-page__subtitle">Un module désactivé est refusé par le serveur pour tous les utilisateurs. Chaque changement exige un motif et est tracé (avant / après).</p>
      </div>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success" title="Changement appliqué">{notice}</MessageBanner>}
    <Card header={<strong>Modules</strong>}>
      <Table columns={columns} rows={rows} rowKey={(m) => m.moduleName} loading={loading} emptyMessage="Aucun module renvoyé par le serveur." />
    </Card>
    <FormModal open={target !== null} onClose={() => { if (!saving) setTarget(null); }} title={target ? `${target.enabled ? "Désactiver" : "Activer"} : ${MODULE_LABELS[target.moduleName] ?? target.moduleName}` : ""} formId="module-toggle-form" saving={saving} submitLabel="Confirmer">
      <form id="module-toggle-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Motif (obligatoire)" htmlFor="module-reason">
          <input id="module-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>
    </FormModal>
  </section>;
}
