import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge } from "@djamo/design-system";
import {
  configApi,
  type GovernanceConfig,
  type GovernanceDelayRequest,
  type GovernanceDelays,
  type SelfValidationPolicy,
  type SelfValidationPolicyRequest,
} from "../../api/config";
import { FIXED_GROUP_LABELS, rolesApi, type FixedGroup, type GovernanceRight } from "../../api/roles";
import { ApiError } from "../../api/client";
import { describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

const POLICY_LABELS: Record<SelfValidationPolicy, string> = {
  REFUSE: "Refuser l'auto-validation",
  DOUBLE_CONFIRMATION: "Autoriser avec double confirmation",
};
type Setting = "policy" | "cumul" | "delays" | "right";
const TITLES: Record<Setting, string> = {
  policy: "Politique d'auto-validation",
  cumul: "Cumul Comité et Audit",
  delays: "Délais de gouvernance",
  right: "Droit de décision de gouvernance",
};
const DELAYS: { key: keyof GovernanceDelays; label: string; help: string }[] = [
  { key: "exceptionReviewDelayDays", label: "Délai de revue d'une action sans validation indépendante", help: "q168 : enregistré ; le signal de retard s'affichera avec le panel de gouvernance (q180)." },
  { key: "acceptanceMaxDays", label: "Durée maximale d'une acceptation de principe faite seul", help: "q169 : une acceptation faite sans tiers pour la confirmer ne peut pas durer plus longtemps." },
  { key: "policyRequestExpiryDays", label: "Expiration d'une demande d'assouplissement", help: "q174 : passé ce délai, la demande ne peut plus être approuvée." },
  { key: "riskManagerVacancyMaxDays", label: "Durée maximale d'une vacance du groupe Risk Manager", help: "q178 : 60 jours par défaut ; au-delà, la vacance est signalée comme dépassée." },
];
const GROUP_LABELS = FIXED_GROUP_LABELS;
const RIGHT_LABELS: Record<string, string> = {
  "config.selfvalidation.approve": "Approuver un assouplissement (auto-validation, délais)",
  "governanceprinciple.acceptance.confirm": "Confirmer l'acceptation d'un principe",
  "governanceexception.review": "Revoir une action sans validation indépendante",
  "orgprofile.approve": "Confirmer une baisse de taille du profil d'organisation",
};
function dayLabel(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Non configuré";
  return v > 1 ? `${v} jours` : `${v} jour`;
}
const toDays = (v: string) => (v.trim() === "" ? null : Number(v));
/** Only the delays actually changed: never overwrite a concurrent edit of another one. */
function changedDelays(form: Record<keyof GovernanceDelays, string>, config: GovernanceConfig | null): Partial<GovernanceDelays> {
  const changed: Partial<GovernanceDelays> = {};
  for (const d of DELAYS) {
    const value = toDays(form[d.key]);
    if (value !== (config?.[d.key] ?? null)) changed[d.key] = value;
  }
  return changed;
}

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** QA-SUITES2-FR-01: the server refusals of PUT /roles/governance-rights, said in French; the server still decides. */
const RIGHT_REFUSALS: Array<[RegExp, string]> = [
  [/q157/, "L'Audit ne confirme ni n'approuve jamais (q157) : il ne peut porter que la revue des exceptions."],
  [/At least one fixed group/, "Au moins un groupe fixe doit porter ce droit, y compris pendant qu'un changement de l'Audit attend sa validation."],
  [/group you belong to/, "Vous êtes membre d'un des groupes modifiés : un autre administrateur doit faire ce changement."],
  [/already pending/, "Un changement des droits de l'Audit attend déjà sa validation : il doit être décidé avant tout autre."],
];
function describeRightError(err: unknown): string {
  const known = err instanceof ApiError ? RIGHT_REFUSALS.find(([re]) => re.test(err.message)) : undefined;
  return known ? `${known[1]}${(err as ApiError).requestId ? ` (réf. ${(err as ApiError).requestId})` : ""}` : describeError(err);
}
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
  const [delays, setDelays] = useState<Record<keyof GovernanceDelays, string>>({ exceptionReviewDelayDays: "", acceptanceMaxDays: "", policyRequestExpiryDays: "", riskManagerVacancyMaxDays: "" });
  const [delayPending, setDelayPending] = useState<GovernanceDelayRequest | null>(null);
  const [rights, setRights] = useState<GovernanceRight[] | null>(null);
  const [right, setRight] = useState<GovernanceRight | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deciding_, setDecidingKind] = useState<"approve" | "reject" | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<"policy" | "delays">("policy");
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
      // Optional reads: without the right, the block is simply not shown (the server decides).
      const delayReq = await configApi.pendingDelayRequest(token).catch(() => null);
      const rightsList = await rolesApi.governanceRights(token).catch(() => null);
      if (id === latest.current) { setDelayPending(delayReq); setRights(rightsList); }
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
      riskManagerVacancyMaxDays: config.riskManagerVacancyMaxDays?.toString() ?? "",
    });
    setEditing(setting);
  }

  function openRight(r: GovernanceRight) {
    setReason(""); setFormError(null);
    setRight({ ...r, groups: [...r.groups] });
    setEditing("right");
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
        const changed = changedDelays(delays, config);
        if (Object.keys(changed).length === 0) { setFormError("Aucun délai modifié."); return; }
        const res = await configApi.setGovernanceDelays(token, changed, why);
        setConfig(res.data);
        if (res.status === 202) {
          setNotice({ tone: "warning", title: "Changement NON appliqué : en attente d'approbation", text: "Allonger ou retirer un délai est un assouplissement : il attend qu'une seconde personne habilitée approuve la demande." });
        } else {
          setNotice({ tone: "success", title: "Changement appliqué", text: "Délais de gouvernance mis à jour." });
        }
        setEditing(null);
        await refresh();
        return;
      }
      if (editing === "right" && right) {
        const res = await rolesApi.setGovernanceRight(token, right.permission, right.groups, why);
        setNotice(res.auditChangePending
          ? { tone: "warning", title: "Changement en partie en attente", text: "Le changement des droits de l'Audit attend sa validation (Audit ou Comité)." }
          : { tone: "success", title: "Changement appliqué", text: `${RIGHT_LABELS[right.permission] ?? right.permission} : ${res.groups.map((g) => GROUP_LABELS[g]).join(", ")}.` });
        setEditing(null);
        await refresh();
        return;
      }
      const next = await configApi.setCommitteeAuditCumul(token, flag, why);
      setConfig(next);
      setNotice({ tone: "success", title: "Changement appliqué", text: `${TITLES[editing]} mis à jour.` });
      setEditing(null);
    } catch (err) {
      setFormError(editing === "right" ? describeRightError(err) : describeError(err));
      if (isForbidden(err)) setEditing(null); // the global permission dialog explains it
    } finally { setSaving(false); }
  }

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (!deciding_) return;
    setDeciding(true); setDecisionError(null);
    const why = decisionReason.trim();
    try {
      if (decisionTarget === "delays") {
        if (!delayPending) return;
        if (deciding_ === "approve") {
          setConfig(await configApi.approveDelayRequest(token, delayPending.id, why));
          setNotice({ tone: "success", title: "Demande approuvée", text: "Les délais demandés sont appliqués." });
        } else {
          await configApi.rejectDelayRequest(token, delayPending.id, why);
          setNotice({ tone: "success", title: "Demande rejetée", text: "Les délais de gouvernance restent inchangés." });
        }
      } else if (!pending) {
        return;
      } else if (deciding_ === "approve") {
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

  const decisionButtons = (target: "policy" | "delays") => <div>
    <Button variant="primary" disabled={deciding} onClick={() => { setDecisionReason(""); setDecisionError(null); setDecisionTarget(target); setDecidingKind("approve"); }}>Approuver</Button>{" "}
    <Button variant="destructive" disabled={deciding} onClick={() => { setDecisionReason(""); setDecisionError(null); setDecisionTarget(target); setDecidingKind("reject"); }}>Rejeter</Button>
  </div>;

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
      {decisionError && decisionTarget === "policy" && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
      {decisionButtons("policy")}
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
        <p className="muted">Fixés par vous au paramétrage, en jours. « Non configuré » : aucun délai ne s'applique. Raccourcir un délai s'applique aussitôt ; l'allonger ou le retirer est confirmé par une seconde personne lorsqu'elle existe (le serveur décide).</p>
        <ul>{DELAYS.map((d) => <li key={d.key}>{d.label} : <strong>{dayLabel(config[d.key])}</strong></li>)}</ul>
        {delayPending && <MessageBanner tone="warning" title="Demande en attente d'approbation : le changement n'est pas appliqué">
          <ul>{DELAYS.filter((d) => d.key in delayPending.requestedDelays).map((d) => <li key={d.key}>{d.label} : {dayLabel(config[d.key])} → <strong>{dayLabel(delayPending.requestedDelays[d.key])}</strong></li>)}</ul>
          <p>Motif : {delayPending.reason}</p>
          {delayPending.expiresAt && <p className="muted">Expire le {fmtDate(delayPending.expiresAt)} : passé cette date, elle ne peut plus être approuvée.</p>}
          <p className="muted">Demandée le {fmtDate(delayPending.requestedAt)} par {delayPending.requestedBy}. L'auteur ne peut pas approuver sa propre demande : le serveur refuse.</p>
          {decisionError && decisionTarget === "delays" && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
          {decisionButtons("delays")}
        </MessageBanner>}
      </Card>
      {rights && <Card header={<strong>Droits de décision de gouvernance</strong>}>
        <p className="muted">Portés uniquement par les groupes fixes. L'Audit ne confirme ni n'approuve jamais (q157) : il ne peut porter que la revue. Le serveur refuse toute contradiction.</p>
        <ul>{rights.map((r) => <li key={r.permission}>
          {RIGHT_LABELS[r.permission] ?? r.permission} : <strong>{r.groups.length ? r.groups.map((g) => GROUP_LABELS[g]).join(", ") : "aucun groupe"}</strong>{" "}
          <Button onClick={() => openRight(r)}>Modifier</Button>
        </li>)}</ul>
      </Card>}
      <p className="muted">Version de la configuration : {config.version} · {config.version === 0 ? "jamais enregistrée (valeurs par défaut)" : `Mise à jour le ${fmtDate(config.updatedAt)}`}</p>
    </>}

    <Modal
      open={editing !== null}
      onClose={() => { if (!saving) setEditing(null); }}
      title={editing ? `Modifier : ${TITLES[editing]}` : ""}
      busy={saving}
      actions={<>
        <Button onClick={() => setEditing(null)} disabled={saving}>Annuler</Button>
        <Button type="submit" form="gov-setting-form" variant="primary" disabled={saving || !reason.trim() || (editing === "right" && right?.groups.length === 0)}>{saving ? "Envoi…" : "Enregistrer"}</Button>
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
        {editing === "right" && right && <fieldset>
          <legend>{RIGHT_LABELS[right.permission] ?? right.permission}</legend>
          {(Object.keys(GROUP_LABELS) as FixedGroup[]).map((g) => <label key={g} className="core-filter">
            <input
              type="checkbox"
              checked={right.groups.includes(g)}
              onChange={(e) => setRight({ ...right, groups: e.target.checked ? [...right.groups, g] : right.groups.filter((x) => x !== g) })}
            /> {GROUP_LABELS[g]}
          </label>)}
          {right.groups.length === 0 && <p className="muted">Cochez au moins un groupe : un droit de décision est toujours porté par un groupe fixe.</p>}
        </fieldset>}
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
