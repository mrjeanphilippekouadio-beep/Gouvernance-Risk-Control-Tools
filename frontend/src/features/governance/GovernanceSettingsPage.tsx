import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge } from "@djamo/design-system";
import {
  configApi,
  type ConfigEvaluationMode,
  type GovernanceConfig,
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
const MODE_LABELS: Record<ConfigEvaluationMode, string> = { CLASSIQUE: "Classique", PARTICIPATIF: "Participatif" };

type Setting = "policy" | "mode" | "thresholds" | "enforcement" | "cumul";
const TITLES: Record<Setting, string> = {
  policy: "Politique d'auto-validation",
  mode: "Mode d'évaluation par défaut",
  thresholds: "Seuils de passage au Comité",
  enforcement: "Passage obligatoire par le Comité",
  cumul: "Cumul Comité et Audit",
};

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const yesNo = (v: boolean, yes: string, no: string) => <StatusBadge label={v ? yes : no} tone={v ? "success" : "neutral"} />;

export function GovernanceSettingsPage({ token }: { token: string }) {
  const [config, setConfig] = useState<GovernanceConfig | null>(null);
  const [pending, setPending] = useState<SelfValidationPolicyRequest | null>(null);
  const [pendingReadable, setPendingReadable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; title: string; text: string } | null>(null);

  const [editing, setEditing] = useState<Setting | null>(null);
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<SelfValidationPolicy>("REFUSE");
  const [mode, setMode] = useState<ConfigEvaluationMode>("CLASSIQUE");
  const [evalMin, setEvalMin] = useState("");
  const [treatMin, setTreatMin] = useState("");
  const [flag, setFlag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
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
    setMode(config.evaluationMode);
    setEvalMin(String(config.committeeEvaluationMinScore));
    setTreatMin(config.committeeTreatmentMinScore === null ? "" : String(config.committeeTreatmentMinScore));
    setFlag(setting === "enforcement" ? config.committeeEvaluationEnforced : config.committeeAuditCumulAllowed);
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
      let next: GovernanceConfig;
      if (editing === "mode") next = await configApi.setEvaluationMode(token, mode, why);
      else if (editing === "thresholds") {
        next = await configApi.setCommitteeThresholds(token, {
          ...(evalMin.trim() !== "" ? { evaluationMinScore: Number(evalMin) } : {}),
          treatmentMinScore: treatMin.trim() === "" ? null : Number(treatMin),
        }, why);
      } else if (editing === "enforcement") next = await configApi.setCommitteeEnforcement(token, flag, why);
      else next = await configApi.setCommitteeAuditCumul(token, flag, why);
      setConfig(next);
      setNotice({ tone: "success", title: "Changement appliqué", text: `${TITLES[editing]} mis à jour.` });
      setEditing(null);
    } catch (err) {
      setFormError(describeError(err));
      if (isForbidden(err)) setEditing(null); // the global permission dialog explains it
    } finally { setSaving(false); }
  }

  async function approve() {
    if (!pending) return;
    setDeciding(true); setDecisionError(null);
    try {
      const next = await configApi.approvePolicyRequest(token, pending.id);
      setConfig(next);
      setNotice({ tone: "success", title: "Demande approuvée", text: `La politique est maintenant « ${POLICY_LABELS[next.selfValidationPolicy]} ».` });
      await refresh();
    } catch (err) { setDecisionError(describeError(err)); await refreshIfConflict(err); }
    finally { setDeciding(false); }
  }

  async function reject(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    setDeciding(true); setDecisionError(null);
    try {
      await configApi.rejectPolicyRequest(token, pending.id, rejectReason.trim());
      setNotice({ tone: "success", title: "Demande rejetée", text: "La politique d'auto-validation reste inchangée." });
      setRejecting(false); setRejectReason("");
      await refresh();
    } catch (err) {
      setDecisionError(describeError(err));
      if (isForbidden(err)) setRejecting(false);
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
      <p className="muted">Demandée le {fmtDate(pending.requestedAt)} par {pending.requestedBy}. L'auteur ne peut pas approuver sa propre demande : le serveur refuse.</p>
      {decisionError && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
      <div>
        <Button variant="primary" disabled={deciding} onClick={() => void approve()}>{deciding ? "Envoi…" : "Approuver"}</Button>{" "}
        <Button variant="destructive" disabled={deciding} onClick={() => { setRejectReason(""); setDecisionError(null); setRejecting(true); }}>Rejeter</Button>
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
      <Card header={<><strong>{TITLES.mode}</strong> <StatusBadge label={MODE_LABELS[config.evaluationMode]} tone="info" /></>} footer={<Button onClick={() => openEdit("mode")}>Modifier</Button>}>
        <p className="muted">Mode appliqué aux processus qui n'ont pas de mode propre. Un processus change de mode par une demande (écran « Demandes de mode d'évaluation »).</p>
      </Card>
      <Card header={<strong>{TITLES.thresholds}</strong>} footer={<Button onClick={() => openEdit("thresholds")}>Modifier</Button>}>
        <p>Évaluation : score minimum <strong>{config.committeeEvaluationMinScore}</strong></p>
        <p>Traitement : {config.committeeTreatmentMinScore === null ? "aucun seuil configuré (aucune décision de traitement n'atteint le Comité)" : <>score minimum <strong>{config.committeeTreatmentMinScore}</strong></>}</p>
      </Card>
      <Card header={<><strong>{TITLES.enforcement}</strong> {yesNo(config.committeeEvaluationEnforced, "Obligatoire", "Non obligatoire")}</>} footer={<Button onClick={() => openEdit("enforcement")}>Modifier</Button>}>
        <p className="muted">Passage par le Comité avant validation d'une évaluation.</p>
      </Card>
      <Card header={<><strong>{TITLES.cumul}</strong> {yesNo(config.committeeAuditCumulAllowed, "Autorisé", "Interdit")}</>} footer={<Button onClick={() => openEdit("cumul")}>Modifier</Button>}>
        <p className="muted">Une même personne peut-elle appartenir au Comité et à l'Audit ? Le cumul Risk Manager et Audit reste toujours refusé.</p>
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
        {editing === "mode" && <FormField label="Mode par défaut" htmlFor="gov-mode">
          <select id="gov-mode" value={mode} onChange={(e) => setMode(e.target.value as ConfigEvaluationMode)}>
            {(Object.keys(MODE_LABELS) as ConfigEvaluationMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </FormField>}
        {editing === "thresholds" && <>
          <FormField label="Score minimum, évaluation" htmlFor="gov-eval-min"><input id="gov-eval-min" type="number" step={1} value={evalMin} onChange={(e) => setEvalMin(e.target.value)} /></FormField>
          <FormField label="Score minimum, traitement" htmlFor="gov-treat-min" help="Laisser vide pour n'avoir aucun seuil configuré.">
            <input id="gov-treat-min" type="number" step={1} value={treatMin} onChange={(e) => setTreatMin(e.target.value)} />
          </FormField>
        </>}
        {(editing === "enforcement" || editing === "cumul") && <label className="core-filter">
          <input type="checkbox" checked={flag} onChange={(e) => setFlag(e.target.checked)} /> {editing === "enforcement" ? "Passage par le Comité obligatoire" : "Cumul Comité et Audit autorisé"}
        </label>}
        <FormField label="Motif (obligatoire)" htmlFor="gov-reason">
          <textarea id="gov-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required />
        </FormField>
      </form>}
    </Modal>

    <Modal
      open={rejecting}
      onClose={() => { if (!deciding) setRejecting(false); }}
      title="Rejeter la demande"
      busy={deciding}
      actions={<>
        <Button onClick={() => setRejecting(false)} disabled={deciding}>Annuler</Button>
        <Button type="submit" form="gov-reject-form" variant="destructive" disabled={deciding || !rejectReason.trim()}>{deciding ? "Envoi…" : "Rejeter"}</Button>
      </>}
    >
      {rejecting && <form id="gov-reject-form" onSubmit={reject}>
        {decisionError && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
        <FormField label="Motif du rejet (obligatoire)" htmlFor="gov-reject-reason">
          <textarea id="gov-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} required />
        </FormField>
      </form>}
    </Modal>
  </section>;
}
