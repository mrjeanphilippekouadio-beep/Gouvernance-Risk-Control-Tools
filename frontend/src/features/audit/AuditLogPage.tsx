import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, DatePicker, FormField, MessageBanner, Modal, Pagination, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { auditLogApi, type AuditAction, type AuditEvent, type AuditLogFilters } from "../../api/auditLog";
import "../core/WorkflowPages.css";

const PAGE_SIZE = 20;
// Backend caps the journal at 500 events per request (AuditLogService.MAX_LIMIT); there is no offset/total.
const FETCH_LIMIT = 500;

const actionLabels: Record<AuditAction, string> = {
  CREATE: "Création", UPDATE: "Modification", DELETE: "Suppression", SUBMIT: "Soumission", VALIDATE: "Validation",
  REJECT: "Rejet", APPROVE: "Approbation", CLOSE: "Clôture", REOPEN: "Réouverture", ASSIGN: "Attribution",
  UNASSIGN: "Retrait d'attribution", ESCALATE: "Escalade", STATUS_CHANGE: "Changement de statut",
  ROLE_CHANGE: "Changement de rôle", PERMISSION_CHANGE: "Changement de permission",
};
const toneForAction = (action: AuditAction): StatusTone =>
  action === "DELETE" || action === "REJECT" || action === "ESCALATE" ? "danger"
    : action === "ROLE_CHANGE" || action === "PERMISSION_CHANGE" || action === "CLOSE" ? "warning"
      : action === "CREATE" || action === "APPROVE" || action === "VALIDATE" ? "success" : "info";
const dateTimeLabel = (value: string) => new Date(value).toLocaleString("fr-FR");
const prettyJson = (value: unknown) => value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);
const errorMessage = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";
const startOfDay = (iso: string) => new Date(`${iso}T00:00:00`).toISOString();
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999`).toISOString();

interface Props { token: string; }
interface Form { userId: string; action: "" | AuditAction; entityType: string; entityId: string; from: string | null; to: string | null; }
const emptyForm: Form = { userId: "", action: "", entityType: "", entityId: "", from: null, to: null };

function toFilters(form: Form): AuditLogFilters {
  return {
    userId: form.userId.trim() || undefined,
    action: form.action || undefined,
    entityType: form.entityType.trim() || undefined,
    // entityId alone is ignored by the backend (falls back to "recent"), so only send it with an entityType.
    entityId: form.entityType.trim() ? form.entityId.trim() || undefined : undefined,
    from: form.from ? startOfDay(form.from) : undefined,
    to: form.to ? endOfDay(form.to) : undefined,
    limit: FETCH_LIMIT,
  };
}

/** ACT-071 — read-only audit trail. No write control exists on this screen by design (append-only journal). */
export function AuditLogPage({ token }: Props) {
  const [form, setForm] = useState<Form>(emptyForm);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtered, setFiltered] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const load = useCallback(async (next: Form) => {
    setLoading(true); setError(null);
    try {
      setEvents(await auditLogApi.list(token, toFilters(next)));
      setFiltered(Object.values(next).some((v) => v !== "" && v !== null));
      setPage(1);
    } catch (err) {
      setEvents([]);
      setError(errorMessage(err));
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(emptyForm); }, [load]);

  function submit(event: FormEvent) { event.preventDefault(); void load(form); }
  function reset() { setForm(emptyForm); void load(emptyForm); }
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const pageCount = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const rows = useMemo(() => events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [events, page]);

  const columns = useMemo<TableColumn<AuditEvent>[]>(() => [
    { key: "timestamp", header: "Date", render: (row) => dateTimeLabel(row.timestamp) },
    { key: "action", header: "Action", render: (row) => <StatusBadge label={actionLabels[row.action] ?? row.action} tone={toneForAction(row.action)} /> },
    { key: "entity", header: "Objet", render: (row) => <div className="workflow-cell-stack"><strong>{row.entityType}</strong><small>{row.entityId}</small></div> },
    { key: "user", header: "Utilisateur", render: (row) => row.userId },
    { key: "reason", header: "Motif", render: (row) => row.reason || "—" },
    { key: "detail", header: "Détail", render: (row) => <Button onClick={() => setSelected(row)}>Consulter</Button> },
  ], []);

  return <section className="workflow-page">
    <header className="workflow-heading">
      <p className="workflow-eyebrow">AUDIT · JOURNAL</p>
      <h1>Journal d'audit</h1>
      <p>Historique technique, en lecture seule, de toutes les actions effectuées dans l'application. Les événements ne peuvent être ni modifiés ni supprimés.</p>
    </header>
    {error && <MessageBanner tone="danger" title="Une erreur est survenue">{error}</MessageBanner>}
    <Card header={<div><h2>Filtres</h2><p>Les filtres sont appliqués par le serveur.</p></div>}>
      <form className="workflow-form" onSubmit={submit}>
        <div className="workflow-filter-row">
          <FormField label="Utilisateur (identifiant)" htmlFor="audit-user"><input id="audit-user" value={form.userId} onChange={(e) => set("userId", e.target.value)} autoComplete="off" /></FormField>
          <FormField label="Action" htmlFor="audit-action"><select id="audit-action" value={form.action} onChange={(e) => set("action", e.target.value as "" | AuditAction)}><option value="">Toutes les actions</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
          <FormField label="Type d'objet" htmlFor="audit-entity-type" help="Ex. Risk, Control, Anomaly."><input id="audit-entity-type" value={form.entityType} onChange={(e) => set("entityType", e.target.value)} autoComplete="off" /></FormField>
          <FormField label="Identifiant de l'objet" htmlFor="audit-entity-id" help="Nécessite un type d'objet."><input id="audit-entity-id" value={form.entityId} onChange={(e) => set("entityId", e.target.value)} disabled={!form.entityType.trim()} autoComplete="off" /></FormField>
          <DatePicker label="Du" value={form.from} onChange={(v) => set("from", v)} />
          <DatePicker label="Au" value={form.to} onChange={(v) => set("to", v)} />
        </div>
        <div className="workflow-actions"><Button onClick={reset} disabled={loading}>Réinitialiser</Button><Button variant="primary" type="submit" disabled={loading}>{loading ? "Recherche…" : "Rechercher"}</Button></div>
      </form>
    </Card>
    {events.length >= FETCH_LIMIT && <MessageBanner tone="warning">Le serveur renvoie au maximum {FETCH_LIMIT} événements, les plus récents d'abord. Affinez les filtres (dates, objet, utilisateur) pour atteindre des événements plus anciens.</MessageBanner>}
    <Card header={<div><h2>Événements</h2><p>{loading ? "Chargement…" : `${events.length} événement(s) chargé(s).`}</p></div>}>
      <Table columns={columns} rows={rows} rowKey={(row) => row.id} loading={loading} emptyMessage={filtered ? "Aucun événement ne correspond aux filtres." : "Aucun événement dans le journal."} />
      <Pagination page={page} pageCount={pageCount} onChange={setPage} ariaLabel="Pagination du journal d'audit" />
    </Card>
    <Modal open={!!selected} onClose={() => setSelected(null)} title="Détail de l'événement" actions={<Button onClick={() => setSelected(null)}>Fermer</Button>}>
      {selected && <div className="workflow-cell-stack">
        <strong>{actionLabels[selected.action] ?? selected.action} · {selected.entityType}</strong>
        <small>{dateTimeLabel(selected.timestamp)} · utilisateur {selected.userId}</small>
        <small>Objet : {selected.entityId} · requête : {selected.requestId}</small>
        <small>Motif : {selected.reason || "—"}</small>
        <strong>Valeur avant</strong><pre className="audit-json">{prettyJson(selected.oldValue)}</pre>
        <strong>Valeur après</strong><pre className="audit-json">{prettyJson(selected.newValue)}</pre>
      </div>}
    </Modal>
  </section>;
}
