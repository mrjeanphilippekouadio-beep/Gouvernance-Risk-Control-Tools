import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { processesApi, type EvaluationMode, type Process } from "../../api/processes";
import { evaluationModeRequestsApi, type EvaluationModeRequest, type EvaluationModeRequestStatus } from "../../api/evaluationModeRequests";
import { useGovernanceConfirm } from "../../design-system/GovernanceConfirm";
import { WithoutReviewBadge } from "../../design-system/WithoutReviewBadge";
import { describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

const MODE_LABELS: Record<EvaluationMode, string> = { CLASSIQUE: "Classique", PARTICIPATIF: "Participatif" };
const STATUS: Record<EvaluationModeRequestStatus, { label: string; tone: StatusTone }> = {
  PENDING_VALIDATION: { label: "En attente de validation", tone: "warning" },
  VALIDATED: { label: "Validée", tone: "success" },
  REJECTED: { label: "Rejetée", tone: "danger" },
};
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export function EvaluationModeRequestsPage({ token }: { token: string }) {
  const gov = useGovernanceConfirm();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processId, setProcessId] = useState("");
  const [rows, setRows] = useState<EvaluationModeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [proposing, setProposing] = useState(false);
  const [requestedMode, setRequestedMode] = useState<EvaluationMode>("PARTICIPATIF");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<EvaluationModeRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const process = processes.find((p) => p.id === processId) ?? null;

  useEffect(() => {
    processesApi.list(token).then(setProcesses).catch((err) => setError(describeError(err)));
  }, [token]);

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    if (!processId) { setRows([]); return; }
    const id = ++latest.current;
    setLoading(true); setError(null);
    try {
      const data = await evaluationModeRequestsApi.listForProcess(token, processId);
      if (id === latest.current) setRows(data);
    } catch (err) { if (id === latest.current) { setRows([]); setError(describeError(err)); } }
    finally { if (id === latest.current) setLoading(false); }
  }, [token, processId]);

  useEffect(() => { setNotice(null); setActionError(null); void refresh(); }, [refresh]);

  async function propose(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setFormError(null);
    try {
      await evaluationModeRequestsApi.propose(token, processId, requestedMode);
      setProposing(false);
      setNotice("Demande créée : elle doit être validée par une autre personne habilitée.");
      await refresh();
    } catch (err) { setFormError(describeError(err)); if (isForbidden(err)) setProposing(false); }
    finally { setSaving(false); }
  }

  async function validate(request: EvaluationModeRequest) {
    setBusyId(request.id); setActionError(null); setNotice(null);
    try {
      await gov.run((confirmation) => evaluationModeRequestsApi.validate(token, request.id, confirmation));
      setNotice(`Demande validée : le mode « ${MODE_LABELS[request.requestedMode]} » est appliqué au processus.`);
      // The process row carries the mode in force: reload it as the server now holds it.
      processesApi.list(token).then(setProcesses).catch(() => undefined);
    } catch (err) { setActionError(describeError(err)); }
    finally { setBusyId(null); await refresh(); }
  }

  async function reject(event: FormEvent) {
    event.preventDefault();
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id); setActionError(null);
    try {
      await evaluationModeRequestsApi.reject(token, rejectTarget.id, rejectReason.trim());
      setRejectTarget(null); setRejectReason("");
      setNotice("Demande rejetée.");
    } catch (err) { setActionError(describeError(err)); if (isForbidden(err)) setRejectTarget(null); }
    finally { setBusyId(null); await refresh(); }
  }

  const columns: TableColumn<EvaluationModeRequest>[] = [
    { key: "mode", header: "Mode demandé", render: (r) => MODE_LABELS[r.requestedMode] ?? r.requestedMode },
    { key: "status", header: "Statut", render: (r) => <>
      <StatusBadge label={STATUS[r.status]?.label ?? r.status} tone={STATUS[r.status]?.tone ?? "neutral"} /> <WithoutReviewBadge value={r.validationIndependence} />
    </> },
    { key: "by", header: "Demandeur", render: (r) => `${r.requestedBy} · ${fmtDate(r.requestedAt)}` },
    { key: "decision", header: "Décision", render: (r) => r.status === "PENDING_VALIDATION" ? "—" : <>{r.validatedBy ? `${r.validatedBy} · ${fmtDate(r.validatedAt)}` : fmtDate(r.validatedAt)}{r.rejectionReason && <div className="muted">Motif : {r.rejectionReason}</div>}</> },
    { key: "actions", header: "", render: (r) => r.status === "PENDING_VALIDATION" ? <>
      <Button variant="primary" disabled={busyId !== null} onClick={() => void validate(r)} aria-label={`Valider la demande ${MODE_LABELS[r.requestedMode]}`}>{busyId === r.id ? "Envoi…" : "Valider"}</Button>{" "}
      <Button disabled={busyId !== null} onClick={() => { setRejectReason(""); setRejectTarget(r); }} aria-label={`Rejeter la demande ${MODE_LABELS[r.requestedMode]}`}>Rejeter</Button>
    </> : null },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · GOUVERNANCE</p>
        <h1>Demandes de mode d'évaluation</h1>
        <p className="core-page__subtitle">Le mode d'un processus ne change que par une demande validée par une autre personne. Le serveur décide qui peut proposer, valider ou rejeter.</p>
      </div>
      <Button variant="primary" disabled={!processId} onClick={() => { setFormError(null); setProposing(true); }}>Proposer un mode</Button>
    </div>
    <FormField label="Processus" htmlFor="emr-process">
      <select id="emr-process" value={processId} onChange={(e) => setProcessId(e.target.value)}>
        <option value="">Sélectionner un processus…</option>
        {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </FormField>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    {actionError && <MessageBanner tone="danger" title="Action refusée">{actionError}</MessageBanner>}
    {process && <p className="muted">Mode enregistré sur ce processus : {process.evaluationMode ? MODE_LABELS[process.evaluationMode] : "hérité (non défini sur ce processus)"}</p>}
    <Card header={<strong>Demandes du processus</strong>}>
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={loading} caption="Demandes de mode d'évaluation"
        emptyMessage={processId ? "Aucune demande pour ce processus." : "Sélectionnez un processus pour voir ses demandes."} />
    </Card>

    <Modal
      open={proposing}
      onClose={() => { if (!saving) setProposing(false); }}
      title="Proposer un mode d'évaluation"
      busy={saving}
      actions={<>
        <Button onClick={() => setProposing(false)} disabled={saving}>Annuler</Button>
        <Button type="submit" form="emr-form" variant="primary" disabled={saving}>{saving ? "Envoi…" : "Envoyer la demande"}</Button>
      </>}
    >
      {proposing && <form id="emr-form" onSubmit={propose}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Mode demandé" htmlFor="emr-mode">
          <select id="emr-mode" value={requestedMode} onChange={(e) => setRequestedMode(e.target.value as EvaluationMode)}>
            {(Object.keys(MODE_LABELS) as EvaluationMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </FormField>
      </form>}
    </Modal>

    <Modal
      open={rejectTarget !== null}
      onClose={() => { if (busyId === null) setRejectTarget(null); }}
      title="Rejeter la demande"
      busy={busyId !== null}
      actions={<>
        <Button onClick={() => setRejectTarget(null)} disabled={busyId !== null}>Annuler</Button>
        <Button type="submit" form="emr-reject-form" variant="destructive" disabled={busyId !== null || !rejectReason.trim()}>{busyId ? "Envoi…" : "Rejeter"}</Button>
      </>}
    >
      {rejectTarget && <form id="emr-reject-form" onSubmit={reject}>
        <FormField label="Motif du rejet (obligatoire)" htmlFor="emr-reject-reason">
          <textarea id="emr-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} required />
        </FormField>
      </form>}
    </Modal>
    {gov.dialog}
  </section>;
}
