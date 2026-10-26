import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, MessageBanner } from "@djamo/design-system";
import { processesApi, type ProcessResponsibilities, type ResponsibilitiesInput } from "../../api/processes";
import type { DirectoryEntry } from "../../api/users";
import { AccountPicker, accountName, useGovernanceConfirm } from "../../design-system";
import { describeError, isPermissionDenied } from "../indicators/shared";

type Slot = "ownerUserId" | "riskChampionUserId" | "deputyUserId";
const SLOTS: { key: Slot; label: string }[] = [
  { key: "ownerUserId", label: "Propriétaire du processus" },
  { key: "riskChampionUserId", label: "Champion des risques" },
  { key: "deputyUserId", label: "N-1 (suppléant)" },
];

/**
 * D2b (O14): owner, risk champion and N-1 of a process. The server checks everything (active account, tenant,
 * nobody names themselves, q166 exception for the champion with its double confirmation); this card only sends.
 */
export function ProcessResponsibilitiesCard({ token, processId, accounts, canAssign, onChanged }: Readonly<{
  token: string;
  processId: string;
  accounts: DirectoryEntry[];
  canAssign: boolean;
  onChanged?: () => void;
}>) {
  const [data, setData] = useState<ProcessResponsibilities | null>(null);
  const [form, setForm] = useState<Record<Slot, string>>({ ownerUserId: "", riskChampionUserId: "", deputyUserId: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const gov = useGovernanceConfirm();

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await processesApi.responsibilities(token, processId);
      setData(r);
      setForm({ ownerUserId: r.ownerUserId ?? "", riskChampionUserId: r.riskChampionUserId ?? "", deputyUserId: r.deputyUserId ?? "" });
    } catch (err) { setData(null); setError(describeError(err)); }
  }, [token, processId]);

  useEffect(() => { setNotice(null); void load(); }, [load]);

  async function send(body: ResponsibilitiesInput, done: string) {
    setSaving(true); setError(null); setNotice(null);
    try {
      await gov.run((c) => processesApi.setResponsibilities(token, processId, body, c));
      setNotice(done);
      await load();
      onChanged?.();
    } catch (err) {
      if (!isPermissionDenied(err)) setError(describeError(err));
    } finally { setSaving(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const body: ResponsibilitiesInput = {};
    for (const { key } of SLOTS) {
      const next = form[key] || null;
      if (next !== data[key]) body[key] = next;
    }
    if (Object.keys(body).length === 0) { setNotice("Aucun changement à enregistrer."); return; }
    void send(body, "Responsabilités enregistrées.");
  }

  return <Card header={<strong>Responsabilités</strong>}>
    {error && <MessageBanner tone="danger">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    {data && <>
      <p className="muted">
        {SLOTS.map(({ key, label }) => `${label} : ${accountName(accounts, data[key])}`).join(" · ")}
      </p>
      {data.legacyOwner && <p className="muted">Responsable saisi en texte (historique, inchangé) : {data.legacyOwner}</p>}
      {canAssign && data.ownerCandidates.length > 0 && <MessageBanner tone="info" title="Comptes dont le nom correspond au responsable saisi">
        <p>Proposition de rapprochement par nom : rien n'est appliqué sans votre confirmation, compte par compte.</p>
        {data.ownerCandidates.map((c) => <p key={c.id}>
          {c.displayName}{" "}
          <Button disabled={saving} onClick={() => void send({ ownerUserId: c.id }, `${c.displayName} confirmé comme propriétaire.`)}>Confirmer comme propriétaire</Button>
        </p>)}
      </MessageBanner>}
      {canAssign && <form onSubmit={submit}>
        {SLOTS.map(({ key, label }) => <AccountPicker
          key={key}
          id={`resp-${key}`}
          label={label}
          value={form[key]}
          onChange={(v) => setForm({ ...form, [key]: v })}
          accounts={accounts}
        />)}
        <p className="muted">Seuls des comptes actifs peuvent être désignés. Personne ne se désigne soi-même, sauf le champion dans une structure à une personne : le serveur demande alors une double confirmation avec motif.</p>
        <Button type="submit" variant="primary" disabled={saving}>{saving ? "Envoi…" : "Enregistrer les responsabilités"}</Button>
      </form>}
    </>}
    {gov.dialog}
  </Card>;
}
