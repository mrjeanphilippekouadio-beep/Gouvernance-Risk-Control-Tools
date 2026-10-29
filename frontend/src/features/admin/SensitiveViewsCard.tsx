import { useCallback, useEffect, useState } from "react";
import { Button, Card, MessageBanner, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { rolesApi, type MatrixAccount, type SensitiveViewGrant } from "../../api/roles";
import { ApiError } from "../../api/client";
import { describeError } from "../indicators/shared";

/** QA-RL-04: refusals in French, never the server's English key. */
function describeRefusal(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Action refusée : seul un administrateur demande ou retire une vue élargie, et ni l'auteur ni le bénéficiaire ne peut la confirmer ou la refuser.";
    if (err.status === 409) return "Cette demande a déjà été traitée ou a expiré, ou une demande est déjà en cours pour ce compte.";
    if (err.status === 404) return "Demande ou compte introuvable.";
    if (err.status === 400) return "Demande invalide : un motif est obligatoire, et le bénéficiaire doit être membre du groupe Risk Manager.";
  }
  return describeError(err);
}

const STATUS: Record<SensitiveViewGrant["status"], { label: string; tone: StatusTone }> = {
  PENDING: { label: "En attente de confirmation", tone: "warning" },
  APPROVED: { label: "Active", tone: "success" },
  REJECTED: { label: "Refusée", tone: "neutral" },
  REVOKED: { label: "Retirée", tone: "neutral" },
};

/**
 * q200 (DECISION-103): a Risk Manager member's widened view of the rights matrix (Audit and administrators).
 * An administrator asks (reason), a Committee or Audit member confirms or refuses (never the author nor the
 * beneficiary: the server refuses), an administrator withdraws it. Every rule is the server's; buttons only hide.
 */
export function SensitiveViewsCard({ token, canRequest, canDecide }: Readonly<{ token: string; canRequest: boolean; canDecide: boolean }>) {
  const [grants, setGrants] = useState<SensitiveViewGrant[]>([]);
  const [accounts, setAccounts] = useState<MatrixAccount[]>([]);
  const [candidates, setCandidates] = useState<Array<{ id: string; displayName: string }>>([]);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const nameOf = (id: string) => (accounts.find((a) => a.id === id) ?? candidates.find((a) => a.id === id))?.displayName ?? "Compte non consultable";

  const load = useCallback(async () => {
    try { setGrants(await rolesApi.sensitiveViews(token)); } catch (err) { setError(describeRefusal(err)); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  // Names only (role.read); a confirmer without it still sees the requests, with neutral names.
  useEffect(() => { rolesApi.accounts(token).then(setAccounts).catch(() => setAccounts([])); }, [token]);
  // QA-RL-04: the beneficiaries come from the server (active Risk Manager members).
  useEffect(() => { if (canRequest) rolesApi.sensitiveViewCandidates(token).then(setCandidates).catch(() => setCandidates([])); }, [token, canRequest]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); setReason(""); await load(); } catch (err) { setError(describeRefusal(err)); } finally { setBusy(false); }
  }

  const columns: TableColumn<SensitiveViewGrant>[] = [
    { key: "user", header: "Membre du Risk Manager", render: (g) => nameOf(g.userId) },
    { key: "status", header: "État", render: (g) => <StatusBadge label={STATUS[g.status].label} tone={STATUS[g.status].tone} /> },
    { key: "reason", header: "Motif", render: (g) => g.revokeReason ?? g.decisionReason ?? g.reason },
    { key: "actions", header: "Actions", render: (g) => <>
      {canDecide && g.status === "PENDING" && <>
        <Button disabled={busy} onClick={() => run(() => rolesApi.decideSensitiveView(token, g.id, true, reason.trim()))}>Confirmer</Button>{" "}
        <Button disabled={busy || !reason.trim()} variant="destructive" onClick={() => run(() => rolesApi.decideSensitiveView(token, g.id, false, reason.trim()))}>Refuser</Button>{" "}
      </>}
      {canRequest && (g.status === "PENDING" || g.status === "APPROVED") &&
        <Button disabled={busy || !reason.trim()} variant="destructive" onClick={() => run(() => rolesApi.revokeSensitiveView(token, g.id, reason.trim()))}>Retirer</Button>}
    </> },
  ];

  return <Card>
    <h2>Vue élargie du Risk Manager</h2>
    <p className="muted">Par défaut, le Risk Manager voit les rôles et comptes de 1re et 2e ligne. Voir aussi l'Audit et les administrateurs
      s'active pour une personne : un administrateur le demande avec un motif, un membre du Comité ou de l'Audit le confirme.
      Refuser ou retirer demande un motif.</p>
    {error && <MessageBanner tone="danger" title="Action impossible">{error}</MessageBanner>}
    <p>
      <label className="core-filter">Motif{" "}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
    </p>
    {canRequest && <p>
      <label className="core-filter">Membre du Risk Manager{" "}
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choisir…</option>
          {candidates.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
        </select>
      </label>{" "}
      <Button disabled={busy || !userId || !reason.trim()} onClick={() => run(() => rolesApi.requestSensitiveView(token, userId, reason.trim()))}>Demander</Button>
    </p>}
    <Table columns={columns} rows={grants} rowKey={(g) => g.id} loading={loading} density="compact" striped
      caption="Vues élargies demandées" emptyMessage="Aucune vue élargie demandée." />
  </Card>;
}
