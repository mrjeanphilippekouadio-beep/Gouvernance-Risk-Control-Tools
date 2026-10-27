import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, DatePicker, FormField, MessageBanner, Modal, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { auditMissionsApi, type AuditMission, type AuditMissionStatus } from "../../api/audit";
import { usersApi, type DirectoryEntry } from "../../api/users";
import { usePermissions } from "../../auth/usePermissions";
import { accountName } from "../../design-system";
import { describeError, isPermissionDenied } from "../indicators/shared";
import "../core/CorePages.css";

const STATUS: Record<AuditMissionStatus, { label: string; tone: StatusTone }> = {
  PLANIFIEE: { label: "Planifiée", tone: "info" },
  EN_COURS: { label: "En cours", tone: "warning" },
  CLOTUREE: { label: "Clôturée", tone: "success" },
};
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const EMPTY = { reference: "", title: "", scope: "", leadAuditorId: "", auditorIds: [] as string[], plannedStartDate: null as string | null, plannedEndDate: null as string | null };

/**
 * Lot F7-S2 (DECISION-093): audit missions — list, create, start, close (mandatory comment). Transitions
 * (PLANIFIEE → EN_COURS → CLOTUREE), dates and auditor accounts are checked by the server; buttons only hide.
 */
export function AuditMissionsPage({ token }: Readonly<{ token: string }>) {
  const { can, loaded } = usePermissions(token);
  const [rows, setRows] = useState<AuditMission[]>([]);
  const [status, setStatus] = useState<AuditMissionStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<DirectoryEntry[]>([]);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [closing, setClosing] = useState<AuditMission | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await auditMissionsApi.list(token, status || undefined)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }, [token, status]);
  useEffect(() => { void refresh(); }, [refresh]);

  // Account names: the directory when the caller may read it (same rights as the server), otherwise their own account.
  const canDirectory = can("user.read") || can("process.responsibility.assign") || can("designation.manage");
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    const load = canDirectory
      ? usersApi.directory(token)
      : usersApi.me(token).then((me) => [{ id: me.id, displayName: me.displayName }]);
    load.then((list) => { if (live) setAccounts(list); }).catch(() => undefined);
    return () => { live = false; };
  }, [token, loaded, canDirectory]);

  async function act(call: () => Promise<unknown>, done: string, onDone?: () => void) {
    setBusy(true); setFormError(null); setNotice(null);
    try {
      await call();
      setNotice(done); onDone?.();
      await refresh();
    } catch (err) {
      if (isPermissionDenied(err)) onDone?.(); // the global permission dialog explains it
      else setFormError(describeError(err));
    } finally { setBusy(false); }
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const input = {
      reference: form.reference.trim(), title: form.title.trim(), scope: form.scope.trim(), leadAuditorId: form.leadAuditorId,
      auditorIds: form.auditorIds.filter((id) => id !== form.leadAuditorId),
      plannedStartDate: form.plannedStartDate ?? "", plannedEndDate: form.plannedEndDate ?? "",
    };
    void act(() => auditMissionsApi.create(token, input), `Mission ${input.reference} créée.`, () => setCreating(false));
  }

  function submitClose(event: FormEvent) {
    event.preventDefault();
    if (!closing) return;
    void act(() => auditMissionsApi.close(token, closing.id, comment.trim()), `Mission ${closing.reference} clôturée.`, () => setClosing(null));
  }

  const toggleAuditor = (id: string) =>
    setForm({ ...form, auditorIds: form.auditorIds.includes(id) ? form.auditorIds.filter((x) => x !== id) : [...form.auditorIds, id] });

  const columns: TableColumn<AuditMission>[] = [
    { key: "ref", header: "Mission", render: (m) => <><strong>{m.reference}</strong><div>{m.title}</div><div className="muted">{m.scope}</div></> },
    { key: "status", header: "Statut", render: (m) => <StatusBadge {...STATUS[m.status]} /> },
    { key: "planned", header: "Prévue", render: (m) => `${fmtDate(m.plannedStartDate)} → ${fmtDate(m.plannedEndDate)}` },
    { key: "actual", header: "Réelle", render: (m) => (m.actualStartDate ? `${fmtDate(m.actualStartDate)} → ${fmtDate(m.actualEndDate)}` : "—") },
    { key: "team", header: "Équipe", render: (m) => <>{accountName(accounts, m.leadAuditorId)} (responsable){m.auditorIds.length > 0 && <div className="muted">{m.auditorIds.map((id) => accountName(accounts, id)).join(", ")}</div>}</> },
    { key: "actions", header: "", render: (m) => <>
      {m.status === "PLANIFIEE" && can("audit.mission.update") && <Button disabled={busy} onClick={() => void act(() => auditMissionsApi.start(token, m.id), `Mission ${m.reference} démarrée.`)}>Démarrer</Button>}
      {m.status === "EN_COURS" && can("audit.mission.close") && <Button variant="destructive" disabled={busy} onClick={() => { setComment(""); setFormError(null); setClosing(m); }}>Clôturer</Button>}
      {m.status === "CLOTUREE" && m.closureComment && <span className="muted">{m.closureComment}</span>}
    </> },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">AUDIT</p>
        <h1>Missions d'audit</h1>
        <p className="core-page__subtitle">Planifier, démarrer et clôturer une mission. Les dates réelles sont posées par le serveur ; la clôture exige un commentaire.</p>
      </div>
      {can("audit.mission.create") && <Button variant="primary" onClick={() => { setForm(EMPTY); setFormError(null); setCreating(true); }}>Nouvelle mission</Button>}
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    {formError && !creating && !closing && <MessageBanner tone="danger" title="Action refusée par le serveur">{formError}</MessageBanner>}
    <Card header={<><strong>Missions</strong> <label className="core-filter">Statut{" "}
      <select value={status} onChange={(e) => setStatus(e.target.value as AuditMissionStatus | "")}>
        <option value="">Tous</option>
        {(Object.keys(STATUS) as AuditMissionStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
      </select></label></>}>
      <Table columns={columns} rows={rows} rowKey={(m) => m.id} loading={loading} emptyMessage="Aucune mission d'audit." />
    </Card>

    <Modal open={creating} onClose={() => { if (!busy) setCreating(false); }} title="Nouvelle mission d'audit" busy={busy} actions={<>
      <Button onClick={() => setCreating(false)} disabled={busy}>Annuler</Button>
      <Button type="submit" form="mission-form" variant="primary"
        disabled={busy || !form.reference.trim() || !form.title.trim() || !form.scope.trim() || !form.leadAuditorId || !form.plannedStartDate || !form.plannedEndDate}>Créer</Button>
    </>}>
      <form id="mission-form" onSubmit={submitCreate}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Référence *" htmlFor="m-ref" help="Par exemple AUD-2026-014."><input id="m-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} required /></FormField>
        <FormField label="Titre *" htmlFor="m-title"><input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></FormField>
        <FormField label="Périmètre *" htmlFor="m-scope"><textarea id="m-scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} required /></FormField>
        <FormField label="Responsable de la mission *" htmlFor="m-lead">
          <select id="m-lead" value={form.leadAuditorId} onChange={(e) => setForm({ ...form, leadAuditorId: e.target.value })} required>
            <option value="">Sélectionner…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
          </select>
        </FormField>
        {accounts.length > 1 && <fieldset className="core-fieldset">
          <legend>Autres auditeurs</legend>
          {accounts.filter((a) => a.id !== form.leadAuditorId).map((a) => <label key={a.id} className="core-filter">
            <input type="checkbox" checked={form.auditorIds.includes(a.id)} onChange={() => toggleAuditor(a.id)} /> {a.displayName}
          </label>)}
        </fieldset>}
        <DatePicker label="Début prévu *" value={form.plannedStartDate} onChange={(v) => setForm({ ...form, plannedStartDate: v })} />
        <DatePicker label="Fin prévue *" value={form.plannedEndDate} onChange={(v) => setForm({ ...form, plannedEndDate: v })} />
      </form>
    </Modal>

    <Modal open={closing !== null} onClose={() => { if (!busy) setClosing(null); }} title="Clôturer la mission" busy={busy} actions={<>
      <Button onClick={() => setClosing(null)} disabled={busy}>Annuler</Button>
      <Button type="submit" form="mission-close-form" variant="destructive" disabled={busy || !comment.trim()}>Clôturer</Button>
    </>}>
      {closing && <form id="mission-close-form" onSubmit={submitClose}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <p>{closing.reference} · {closing.title}</p>
        <FormField label="Commentaire de clôture (obligatoire)" htmlFor="m-close"><textarea id="m-close" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} required /></FormField>
      </form>}
    </Modal>
  </section>;
}
