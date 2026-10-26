import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { usersApi, type AdminUser } from "../../api/users";
import { rolesApi, type Role } from "../../api/roles";
import { usePermissions } from "../../auth/usePermissions";
import { describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

type Dialog = { kind: "create" } | { kind: "edit"; user: AdminUser } | { kind: "suspend"; user: AdminUser } | { kind: "reactivate"; user: AdminUser };
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/**
 * q164 (DECISION-080): account administration. Every rule (no self-suspension, the last Risk Manager cannot leave
 * without a successor, a forbidden cumul cannot be revived) is the server's: its refusal is shown as is.
 */
export function UsersAdmin({ token }: Readonly<{ token: string }>) {
  const { can } = usePermissions(token);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [includeSuspended, setIncludeSuspended] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setUsers(await usersApi.listAdmin(token, includeSuspended)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }, [token, includeSuspended]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { rolesApi.list(token).then(setRoles).catch(() => setRoles([])); }, [token]);

  function open(next: Dialog) {
    setFormError(null);
    setEmail(""); setRoleId(""); setReason("");
    setDisplayName(next.kind === "edit" ? next.user.displayName : "");
    setDialog(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    setSaving(true); setFormError(null);
    try {
      if (dialog.kind === "create") {
        await usersApi.create(token, { email: email.trim(), displayName: displayName.trim(), roleId, ...(reason.trim() ? { reason: reason.trim() } : {}) });
        setNotice(`Compte ${email.trim()} créé.`);
      } else if (dialog.kind === "edit") {
        await usersApi.update(token, dialog.user.id, { displayName: displayName.trim() });
        setNotice("Nom mis à jour.");
      } else if (dialog.kind === "suspend") {
        await usersApi.suspend(token, dialog.user.id);
        setNotice(`Compte ${dialog.user.email} suspendu : il ne peut plus se connecter.`);
      } else {
        await usersApi.reactivate(token, dialog.user.id);
        setNotice(`Compte ${dialog.user.email} réactivé.`);
      }
      setDialog(null);
      await refresh();
    } catch (err) {
      setFormError(describeError(err));
      if (isForbidden(err)) setDialog(null);
    } finally { setSaving(false); }
  }

  const columns: TableColumn<AdminUser>[] = [
    { key: "name", header: "Nom", render: (u) => <strong>{u.displayName}</strong> },
    { key: "email", header: "E-mail", render: (u) => u.email },
    { key: "created", header: "Créé le", render: (u) => fmtDate(u.createdAt) },
    { key: "status", header: "Statut", render: (u) => <StatusBadge label={u.deletedAt ? "Suspendu" : "Actif"} tone={u.deletedAt ? "neutral" : "success"} /> },
    { key: "actions", header: "", render: (u) => <>
      {!u.deletedAt && can("user.update") && <Button onClick={() => open({ kind: "edit", user: u })} aria-label={`Modifier ${u.displayName}`}>Modifier</Button>}{" "}
      {!u.deletedAt && can("user.delete") && <Button variant="destructive" onClick={() => open({ kind: "suspend", user: u })} aria-label={`Suspendre ${u.displayName}`}>Suspendre</Button>}
      {u.deletedAt && can("user.reactivate") && <Button onClick={() => open({ kind: "reactivate", user: u })} aria-label={`Réactiver ${u.displayName}`}>Réactiver</Button>}
    </> },
  ];

  const titles: Record<Dialog["kind"], string> = { create: "Nouveau compte", edit: "Modifier le compte", suspend: "Suspendre le compte", reactivate: "Réactiver le compte" };

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · PLATEFORME</p>
        <h1>Comptes</h1>
        <p className="core-page__subtitle">Créer, renommer, suspendre ou réactiver un compte. Un compte n'est jamais supprimé : la suspension bloque la connexion et reste tracée. Les règles de gouvernance (dernier Risk Manager, cumuls interdits) sont appliquées par le serveur.</p>
      </div>
      {can("user.create") && <Button variant="primary" onClick={() => open({ kind: "create" })}>Nouveau compte</Button>}
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    <Card header={<><strong>Comptes du tenant</strong> <label className="core-filter"><input type="checkbox" checked={includeSuspended} onChange={(e) => setIncludeSuspended(e.target.checked)} /> Inclure les comptes suspendus</label></>}>
      <Table columns={columns} rows={users} rowKey={(u) => u.id} loading={loading} emptyMessage="Aucun compte." />
      {users.length >= 100 && <p className="muted">Seuls les 100 premiers comptes sont affichés.</p>}
    </Card>

    <Modal
      open={dialog !== null}
      onClose={() => { if (!saving) setDialog(null); }}
      title={dialog ? titles[dialog.kind] : ""}
      busy={saving}
      actions={<>
        <Button onClick={() => setDialog(null)} disabled={saving}>Annuler</Button>
        <Button type="submit" form="user-form" variant={dialog?.kind === "suspend" ? "destructive" : "primary"}
          disabled={saving || (dialog?.kind === "create" && (!email.trim() || !displayName.trim() || !roleId)) || (dialog?.kind === "edit" && !displayName.trim())}>
          {saving ? "Envoi…" : "Confirmer"}
        </Button>
      </>}
    >
      {dialog && <form id="user-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        {dialog.kind === "create" && <>
          <FormField label="E-mail *" htmlFor="user-email"><input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></FormField>
          <FormField label="Nom affiché *" htmlFor="user-name"><input id="user-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></FormField>
          <FormField label="Rôle initial *" htmlFor="user-role" help="Obligatoire : un compte naît avec un rôle.">
            <select id="user-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
              <option value="">Sélectionner…</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </FormField>
          <FormField label="Motif" htmlFor="user-reason" help="Exigé par le serveur pour un rôle de groupe fixe (Risk Manager, Comité, Audit).">
            <input id="user-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </FormField>
        </>}
        {dialog.kind === "edit" && <FormField label="Nom affiché *" htmlFor="user-name"><input id="user-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></FormField>}
        {dialog.kind === "suspend" && <>
          <p>{dialog.user.displayName} ({dialog.user.email}) ne pourra plus se connecter dès sa prochaine requête.</p>
          <MessageBanner tone="warning">Si ce compte est le dernier membre du groupe Risk Manager, le serveur refuse la suspension.</MessageBanner>
        </>}
        {dialog.kind === "reactivate" && <p>{dialog.user.displayName} ({dialog.user.email}) pourra de nouveau se connecter. Le serveur refuse la réactivation si elle ferait revivre un cumul interdit.</p>}
      </form>}
    </Modal>
  </section>;
}
