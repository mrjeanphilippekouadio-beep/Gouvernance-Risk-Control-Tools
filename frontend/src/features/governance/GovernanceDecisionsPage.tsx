import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { governanceAcceptancesApi, type AcceptanceStatus, type PrincipleAcceptance } from "../../api/governanceAcceptances";
import { usePermissions } from "../../auth/usePermissions";
import { describeError, isPermissionDenied } from "../indicators/shared";
import "../core/CorePages.css";

const STATUS: Record<AcceptanceStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: "En attente de confirmation", tone: "warning" },
  ACTIVE: { label: "En vigueur", tone: "success" },
  REJECTED: { label: "Rejetée", tone: "danger" },
  REVOKED: { label: "Retirée", tone: "neutral" },
};
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
type Action = { kind: "reject" | "revoke"; acceptance: PrincipleAcceptance };

function author(a: PrincipleAcceptance): string {
  if (a.mine) return "Vous";
  return a.acceptedBy ?? "Masqué (droit d'audit requis)";
}

/**
 * q167 (DECISION-080), lot F5a (DECISION-088): the separate « Décisions de gouvernance » page, on the D5 routes.
 * Acceptances of a principle not respected: list, confirm, reject, revoke. The server decides everything (the author
 * never confirms their own, an expired one cannot be confirmed, names are masked without audit.read).
 * The review of exceptions and creating an acceptance come with D6 (q172, principles catalogue).
 */
export function GovernanceDecisionsPage({ token }: Readonly<{ token: string }>) {
  const { can } = usePermissions(token);
  const [rows, setRows] = useState<PrincipleAcceptance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await governanceAcceptancesApi.list(token)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(call: () => Promise<unknown>, done: string) {
    setBusy(true); setActionError(null); setNotice(null);
    try {
      await call();
      setNotice(done); setAction(null);
      await refresh();
    } catch (err) {
      if (isPermissionDenied(err)) setAction(null); // the global permission dialog explains it
      else if (action) setActionError(describeError(err));
      else setError(describeError(err));
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    const why = reason.trim();
    if (action.kind === "reject") void run(() => governanceAcceptancesApi.reject(token, action.acceptance.id, why), "Acceptation rejetée.");
    else void run(() => governanceAcceptancesApi.revoke(token, action.acceptance.id, why), "Acceptation retirée : le principe redevient « non respecté ».");
  }

  const open = (kind: Action["kind"], acceptance: PrincipleAcceptance) => { setReason(""); setActionError(null); setAction({ kind, acceptance }); };
  const live = (a: PrincipleAcceptance) => a.status === "PENDING" || a.status === "ACTIVE";

  const columns: TableColumn<PrincipleAcceptance>[] = [
    { key: "principle", header: "Principe", render: (a) => <><strong>{a.principleId}</strong><div className="muted">Catalogue v{a.catalogVersion}</div></> },
    { key: "status", header: "Statut", render: (a) => <>
      <StatusBadge {...STATUS[a.status]} />
      {a.regime === "ALONE" && <> <StatusBadge label="Acceptée seul" tone="warning" /></>}
    </> },
    { key: "reason", header: "Motif", render: (a) => a.reason },
    { key: "dates", header: "Période", render: (a) => <>Du {fmtDate(a.acceptedAt)} au {fmtDate(a.expiresAt)}{a.endedAt && <div className="muted">Terminée le {fmtDate(a.endedAt)}{a.endReason ? ` : ${a.endReason}` : ""}</div>}</> },
    { key: "author", header: "Acceptée par", render: author },
    { key: "actions", header: "", render: (a) => <>
      {a.status === "PENDING" && !a.mine && can("governanceprinciple.acceptance.confirm") && <>
        <Button variant="primary" disabled={busy} onClick={() => void run(() => governanceAcceptancesApi.confirm(token, a.id), "Acceptation confirmée.")}>Confirmer</Button>{" "}
        <Button disabled={busy} onClick={() => open("reject", a)}>Rejeter</Button>{" "}
      </>}
      {live(a) && can("governanceprinciple.acceptance.revoke") && <Button variant="destructive" disabled={busy} onClick={() => open("revoke", a)}>Retirer</Button>}
    </> },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · GOUVERNANCE</p>
        <h1>Décisions de gouvernance</h1>
        <p className="core-page__subtitle">Les acceptations, pour une durée limitée, d'un principe de gouvernance non respecté. L'auteur d'une acceptation ne peut jamais la confirmer ; le serveur décide de chaque action et la trace.</p>
      </div>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    <Card header={<strong>Acceptations de principes</strong>}>
      <Table columns={columns} rows={rows} rowKey={(a) => a.id} loading={loading} emptyMessage="Aucune acceptation de principe pour l'instant." />
    </Card>
    <MessageBanner tone="info" title="Arrive avec le panel de gouvernance (D6)">
      La revue des actions appliquées sans validation indépendante et la création d'une acceptation s'appuient sur la liste des exceptions et le catalogue des principes, livrés avec D6 (décision q172).
    </MessageBanner>

    <Modal
      open={action !== null}
      onClose={() => { if (!busy) setAction(null); }}
      title={action?.kind === "reject" ? "Rejeter l'acceptation" : "Retirer l'acceptation"}
      busy={busy}
      actions={<>
        <Button onClick={() => setAction(null)} disabled={busy}>Annuler</Button>
        <Button type="submit" form="decision-form" variant="destructive" disabled={busy || !reason.trim()}>Confirmer</Button>
      </>}
    >
      {action && <form id="decision-form" onSubmit={submit}>
        {actionError && <MessageBanner tone="danger">{actionError}</MessageBanner>}
        <p>Principe {action.acceptance.principleId}{action.kind === "revoke" ? " : il redeviendra « non respecté » dès maintenant." : "."}</p>
        <FormField label="Motif (obligatoire)" htmlFor="decision-reason">
          <input id="decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>}
    </Modal>
  </section>;
}
