import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, DatePicker, FormField, MessageBanner, Modal, StatusBadge } from "@djamo/design-system";
import { governanceDesignationsApi, type DesignationKind, type GovernanceDesignation } from "../../api/governanceDesignations";
import { usersApi, type DirectoryEntry } from "../../api/users";
import { AccountPicker, accountName } from "../../design-system";
import { describeError, isPermissionDenied } from "../indicators/shared";
import "../core/CorePages.css";

const KINDS: { kind: DesignationKind; title: string; text: string }[] = [
  { kind: "MANAGER", title: "Gérant désigné", text: "La personne qui dirige l'organisation, au sens des principes de gouvernance." },
  { kind: "RISK_MANAGER_INTERIM", title: "Intérimaire du Risk Manager", text: "Reprend le rôle si le dernier Risk Manager part. Date de fin obligatoire ; rien n'est retiré automatiquement à cette date." },
];
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** O13 (D2c): the two designation slots. All rules (no self-designation, active account, interim end date) are the server's. */
export function DesignationsPage({ token }: Readonly<{ token: string }>) {
  const [rows, setRows] = useState<GovernanceDesignation[]>([]);
  const [includeEnded, setIncludeEnded] = useState(false);
  const [accounts, setAccounts] = useState<DirectoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [designating, setDesignating] = useState<DesignationKind | null>(null);
  const [userId, setUserId] = useState("");
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [ending, setEnding] = useState<GovernanceDesignation | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try { setRows(await governanceDesignationsApi.list(token, includeEnded)); }
    catch (err) { setError(describeError(err)); }
  }, [token, includeEnded]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { usersApi.directory(token).then(setAccounts).catch(() => setAccounts([])); }, [token]);

  function close() { if (!saving) { setDesignating(null); setEnding(null); } }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setFormError(null);
    try {
      if (designating) {
        await governanceDesignationsApi.designate(token, { kind: designating, userId, reason: reason.trim(), validUntil });
        setNotice("Désignation enregistrée.");
      } else if (ending) {
        await governanceDesignationsApi.end(token, ending.id, reason.trim());
        setNotice("Désignation terminée.");
      }
      setDesignating(null); setEnding(null);
      await refresh();
    } catch (err) {
      setFormError(describeError(err));
      if (isPermissionDenied(err)) { setDesignating(null); setEnding(null); }
    } finally { setSaving(false); }
  }

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · GOUVERNANCE</p>
        <h1>Désignations</h1>
        <p className="core-page__subtitle">Deux emplacements, une personne active chacun. Chaque désignation et chaque fin exigent un motif et sont tracées. Personne ne se désigne soi-même : le serveur refuse.</p>
      </div>
      <label className="core-filter"><input type="checkbox" checked={includeEnded} onChange={(e) => setIncludeEnded(e.target.checked)} /> Afficher les désignations terminées</label>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}

    {KINDS.map(({ kind, title, text }) => {
      const active = rows.find((r) => r.kind === kind && !r.endedAt) ?? null;
      const past = rows.filter((r) => r.kind === kind && r.endedAt);
      return <Card
        key={kind}
        header={<><strong>{title}</strong> <StatusBadge label={active ? "Pourvu" : "Vacant"} tone={active ? "success" : "neutral"} /></>}
        footer={active
          ? <Button variant="destructive" onClick={() => { setReason(""); setFormError(null); setEnding(active); }}>Mettre fin</Button>
          : <Button variant="primary" onClick={() => { setUserId(""); setValidUntil(null); setReason(""); setFormError(null); setDesignating(kind); }}>Désigner</Button>}
      >
        <p className="muted">{text}</p>
        {active && <p>{accountName(accounts, active.userId)} · depuis le {fmtDate(active.createdAt)}{active.validUntil ? ` · fin prévue le ${fmtDate(active.validUntil)}` : ""}{active.activatedAt ? ` · rôle repris le ${fmtDate(active.activatedAt)}` : ""} · Motif : {active.reason}</p>}
        {past.length > 0 && <ul className="muted">{past.map((p) => <li key={p.id}>{accountName(accounts, p.userId)} · du {fmtDate(p.createdAt)} au {fmtDate(p.endedAt)}</li>)}</ul>}
      </Card>;
    })}

    <Modal
      open={designating !== null || ending !== null}
      onClose={close}
      title={designating ? `Désigner : ${KINDS.find((k) => k.kind === designating)?.title ?? ""}` : "Mettre fin à la désignation"}
      busy={saving}
      actions={<>
        <Button onClick={close} disabled={saving}>Annuler</Button>
        <Button type="submit" form="designation-form" variant={ending ? "destructive" : "primary"} disabled={saving || !reason.trim() || (designating !== null && !userId)}>{saving ? "Envoi…" : "Confirmer"}</Button>
      </>}
    >
      <form id="designation-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        {designating && <>
          <AccountPicker id="designation-user" label="Compte désigné *" value={userId} onChange={setUserId} accounts={accounts} allowEmpty={false} />
          <DatePicker label={designating === "RISK_MANAGER_INTERIM" ? "Date de fin *" : "Date de fin (facultative)"} value={validUntil} onChange={setValidUntil} />
        </>}
        {ending && <p>{accountName(accounts, ending.userId)} : la désignation prend fin maintenant.</p>}
        <FormField label="Motif (obligatoire)" htmlFor="designation-reason">
          <input id="designation-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>
    </Modal>
  </section>;
}
