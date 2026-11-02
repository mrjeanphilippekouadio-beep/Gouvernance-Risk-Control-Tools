import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { HiddenCountNotice } from "../risks/HiddenCountNotice";
import { ResourceVisibilityCard, RiskVisibilityBadge } from "../risks/RiskVisibility";
import { anomalyVisibilityApi, PERIMETER_HELP } from "../../api/visibility";
import { describeError } from "../indicators/shared";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { anomaliesApi, type Anomaly, type AnomalySeverity, type AnomalyStatus } from "../../api/anomalies";
import "../core/WorkflowPages.css";

const severityLabels: Record<AnomalySeverity, string> = { LOW: "Faible", MODERATE: "Modérée", HIGH: "Élevée", MAJOR: "Majeure", CRITICAL: "Critique" };
const statusLabels: Record<AnomalyStatus, string> = { NEW: "Nouvelle", UNDER_ANALYSIS: "En analyse", ACTION_IN_PROGRESS: "Action en cours", CLOSED: "Clôturée" };
const toneForSeverity = (value: AnomalySeverity): StatusTone => value === "CRITICAL" || value === "MAJOR" ? "danger" : value === "HIGH" ? "warning" : value === "MODERATE" ? "info" : "neutral";
const toneForStatus = (value: AnomalyStatus): StatusTone => value === "CLOSED" ? "success" : value === "ACTION_IN_PROGRESS" ? "warning" : value === "UNDER_ANALYSIS" ? "info" : "danger";
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const errorMessage = describeError;

interface Props { token: string; }

export function AnomaliesPage({ token }: Props) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | AnomalyStatus>("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<AnomalySeverity>("MODERATE");
  const [origin, setOrigin] = useState("");
  const [controlId, setControlId] = useState("");
  const [riskId, setRiskId] = useState("");
  const [controlExecutionId, setControlExecutionId] = useState("");
  const [selected, setSelected] = useState<Anomaly | null>(null);
  const [targetStatus, setTargetStatus] = useState<"" | AnomalyStatus>("");
  const [comment, setComment] = useState("");
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Refused writes also open the global PermissionDeniedDialog (api/client.ts); the error is shown inline too.
  const handleError = (err: unknown, inline: (message: string) => void) => inline(errorMessage(err));

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAnomalies(await anomaliesApi.list(token, statusFilter || undefined)); }
    catch (err) { setAnomalies([]); handleError(err, setError); }
    finally { setLoading(false); }
  }, [token, statusFilter]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      await anomaliesApi.create(token, {
        description: description.trim(), severity,
        origin: origin.trim() || null, controlId: controlId.trim() || null,
        riskId: riskId.trim() || null, controlExecutionId: controlExecutionId.trim() || null,
      });
      setDescription(""); setOrigin(""); setControlId(""); setRiskId(""); setControlExecutionId("");
      setNotice("Anomalie déclarée.");
      await refresh();
    } catch (err) { handleError(err, setError); }
    finally { setSaving(false); }
  }

  function open(row: Anomaly) { setSelected(row); setTargetStatus(""); setComment(""); setTransitionError(null); }

  async function transition() {
    if (!selected || !targetStatus) return;
    setSaving(true); setTransitionError(null);
    try {
      // The backend owns VALID_TRANSITIONS and refuses (with its own message) any invalid target.
      const updated = await anomaliesApi.updateStatus(token, selected.id, targetStatus, comment.trim() || null);
      setSelected(updated); setTargetStatus(""); setComment("");
      setNotice(`Statut mis à jour : ${statusLabels[updated.status]}.`);
      await refresh();
    } catch (err) { handleError(err, setTransitionError); }
    finally { setSaving(false); }
  }

  const columns = useMemo<TableColumn<Anomaly>[]>(() => [
    { key: "description", header: "Anomalie", render: (row) => <div className="workflow-cell-stack"><strong>{row.description}</strong>{row.origin && <small>Origine : {row.origin}</small>}</div> },
    { key: "severity", header: "Gravité", render: (row) => <StatusBadge label={severityLabels[row.severity]} tone={toneForSeverity(row.severity)} /> },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={statusLabels[row.status]} tone={toneForStatus(row.status)} /> },
    { key: "visibility", header: "Visibilité", render: (row) => <RiskVisibilityBadge visibility={row.visibility} /> },
    { key: "observed", header: "Observée le", render: (row) => dateLabel(row.observedAt) },
    { key: "actions", header: "Actions", render: (row) => <Button onClick={() => open(row)}>Ouvrir</Button> },
  ], []);

  const transitionTargets = selected ? (Object.keys(statusLabels) as AnomalyStatus[]).filter((s) => s !== selected.status) : [];

  return <section className="workflow-page">
    <header className="workflow-heading">
      <p className="workflow-eyebrow">CONTRÔLE INTERNE · ANOMALIES</p>
      <h1>Anomalies</h1>
      <p>Déclarer une anomalie et suivre son cycle de vie. Les transitions de statut sont validées par le serveur, qui est seul juge des passages autorisés.</p>
    </header>
    {error && <MessageBanner tone="danger" title="Une erreur est survenue">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    <Card header={<div><h2>Déclarer une anomalie</h2><p>Le déclarant est enregistré automatiquement par le serveur.</p></div>}>
      <form className="workflow-form" onSubmit={submit}><div className="workflow-form-grid">
        <div className="workflow-field-span"><FormField label="Description *" htmlFor="anomaly-description"><textarea id="anomaly-description" value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} /></FormField></div>
        <FormField label="Gravité *" htmlFor="anomaly-severity"><select id="anomaly-severity" value={severity} onChange={(e) => setSeverity(e.target.value as AnomalySeverity)}>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Origine" htmlFor="anomaly-origin"><input id="anomaly-origin" value={origin} onChange={(e) => setOrigin(e.target.value)} /></FormField>
        <FormField label="Contrôle concerné (ID)" htmlFor="anomaly-control" help="Facultatif. L'API vérifie l'existence."><input id="anomaly-control" value={controlId} onChange={(e) => setControlId(e.target.value)} autoComplete="off" /></FormField>
        <FormField label="Risque concerné (ID)" htmlFor="anomaly-risk" help="Facultatif. L'API vérifie l'existence."><input id="anomaly-risk" value={riskId} onChange={(e) => setRiskId(e.target.value)} autoComplete="off" /></FormField>
        <FormField label="Exécution de contrôle (ID)" htmlFor="anomaly-execution" help="Facultatif. L'API vérifie l'existence."><input id="anomaly-execution" value={controlExecutionId} onChange={(e) => setControlExecutionId(e.target.value)} autoComplete="off" /></FormField>
      </div><div className="workflow-actions"><Button variant="primary" type="submit" disabled={saving || !description.trim()}>{saving ? "Enregistrement…" : "Déclarer l'anomalie"}</Button></div></form>
    </Card>
    <Card header={<div><h2>Registre des anomalies</h2></div>} footer={<Button onClick={() => void refresh()} disabled={loading}>Actualiser</Button>}>
      <div className="workflow-filter-row">
        <FormField label="Statut" htmlFor="anomaly-filter-status"><select id="anomaly-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | AnomalyStatus)}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      </div>
      <Table columns={columns} rows={anomalies} rowKey={(row) => row.id} loading={loading} emptyMessage={statusFilter ? "Aucune anomalie ne correspond au filtre." : "Aucune anomalie enregistrée."} />
      <HiddenCountNotice token={token} type="ANOMALY" />
    </Card>
    <Modal open={!!selected} onClose={() => setSelected(null)} title="Fiche anomalie" actions={<Button onClick={() => setSelected(null)}>Fermer</Button>}>
      {selected && <div className="workflow-cell-stack">
        <strong>{selected.description}</strong>
        <div className="workflow-actions workflow-actions--compact"><StatusBadge label={severityLabels[selected.severity]} tone={toneForSeverity(selected.severity)} /><StatusBadge label={statusLabels[selected.status]} tone={toneForStatus(selected.status)} /></div>
        <small>Observée le {dateLabel(selected.observedAt)} · détectée par {selected.detectedBy}</small>
        {selected.origin && <small>Origine : {selected.origin}</small>}
        {selected.controlId && <small>Contrôle : {selected.controlId}</small>}
        {selected.riskId && <small>Risque : {selected.riskId}</small>}
        {selected.controlExecutionId && <small>Exécution : {selected.controlExecutionId}</small>}
        {selected.associatedActions && <small>Actions associées : {selected.associatedActions}</small>}
        {selected.closedAt && <small>Clôturée le {dateLabel(selected.closedAt)} — {selected.closureComment || "—"}</small>}
        <strong>Changer le statut</strong>
        {transitionError && <MessageBanner tone="danger">{transitionError}</MessageBanner>}
        <FormField label="Nouveau statut" htmlFor="anomaly-target"><select id="anomaly-target" value={targetStatus} onChange={(e) => { setTargetStatus(e.target.value as "" | AnomalyStatus); setTransitionError(null); }}><option value="">Choisir…</option>{transitionTargets.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}</select></FormField>
        <FormField label="Commentaire" htmlFor="anomaly-comment"><textarea id="anomaly-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} /></FormField>
        <div className="workflow-actions"><Button variant="primary" disabled={saving || !targetStatus} onClick={() => void transition()}>{saving ? "Enregistrement…" : "Appliquer"}</Button></div>
        <ResourceVisibilityCard token={token} resourceId={selected.id} idPrefix="anomaly-visibility" perimeterHelp={PERIMETER_HELP.ANOMALY}
          load={anomalyVisibilityApi.get} save={anomalyVisibilityApi.set} />
      </div>}
    </Modal>
  </section>;
}
