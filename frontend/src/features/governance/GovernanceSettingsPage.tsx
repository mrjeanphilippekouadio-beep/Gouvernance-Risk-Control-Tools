import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge } from "@djamo/design-system";
import {
  configApi,
  type GovernanceConfig,
  type GovernanceDelays,
  type SelfValidationPolicy,
  type SelfValidationPolicyRequest,
} from "../../api/config";
import { ApiError } from "../../api/client";
import { describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

const POLICY_LABELS: Record<SelfValidationPolicy, string> = {
  REFUSE: "Refuser l'auto-validation",
  DOUBLE_CONFIRMATION: "Autoriser avec double confirmation",
};
type Setting = "policy" | "cumul" | "delays";
const TITLES: Record<Setting, string> = {
  policy: "Politique d'auto-validation",
  cumul: "Cumul Comité et Audit",
  delays: "Délais de gouvernance",
};
const DELAYS: { key: keyof GovernanceDelays; label: string; help: string }[] = [
  { key: "exceptionReviewDelayDays", label: "Délai de revue d'une action sans validation indépendante", help: "q168 : au-delà, l'action est en retard de revue." },
  { key: "acceptanceMaxDays", label: "Durée maximale de l'acceptation d'un principe", help: "q169 : une acceptation ne peut pas durer plus longtemps." },
  { key: "policyRequestExpiryDays", label: "Expiration d'une demande d'assouplissement", help: "q174 : passé ce délai, la demande ne peut plus être approuvée." },
];
const dayLabel = (v: number | null | undefined) => (v === null || v === undefined ? "Non configuré" : `${v} jour${v > 1 ? "s" : ""}`);

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const yesNo = (v: boolean, yes: string, no: string) => <StatusBadge label={v ? yes : no} tone={v ? "success" : "neutral"} />;

export function GovernanceSettingsPage({ token, onOpenFrameworks }: { token: string; onOpenFrameworks?: () => void }) {
  const [config, setConfig] = useState<GovernanceConfig | null>(null);
  const [pending, setPending] = useState<SelfValidationPolicyRequest | null>(null);
  const [pendingReadable, setPendingReadable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; title: string; text: string } | null>(null);

  const [editing, setEditing] = useState<Setting | null>(null);
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<SelfValidationPolicy>("REFUSE");
  const [flag, setFlag] = useState(false);
  const [delays, setDelays] = useState<Record<keyof GovernanceDelays, string>>({ exceptionReviewDelayDays: "", acceptanceMaxDays: "", policyRequestExpiryDays: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deciding_, setDecidingKind] = useState<"approve" | "reject" | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true); setError(null);
    try {
      const cfg = await configApi.get(token);
      if (id !== latest.current) return;
      setConfig(cfg);
      try {
        const req = await configApi.pendingPolicyRequest(token);
        if (id === latest.current) { setPending(req); setPendingReadable(true); }
      } catch (err) {
        // Neither the "set" nor the "approve" right: the pending request is simply not ours to see.
        if (id === latest.current) { setPending(null); setPendingReadable(false); if (!isForbidden(err)) setError(describeError(err)); }
      }
    } catch (err) { if (id === latest.current) setError(describeError(err)); }
    finally { if (id === latest.current) setLoading(false); }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  function openEdit(setting: Setting) {
    if (!config) return;
    setReason(""); setFormError(null);
    setPolicy(config.selfValidationPolicy === "REFUSE" ? "DOUBLE_CONFIRMATION" : "REFUSE");
    setFlag(config.committeeAuditCumulAllowed);
    setDelays({
      exceptionReviewDelayDays: config.exceptionReviewDelayDays?.toString() ?? "",
      acceptanceMaxDays: config.acceptanceMaxDays?.toString() ?? "",
      policyRequestExpiryDays: config.policyRequestExpiryDays?.toString() ?? "",
    });
    setEditing(setting);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setFormError(null);
    const why = reason.trim();
    try {
      if (editing === "policy") {
        const res = await configApi.setSelfValidationPolicy(token, policy, why);
        if (res.status === 202) {
          setNotice({ tone: "warning", title: "Changement NON appliqué : en attente d'approbation", text: `La politique reste « ${POLICY_LABELS[res.data.selfValidationPolicy]} » tant qu'une seconde personne habilitée n'a pas approuvé la demande.` });
        } else {
          setNotice({ tone: "success", title: "Changement appliqué", text: `Politique d'auto-validation : « ${POLICY_LABELS[res.data.selfValidationPolicy]} ».` });
        }
        setConfig(res.data);
        setEditing(null);
        await refresh();
        return;
      }
      if (editing === "delays") {
        const toDays = (v: string) => (v.trim() === "" ? null : Number(v));
        // Only the delays actually changed: never overwrite a concurrent edit of another one.
        const changed: Partial<GovernanceDelays> = {};
        for (const d of DELAYS) {
          const value = toDays(delays[d.key]);
          if (value !== (config?.[d.key] ?? null)) changed[d.key] = value;
        }
        if (Object.keys(changed).length === 0) { setFormError("Aucun délai modifié."); return; }
        const next = await configApi.setGovernanceDelays(token, changed, why);
        setConfig(next);
        setNotice({ tone: "success", title: "Changement appliqué", text: "Délais de gouvernance mis à jour." });
        setEditing(null);
        return;
      }
      const next = await configApi.setCommitteeAuditCumul(token, flag, why);
      setConfig(next);
      setNotice({ tone: "success", title: "Changement appliqué", text: `${TITLES[editing]} mis à jour.` });
      setEditing(null);
    } catch (err) {
      setFormError(describeError(err));
      if (isForbidden(err)) setEditing(null); // the global permission dialog explains it
    } finally { setSaving(false); }
  }

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (!pending || !deciding_) return;
    setDeciding(true); setDecisionError(null);
    const why = decisionReason.trim();
    try {
      if (deciding_ === "approve") {
        const next = await configApi.approvePolicyRequest(token, pending.id, why);
        setConfig(next);
        setNotice({ tone: "success", title: "Demande approuvée", text: `La politique est maintenant « ${POLICY_LABELS[next.selfValidationPolicy]} ».` });
      } else {
        await configApi.rejectPolicyRequest(token, pending.id, why);
        setNotice({ tone: "success", title: "Demande rejetée", text: "La politique d'auto-validation reste inchangée." });
      }
      setDecidingKind(null); setDecisionReason("");
      await refresh();
    } catch (err) {
      setDecisionError(describeError(err));
      if (isForbidden(err)) setDecidingKind(null);
      await refreshIfConflict(err);
    } finally { setDeciding(false); }
  }

  /** 404/409: the request was decided or replaced meanwhile: show the server's current state. */
  async function refreshIfConflict(err: unknown) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 409)) await refresh();
  }

  const policyCard = config && <Card
    header={<><strong>{TITLES.policy}</strong> <StatusBadge label={POLICY_LABELS[config.selfValidationPolicy]} tone={config.selfValidationPolicy === "REFUSE" ? "success" : "warning"} /></>}
    footer={<Button onClick={() => openEdit("policy")}>Modifier</Button>}
  >
    <p className="muted">Ce qui se passe quand quelqu'un valide sa propre saisie. Un assouplissement est confirmé par une seconde personne lorsqu'elle existe ; le serveur décide.</p>
    {pending && <MessageBanner tone="warning" title="Demande en attente d'approbation : le changement n'est pas appliqué">
      <p>Politique demandée : « {POLICY_LABELS[pending.requestedPolicy]} » (actuellement « {POLICY_LABELS[config.selfValidationPolicy]} », inchangée).</p>
      <p>Motif : {pending.reason}</p>
      {pending.expiresAt && <p className="muted">Expire le {fmtDate(pending.expiresAt)} : passé cette date, elle ne peut plus être approuvée.</p>}
      <p className="muted">Demandée le {fmtDate(pending.requestedAt)} par {pending.requestedBy}. L'auteur ne peut pas approuver sa propre demande : le serveur refuse.</p>
      {decisionError && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
      <div>
        <Button variant="primary" disabled={deciding} onClick={() => { setDecisionReason(""); setDecisionError(null); setDecidingKind("approve"); }}>Approuver</Button>{" "}
        <Button variant="destructive" disabled={deciding} onClick={() => { setDecisionReason(""); setDecisionError(null); setDecidingKind("reject"); }}>Rejeter</Button>
      </div>
    </MessageBanner>}
    {!pending && !pendingReadable && <p className="muted">Demande en attente : non consultable avec vos droits.</p>}
  </Card>;

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · GOUVERNANCE</p>
        <h1>Réglages de gouvernance</h1>
        <p className="core-page__subtitle">Chaque changement exige un motif et est tracé. Les droits, les demandes d'approbation et les refus sont décidés par le serveur ; cet écran affiche sa réponse.</p>
      </div>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone={notice.tone} title={notice.title}>{notice.text}</MessageBanner>}
    {loading && !config && <p role="status">Chargement…</p>}
    {config && <>
      {policyCard}
      <Card header={<strong>Portés par le Dispositif de risque</strong>} footer={onOpenFrameworks && <Button onClick={onOpenFrameworks}>Ouvrir le Dispositif de risque</Button>}>
        <p>Le mode d'évaluation par défaut, les seuils de passage au Comité et le caractère obligatoire de ce passage sont portés par la version active du Dispositif de risque. Ils ne se modifient pas ici et cet écran ne les affiche pas : la valeur en vigueur est celle de la version du Dispositif.</p>
      </Card>
      <Card header={<><strong>{TITLES.cumul}</strong> {yesNo(config.committeeAuditCumulAllowed, "Autorisé", "Interdit")}</>} footer={<Button onClick={() => openEdit("cumul")}>Modifier</Button>}>
        <p className="muted">Une même personne peut-elle appartenir au Comité et à l'Audit ? Le cumul Risk Manager et Audit reste toujours refusé.</p>
      </Card>
      <Card header={<strong>{TITLES.delays}</strong>} footer={<Button onClick={() => openEdit("delays")}>Modifier</Button>}>
        <p className="muted">Fixés par vous au paramétrage, en jours. « Non configuré » : aucun délai ne s'applique.</p>
        <ul>{DELAYS.map((d) => <li key={d.key}>{d.label} : <strong>{dayLabel(config[d.key])}</strong></li>)}</ul>
      </Card>
      <p className="muted">Version de la configuration : {config.version} · Mise à jour le {fmtDate(config.updatedAt)}</p>
    </>}

    <Modal
      open={editing !== null}
      onClose={() => { if (!saving) setEditing(null); }}
      title={editing ? `Modifier : ${TITLES[editing]}` : ""}
      busy={saving}
      actions={<>
        <Button onClick={() => setEditing(null)} disabled={saving}>Annuler</Button>
        <Button type="submit" form="gov-setting-form" variant="primary" disabled={saving || !reason.trim()}>{saving ? "Envoi…" : "Enregistrer"}</Button>
      </>}
    >
      {editing && <form id="gov-setting-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        {editing === "policy" && <>
          <FormField label="Politique demandée" htmlFor="gov-policy">
            <select id="gov-policy" value={policy} onChange={(e) => setPolicy(e.target.value as SelfValidationPolicy)}>
              {(Object.keys(POLICY_LABELS) as SelfValidationPolicy[]).map((p) => <option key={p} value={p}>{POLICY_LABELS[p]}</option>)}
            </select>
          </FormField>
          <MessageBanner tone="info">Si une seconde personne doit confirmer, le serveur répond « demande en attente » : le changement n'est alors pas appliqué.</MessageBanner>
        </>}
        {editing === "delays" && DELAYS.map((d) => <FormField key={d.key} label={`${d.label} (jours)`} htmlFor={`gov-${d.key}`} help={`${d.help} Laisser vide : non configuré.`}>
          <input id={`gov-${d.key}`} type="number" min={1} max={3650} step={1} value={delays[d.key]} onChange={(e) => setDelays({ ...delays, [d.key]: e.target.value })} />
        </FormField>)}
        {editing === "cumul" && <label className="core-filter">
          <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} /> Cumul Comité et Audit autorisé
        </label>}
        <FormField label="Motif (obligatoire)" htmlFor="gov-reason">
          <input id="gov-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>}
    </Modal>

    <Modal
      open={deciding_ !== null}
      onClose={() => { if (!deciding) setDecidingKind(null); }}
      title={deciding_ === "approve" ? "Approuver la demande" : "Rejeter la demande"}
      busy={deciding}
      actions={<>
        <Button onClick={() => setDecidingKind(null)} disabled={deciding}>Annuler</Button>
        <Button type="submit" form="gov-decide-form" variant={deciding_ === "approve" ? "primary" : "destructive"} disabled={deciding || !decisionReason.trim()}>{deciding ? "Envoi…" : deciding_ === "approve" ? "Approuver" : "Rejeter"}</Button>
      </>}
    >
      {deciding_ && <form id="gov-decide-form" onSubmit={decide}>
        {decisionError && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
        <FormField label={deciding_ === "approve" ? "Motif de l'approbation (obligatoire)" : "Motif du rejet (obligatoire)"} htmlFor="gov-decision-reason">
          <input id="gov-decision-reason" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>}
    </Modal>
  </section>;
}
