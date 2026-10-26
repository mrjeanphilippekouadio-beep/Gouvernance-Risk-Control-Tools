import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge, Timeline, type StatusTone } from "@djamo/design-system";
import {
  organizationProfileApi,
  type Classification,
  type OrganizationAnswers,
  type OrganizationProfile,
  type OrganizationProfileView,
  type Question,
} from "../../api/organizationProfile";
import { usePermissions } from "../../auth/usePermissions";
import { describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

const SIZE_LABELS: Record<Classification["value"], string> = { TPE: "Très petite entreprise", PME: "PME", GRANDE_ENTREPRISE: "Grande entreprise" };
const STATUS: Record<OrganizationProfile["status"], { label: string; tone: StatusTone }> = {
  PENDING: { label: "En attente de confirmation", tone: "warning" },
  ACTIVE: { label: "En vigueur", tone: "success" },
  SUPERSEDED: { label: "Remplacée", tone: "neutral" },
  REJECTED: { label: "Rejetée", tone: "danger" },
};
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function answerLabel(q: Question, answers: OrganizationAnswers): string {
  const raw = answers[q.id];
  if (q.type === "number") return String(raw);
  return q.options.find((o) => o.value === raw)?.label ?? String(raw);
}

/** O2/O3 (D3): the six-question profile, its versions and the size the SERVER computes. Nothing is recomputed here. */
export function OrganizationProfilePage({ token }: Readonly<{ token: string }>) {
  const { can } = usePermissions(token);
  const [view, setView] = useState<OrganizationProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; title: string; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true); setError(null);
    try {
      const v = await organizationProfileApi.get(token);
      if (id === latest.current) setView(v);
    } catch (err) { if (id === latest.current) setError(describeError(err)); }
    finally { if (id === latest.current) setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  function openEdit() {
    if (!view) return;
    const start: Record<string, string> = {};
    for (const q of view.questionnaire.questions) start[q.id] = view.active ? String(view.active.answers[q.id]) : "";
    setAnswers(start); setReason(""); setFormError(null); setEditing(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!view) return;
    const payload = {} as OrganizationAnswers;
    for (const q of view.questionnaire.questions) {
      const v = answers[q.id] ?? "";
      (payload as Record<string, string | number>)[q.id] = q.type === "number" ? Number(v) : v;
    }
    setSaving(true); setFormError(null);
    try {
      const created = await organizationProfileApi.submit(token, view.questionnaire.version, payload, reason.trim());
      setNotice(created.status === "PENDING"
        ? { tone: "warning", title: "Version NON appliquée : en attente de confirmation", text: "Cette version baisse la taille de l'organisation : une seconde personne habilitée doit la confirmer. La version en vigueur reste appliquée d'ici là." }
        : { tone: "success", title: "Version appliquée", text: created.regime === "ALONE" ? "Appliquée seul : aucune autre personne ne pouvait confirmer, c'est tracé." : `Version ${created.version} en vigueur.` });
      setEditing(false);
      await refresh();
    } catch (err) {
      setFormError(describeError(err));
      if (isForbidden(err)) setEditing(false);
    } finally { setSaving(false); }
  }

  async function approve() {
    if (!view?.pending) return;
    setDeciding(true); setDecisionError(null);
    try {
      await organizationProfileApi.approve(token, view.pending.id);
      setNotice({ tone: "success", title: "Version confirmée", text: "La nouvelle version est en vigueur." });
      await refresh();
    } catch (err) { setDecisionError(describeError(err)); await refresh(); }
    finally { setDeciding(false); }
  }

  async function reject(event: FormEvent) {
    event.preventDefault();
    if (!view?.pending) return;
    setDeciding(true); setDecisionError(null);
    try {
      await organizationProfileApi.reject(token, view.pending.id, rejectReason.trim());
      setRejecting(false);
      setNotice({ tone: "success", title: "Version rejetée", text: "La version en vigueur reste inchangée." });
      await refresh();
    } catch (err) { setDecisionError(describeError(err)); }
    finally { setDeciding(false); }
  }

  const questions = view?.questionnaire.questions ?? [];
  const sizeCard = (title: string, c: Classification) => <Card header={<><strong>{title}</strong> <StatusBadge label={SIZE_LABELS[c.value]} tone="info" />{c.toConfirm && <> <StatusBadge label="À confirmer" tone="warning" /></>}</>}>
    <p className="muted">Effectif retenu : {c.effectiveHeadcount} (déclaré {c.declaredHeadcount}, comptes actifs observés {c.observedAccounts}) · Critères de structure remplis : {c.structureScore} sur 4 · Règle v{c.ruleVersion}</p>
    <ul>{c.criteria.map((k) => <li key={k.id}>{k.label} : {k.met ? "oui" : "non"} (déclaré {k.declared ? "oui" : "non"}, observé {k.observed ? "oui" : "non"})</li>)}</ul>
  </Card>;

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · GOUVERNANCE</p>
        <h1>Profil d'organisation</h1>
        <p className="core-page__subtitle">Six questions qui fixent la taille de l'organisation, donc les principes de gouvernance qui s'appliquent. La taille est calculée par le serveur, à partir de vos réponses et de ce que l'outil observe.</p>
      </div>
      {view && can("orgprofile.submit") && <Button variant="primary" onClick={openEdit} disabled={view.pending !== null}>{view.active ? "Nouvelle version" : "Remplir le profil"}</Button>}
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone={notice.tone} title={notice.title}>{notice.text}</MessageBanner>}
    {loading && !view && <output>Chargement…</output>}

    {view && <>
      {!view.active && <MessageBanner tone="info" title="Profil non renseigné">Aucune version n'a été saisie : aucune taille n'est retenue.</MessageBanner>}
      {view.classification && sizeCard("Taille retenue", view.classification)}
      {view.profileGaps.length > 0 && <MessageBanner tone="warning" title="Écarts entre le déclaré et l'observé">
        <ul>{view.profileGaps.map((g) => <li key={g.id}>{g.message}</li>)}</ul>
      </MessageBanner>}

      {view.pending && <Card header={<><strong>Version {view.pending.version} en attente</strong> <StatusBadge {...STATUS.PENDING} /></>}>
        <p>Cette version n'est pas appliquée. Motif : {view.pending.reason}</p>
        <p className="muted">Soumise le {fmtDate(view.pending.submittedAt)}. L'auteur ne peut pas confirmer sa propre version : le serveur refuse.</p>
        <ul>{questions.map((q) => <li key={q.id}>{q.label} <strong>{answerLabel(q, view.pending!.answers)}</strong></li>)}</ul>
        {view.pendingClassification && <p>Taille si elle est confirmée : <strong>{SIZE_LABELS[view.pendingClassification.value]}</strong></p>}
        {decisionError && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
        {can("orgprofile.approve") && <div>
          <Button variant="primary" disabled={deciding} onClick={() => void approve()}>Confirmer</Button>{" "}
          <Button variant="destructive" disabled={deciding} onClick={() => { setRejectReason(""); setDecisionError(null); setRejecting(true); }}>Rejeter</Button>
        </div>}
      </Card>}

      {view.active && <Card header={<><strong>Version {view.active.version} en vigueur</strong> <StatusBadge {...STATUS.ACTIVE} />{view.active.regime === "ALONE" && <> <StatusBadge label="Appliquée seul" tone="warning" /></>}</>}>
        <ul>{questions.map((q) => <li key={q.id}>{q.label} <strong>{answerLabel(q, view.active!.answers)}</strong></li>)}</ul>
        <p className="muted">Motif : {view.active.reason} · Depuis le {fmtDate(view.active.decidedAt ?? view.active.submittedAt)}</p>
      </Card>}

      <Card header={<strong>Ce que l'outil observe</strong>}>
        <p className="muted">Comptes actifs : {view.observed.activeAccounts} · Risk Managers : {view.observed.riskManagers} · Comité : {view.observed.committeeMembers} · Audit : {view.observed.auditMembers}</p>
      </Card>

      {view.history.length > 0 && <Card header={<strong>Historique des versions</strong>}>
        <Timeline items={view.history.map((p) => ({
          label: `Version ${p.version} · ${STATUS[p.status].label}${p.regime === "ALONE" ? " · appliquée seul" : ""}`,
          detail: [`Soumise le ${fmtDate(p.submittedAt)}`, `Motif : ${p.reason}`, p.decisionReason && `Décision : ${p.decisionReason}`].filter(Boolean).join(" · "),
          state: p.status === "ACTIVE" ? "current" : "done",
        }))} />
      </Card>}
    </>}

    <Modal
      open={editing}
      onClose={() => { if (!saving) setEditing(false); }}
      title="Nouvelle version du profil"
      busy={saving}
      actions={<>
        <Button onClick={() => setEditing(false)} disabled={saving}>Annuler</Button>
        <Button type="submit" form="org-profile-form" variant="primary" disabled={saving || !reason.trim()}>{saving ? "Envoi…" : "Soumettre"}</Button>
      </>}
    >
      <form id="org-profile-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        {questions.map((q) => q.type === "number"
          ? <FormField key={q.id} label={q.label} htmlFor={`org-${q.id}`}>
            <input id={`org-${q.id}`} type="number" min={q.min} max={q.max} step={1} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} required />
          </FormField>
          : <fieldset key={q.id} className="core-fieldset">
            <legend>{q.label}</legend>
            {q.options.map((o) => <label key={o.value} className="core-filter">
              <input type="radio" name={`org-${q.id}`} value={o.value} checked={answers[q.id] === o.value} onChange={() => setAnswers({ ...answers, [q.id]: o.value })} required /> {o.label}
            </label>)}
          </fieldset>)}
        <MessageBanner tone="info">Une version qui baisse la taille attend la confirmation d'une seconde personne, ou s'applique « seul » s'il n'y en a pas : c'est le serveur qui le décide.</MessageBanner>
        <FormField label="Motif (obligatoire)" htmlFor="org-reason">
          <input id="org-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>
    </Modal>

    <Modal
      open={rejecting}
      onClose={() => { if (!deciding) setRejecting(false); }}
      title="Rejeter la version en attente"
      busy={deciding}
      actions={<>
        <Button onClick={() => setRejecting(false)} disabled={deciding}>Annuler</Button>
        <Button type="submit" form="org-reject-form" variant="destructive" disabled={deciding || !rejectReason.trim()}>Rejeter</Button>
      </>}
    >
      <form id="org-reject-form" onSubmit={reject}>
        {decisionError && <MessageBanner tone="danger">{decisionError}</MessageBanner>}
        <FormField label="Motif du rejet (obligatoire)" htmlFor="org-reject-reason">
          <input id="org-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>
    </Modal>
  </section>;
}
