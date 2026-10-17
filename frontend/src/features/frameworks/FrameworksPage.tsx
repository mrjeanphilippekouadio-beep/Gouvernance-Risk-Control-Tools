import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import {
  riskFrameworksApi,
  type ChangeRequest,
  type DraftPatch,
  type EvaluationMode,
  type FrameworkDetail,
  type FrameworkSummary,
  type FrameworkVersion,
  type MasterySource,
  type VersionStatus,
  type VoteRule,
} from "../../api/riskFrameworks";
import { ratingScalesApi, type RatingScale } from "../../api/evaluations";
import { FormModal, dateOnly, describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

const STATUS_LABELS: Record<VersionStatus, string> = { DRAFT: "Brouillon", PENDING_APPROVAL: "En attente d'approbation", ACTIVE: "Active", ARCHIVED: "Archivée" };
const STATUS_TONES: Record<VersionStatus, "success" | "warning" | "neutral" | "info"> = { DRAFT: "info", PENDING_APPROVAL: "warning", ACTIVE: "success", ARCHIVED: "neutral" };
const MODE_LABELS: Record<EvaluationMode, string> = { CLASSIQUE: "Classique", PARTICIPATIF: "Participatif" };
const MASTERY_LABELS: Record<MasterySource, string> = { RISK_TEAM: "Équipe Risques", FIRST_LINE: "Première ligne" };
// CUSTOM is refused by the server for now: not offered.
const VOTE_RULES: Exclude<VoteRule, "CUSTOM">[] = ["DEFAULT", "A", "B", "C"];
const yesNo = (v: boolean) => (v ? "Oui" : "Non");
const orDash = (v: number | null) => (v === null ? "—" : String(v));

interface DraftForm {
  ratingScaleId: string; defaultEvaluationMode: EvaluationMode; committeeEvaluationMinScore: string; committeeEvaluationEnforced: boolean;
  committeeTreatmentMinScore: string; selfProposalAllowed: boolean; lowCriticalityThreshold: string;
  riskOwnerExecutorCumulAllowed: boolean; delegateExecutorCumulAllowed: boolean; delegationMaxDays: string;
  hybridPolicyEnabled: boolean; masteryAuthoritativeSource: MasterySource; committeeVoteRule: VoteRule;
}

const toForm = (v: FrameworkVersion): DraftForm => ({
  ratingScaleId: v.ratingScaleId, defaultEvaluationMode: v.defaultEvaluationMode,
  committeeEvaluationMinScore: String(v.committeeEvaluationMinScore), committeeEvaluationEnforced: v.committeeEvaluationEnforced,
  committeeTreatmentMinScore: v.committeeTreatmentMinScore === null ? "" : String(v.committeeTreatmentMinScore),
  selfProposalAllowed: v.selfProposalAllowed,
  lowCriticalityThreshold: v.lowCriticalityThreshold === null ? "" : String(v.lowCriticalityThreshold),
  riskOwnerExecutorCumulAllowed: v.riskOwnerExecutorCumulAllowed, delegateExecutorCumulAllowed: v.delegateExecutorCumulAllowed,
  delegationMaxDays: v.delegationMaxDays === null ? "" : String(v.delegationMaxDays),
  hybridPolicyEnabled: v.hybridPolicyEnabled, masteryAuthoritativeSource: v.masteryAuthoritativeSource, committeeVoteRule: v.committeeVoteRule,
});

const num = (s: string) => Number(s);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Only the fields that differ from the stored draft are sent (the server validates every value). */
function diffPatch(form: DraftForm, v: FrameworkVersion): DraftPatch {
  const next: Required<DraftPatch> = {
    ratingScaleId: form.ratingScaleId, defaultEvaluationMode: form.defaultEvaluationMode,
    committeeEvaluationMinScore: num(form.committeeEvaluationMinScore), committeeEvaluationEnforced: form.committeeEvaluationEnforced,
    committeeTreatmentMinScore: numOrNull(form.committeeTreatmentMinScore), changeApprover: v.changeApprover,
    selfProposalAllowed: form.selfProposalAllowed, lowCriticalityThreshold: numOrNull(form.lowCriticalityThreshold),
    riskOwnerExecutorCumulAllowed: form.riskOwnerExecutorCumulAllowed, delegateExecutorCumulAllowed: form.delegateExecutorCumulAllowed,
    delegationMaxDays: numOrNull(form.delegationMaxDays), hybridPolicyEnabled: form.hybridPolicyEnabled,
    masteryAuthoritativeSource: form.masteryAuthoritativeSource, committeeVoteRule: form.committeeVoteRule,
  };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof DraftPatch)[]) {
    if (next[key] !== v[key]) patch[key] = next[key];
  }
  return patch as DraftPatch;
}

type ReasonAction =
  | { kind: "discard" | "activate"; version: FrameworkVersion }
  | { kind: "approve" | "reject" | "withdraw"; request: ChangeRequest }
  | { kind: "identity" };

const REASON_TEXT: Record<ReasonAction["kind"], { title: string; label: string; submit: string; required: boolean }> = {
  discard: { title: "Abandonner le brouillon", label: "Motif *", submit: "Abandonner", required: true },
  activate: { title: "Demander l'activation", label: "Motif de la demande *", submit: "Envoyer la demande", required: true },
  approve: { title: "Approuver la demande", label: "Commentaire", submit: "Approuver", required: false },
  reject: { title: "Refuser la demande", label: "Commentaire *", submit: "Refuser", required: true },
  withdraw: { title: "Retirer la demande", label: "Motif *", submit: "Retirer", required: true },
  identity: { title: "Modifier le Dispositif", label: "Motif de la modification *", submit: "Enregistrer", required: true },
};

export function FrameworksPage({ token }: { token: string }) {
  const [rows, setRows] = useState<FrameworkSummary[]>([]);
  const [scales, setScales] = useState<RatingScale[]>([]);
  const [scalesUnavailable, setScalesUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FrameworkDetail | null>(null);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "", ratingScaleId: "" });
  const [editing, setEditing] = useState<FrameworkVersion | null>(null);
  const [draftForm, setDraftForm] = useState<DraftForm | null>(null);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [identity, setIdentity] = useState({ name: "", description: "" });
  const [reasonText, setReasonText] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const latestList = useRef(0);
  const latestDetail = useRef(0);

  const refreshList = useCallback(async () => {
    const id = ++latestList.current;
    setLoading(true); setError(null);
    try {
      const data = await riskFrameworksApi.list(token);
      if (id === latestList.current) setRows(data);
    } catch (err) { if (id === latestList.current) setError(describeError(err)); }
    finally { if (id === latestList.current) setLoading(false); }
  }, [token]);

  const refreshDetail = useCallback(async (frameworkId: string | null) => {
    const id = ++latestDetail.current;
    if (!frameworkId) { setDetail(null); setRequests([]); return; }
    setDetailLoading(true); setDetailError(null); setRequestsError(null);
    try {
      const [d, r] = await Promise.allSettled([riskFrameworksApi.get(token, frameworkId), riskFrameworksApi.listRequests(token, "PENDING")]);
      if (id !== latestDetail.current) return;
      if (d.status === "fulfilled") setDetail(d.value); else { setDetail(null); setDetailError(describeError(d.reason)); }
      if (r.status === "fulfilled") setRequests(r.value.filter((q) => q.frameworkId === frameworkId));
      else { setRequests([]); setRequestsError(describeError(r.reason)); }
    } finally { if (id === latestDetail.current) setDetailLoading(false); }
  }, [token]);

  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => { void refreshDetail(selectedId); }, [refreshDetail, selectedId]);
  useEffect(() => {
    ratingScalesApi.list(token).then((s) => { setScales(s); setScalesUnavailable(false); })
      .catch(() => { setScales([]); setScalesUnavailable(true); });
  }, [token]);

  const scaleLabel = (id: string) => {
    const s = scales.find((x) => x.id === id);
    return s ? `${s.name} ${s.version}` : id;
  };
  const scaleOptions = (current: string) => <>
    <option value="">Sélectionner…</option>
    {current && !scales.some((s) => s.id === current) && <option value={current}>Grille actuelle (non listée : {current})</option>}
    {scales.map((s) => <option key={s.id} value={s.id}>{s.name} {s.version} ({s.status})</option>)}
  </>;

  async function afterWrite() {
    await Promise.all([refreshList(), refreshDetail(selectedId)]);
  }

  async function run(action: () => Promise<void>, close: () => void) {
    setSaving(true); setFormError(null);
    try { await action(); close(); await afterWrite(); }
    catch (err) { setFormError(describeError(err)); if (isForbidden(err)) close(); }
    finally { setSaving(false); }
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await riskFrameworksApi.create(token, { name: createForm.name.trim(), description: createForm.description.trim() || null, ratingScaleId: createForm.ratingScaleId });
      setNotice("Dispositif créé avec un brouillon (paramètres par défaut du serveur).");
    }, () => setCreateOpen(false));
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    if (!editing || !draftForm || !detail) return;
    const patch = diffPatch(draftForm, editing);
    if (Object.keys(patch).length === 0) { setFormError("Aucune modification à enregistrer."); return; }
    void run(async () => { await riskFrameworksApi.updateDraft(token, detail.id, editing.id, patch); }, () => { setEditing(null); setDraftForm(null); });
  }

  function openReason(action: ReasonAction) {
    setReasonText(""); setFormError(null);
    if (action.kind === "identity" && detail) setIdentity({ name: detail.name, description: detail.description ?? "" });
    setReasonAction(action);
  }

  function submitReason(event: FormEvent) {
    event.preventDefault();
    const action = reasonAction;
    if (!action || !detail) return;
    const text = reasonText.trim();
    void run(async () => {
      if (action.kind === "discard") await riskFrameworksApi.discardDraft(token, detail.id, action.version.id, text);
      else if (action.kind === "activate") { await riskFrameworksApi.requestActivation(token, detail.id, action.version.id, text); setNotice("Demande d'activation envoyée : un tiers doit la décider."); }
      else if (action.kind === "approve") await riskFrameworksApi.approve(token, action.request.id, text || undefined);
      else if (action.kind === "reject") await riskFrameworksApi.reject(token, action.request.id, text);
      else if (action.kind === "withdraw") await riskFrameworksApi.withdraw(token, action.request.id, text);
      else await riskFrameworksApi.updateIdentity(token, detail.id, { name: identity.name.trim(), description: identity.description.trim() || null, reason: text });
    }, () => setReasonAction(null));
  }

  async function newDraft() {
    if (!detail) return;
    setSaving(true); setNotice(null);
    try { await riskFrameworksApi.createDraft(token, detail.id); await afterWrite(); }
    catch (err) { setDetailError(describeError(err)); }
    finally { setSaving(false); }
  }

  const listColumns: TableColumn<FrameworkSummary>[] = [
    { key: "name", header: "Dispositif", render: (r) => <><strong>{r.name}</strong>{r.archivedAt && <div className="muted">Archivé</div>}</> },
    { key: "active", header: "Version active", render: (r) => r.activeVersion ? `v${r.activeVersion.versionNumber} · active depuis le ${dateOnly(r.activeVersion.activatedAt)}` : "Aucune version active" },
    { key: "mastery", header: "Indépendance sur la Maîtrise", render: (r) => r.activeVersion ? (r.activeVersion.reducedMasteryIndependence ? <StatusBadge label="Indépendance réduite" tone="warning" /> : <StatusBadge label="Non réduite" tone="neutral" />) : "—" },
    { key: "open", header: "", render: (r) => <Button onClick={() => { setSelectedId(r.id); setViewVersionId(null); setNotice(null); }} aria-label={`Voir le détail de ${r.name}`}>Détail</Button> },
  ];

  const versionColumns: TableColumn<FrameworkVersion>[] = [
    { key: "n", header: "Version", render: (v) => `v${v.versionNumber}` },
    { key: "status", header: "Statut", render: (v) => <StatusBadge label={STATUS_LABELS[v.status]} tone={STATUS_TONES[v.status]} /> },
    { key: "scale", header: "Grille de cotation", render: (v) => scaleLabel(v.ratingScaleId) },
    { key: "act", header: "Activée le", render: (v) => dateOnly(v.activatedAt) },
    { key: "mastery", header: "Maîtrise", render: (v) => v.reducedMasteryIndependence ? <StatusBadge label="Indépendance réduite" tone="warning" /> : "—" },
    { key: "actions", header: "", render: (v) => <div className="core-form-actions">
      <Button onClick={() => setViewVersionId(v.id)} aria-label={`Voir la version ${v.versionNumber}`}>Voir</Button>
      {v.status === "DRAFT" && <>
        <Button onClick={() => { setEditing(v); setDraftForm(toForm(v)); setFormError(null); }} aria-label={`Modifier le brouillon v${v.versionNumber}`}>Modifier</Button>
        <Button variant="primary" onClick={() => openReason({ kind: "activate", version: v })} aria-label={`Demander l'activation de v${v.versionNumber}`}>Demander l'activation</Button>
        <Button variant="destructive" onClick={() => openReason({ kind: "discard", version: v })} aria-label={`Abandonner le brouillon v${v.versionNumber}`}>Abandonner</Button>
      </>}
    </div> },
  ];

  const viewed = detail?.versions.find((v) => v.id === viewVersionId) ?? null;
  const reasonMeta = reasonAction ? REASON_TEXT[reasonAction.kind] : null;
  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => setDraftForm((f) => (f ? { ...f, [key]: value } : f));

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">RISQUES · DISPOSITIF</p>
        <h1>Dispositif de risque</h1>
        <p className="core-page__subtitle">Versions de la méthodologie. Une version active ne change que par une demande d'activation décidée par un tiers ; le serveur applique les droits et les règles.</p>
      </div>
      <Button variant="primary" onClick={() => { setCreateForm({ name: "", description: "", ratingScaleId: "" }); setFormError(null); setCreateOpen(true); }}>Nouveau Dispositif</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    {scalesUnavailable && <MessageBanner tone="info" title="Grilles de cotation indisponibles">Le droit de lecture des grilles est manquant ou l'API est injoignable : les identifiants de grille sont affichés et la création est impossible depuis cet écran.</MessageBanner>}
    <Card header={<strong>Dispositifs</strong>}>
      <Table columns={listColumns} rows={rows} rowKey={(r) => r.id} loading={loading} emptyMessage="Aucun Dispositif défini pour l'instant." />
    </Card>

    {selectedId && <Card
      header={<><strong>{detail?.name ?? "Dispositif"}</strong>{detail?.archivedAt && <> <StatusBadge label="Archivé" tone="neutral" /></>}</>}
      footer={detail && !detail.archivedAt ? <><Button onClick={() => openReason({ kind: "identity" })}>Modifier nom et description</Button><Button onClick={() => void newDraft()} disabled={saving}>Nouveau brouillon depuis la version active</Button></> : undefined}
    >
      {detailError && <MessageBanner tone="danger" title="Erreur">{detailError}</MessageBanner>}
      {detail?.description && <p className="muted">{detail.description}</p>}
      {requestsError && <MessageBanner tone="info" title="Demandes en attente indisponibles">{requestsError}</MessageBanner>}
      {requests.length > 0 && <>
        <h2 className="core-panel__head">Demandes en attente</h2>
        <Table
          columns={[
            { key: "reason", header: "Motif", render: (q: ChangeRequest) => q.reason },
            { key: "version", header: "Version", render: (q: ChangeRequest) => { const v = detail?.versions.find((x) => x.id === q.versionId); return v ? `v${v.versionNumber}` : "—"; } },
            { key: "date", header: "Demandée le", render: (q: ChangeRequest) => dateOnly(q.createdAt) },
            { key: "decide", header: "", render: (q: ChangeRequest) => <div className="core-form-actions">
              <Button variant="primary" onClick={() => openReason({ kind: "approve", request: q })}>Approuver</Button>
              <Button variant="destructive" onClick={() => openReason({ kind: "reject", request: q })}>Refuser</Button>
              <Button onClick={() => openReason({ kind: "withdraw", request: q })}>Retirer</Button>
            </div> },
          ]}
          rows={requests}
          rowKey={(q) => q.id}
          loading={false}
          emptyMessage=""
        />
        <MessageBanner tone="info">Les boutons sont toujours proposés : le serveur refuse si vous êtes le demandeur, un contributeur de la version, ou n'avez pas le droit de décider. Un vote Comité/Audit n'est pas encore disponible.</MessageBanner>
      </>}
      <Table columns={versionColumns} rows={detail?.versions ?? []} rowKey={(v) => v.id} loading={detailLoading} emptyMessage="Aucune version." />
      {viewed && <div className="core-panel__body" aria-live="polite">
        <h2>Version v{viewed.versionNumber} · {STATUS_LABELS[viewed.status]}</h2>
        {viewed.reducedMasteryIndependence && <MessageBanner tone="warning" title="Indépendance réduite sur la Maîtrise">Selon le serveur, la saisie de la première ligne fait foi pour la Maîtrise dans cette version.</MessageBanner>}
        <dl>
          <dt>Grille de cotation</dt><dd>{scaleLabel(viewed.ratingScaleId)}</dd>
          <dt>Mode d'évaluation par défaut</dt><dd>{MODE_LABELS[viewed.defaultEvaluationMode]}</dd>
          <dt>Seuil Comité (évaluation)</dt><dd>{viewed.committeeEvaluationMinScore} · appliqué : {yesNo(viewed.committeeEvaluationEnforced)}</dd>
          <dt>Seuil Comité (traitement)</dt><dd>{orDash(viewed.committeeTreatmentMinScore)}</dd>
          <dt>Approbateur des changements</dt><dd>{viewed.changeApprover}</dd>
          <dt>Auto-proposition autorisée</dt><dd>{yesNo(viewed.selfProposalAllowed)}</dd>
          <dt>Seuil de criticité « faible »</dt><dd>{orDash(viewed.lowCriticalityThreshold)}</dd>
          <dt>Risk Owner exécutant (cumul)</dt><dd>{yesNo(viewed.riskOwnerExecutorCumulAllowed)}</dd>
          <dt>Délégué exécutant (cumul)</dt><dd>{yesNo(viewed.delegateExecutorCumulAllowed)}</dd>
          <dt>Durée maximale de délégation (jours)</dt><dd>{orDash(viewed.delegationMaxDays)}</dd>
          <dt>Politique hybride</dt><dd>{yesNo(viewed.hybridPolicyEnabled)}</dd>
          <dt>Source faisant foi pour la Maîtrise</dt><dd>{MASTERY_LABELS[viewed.masteryAuthoritativeSource]}</dd>
          <dt>Règle de vote du Comité</dt><dd>{viewed.committeeVoteRule}</dd>
        </dl>
        <h3>Seuils d'appétence ({viewed.appetiteThresholds.length})</h3>
        <Table
          columns={[
            { key: "sub", header: "Sous-catégorie", render: (a) => a.subCategory },
            { key: "entity", header: "Entité", render: (a) => a.entity ?? "—" },
            { key: "thr", header: "Seuil", render: (a) => a.threshold },
          ]}
          rows={viewed.appetiteThresholds}
          rowKey={(a) => `${a.subCategory}|${a.entity ?? ""}`}
          loading={false}
          emptyMessage="Aucun seuil d'appétence dans cette version."
        />
      </div>}
    </Card>}

    <FormModal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau Dispositif" formId="fw-create" saving={saving} submitLabel="Créer">
      <form id="fw-create" onSubmit={submitCreate}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Nom *" htmlFor="fw-name"><input id="fw-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required maxLength={120} /></FormField>
        <FormField label="Description" htmlFor="fw-desc"><textarea id="fw-desc" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} maxLength={1000} /></FormField>
        <FormField label="Grille de cotation *" htmlFor="fw-scale" help="Les autres paramètres reçoivent les valeurs par défaut du serveur ; ils se règlent ensuite dans le brouillon.">
          <select id="fw-scale" value={createForm.ratingScaleId} onChange={(e) => setCreateForm({ ...createForm, ratingScaleId: e.target.value })} required>{scaleOptions(createForm.ratingScaleId)}</select>
        </FormField>
      </form>
    </FormModal>

    <FormModal open={editing !== null} onClose={() => { setEditing(null); setDraftForm(null); }} title={editing ? `Modifier le brouillon v${editing.versionNumber}` : "Modifier le brouillon"} formId="fw-draft" saving={saving} submitLabel="Enregistrer">
      {draftForm && <form id="fw-draft" onSubmit={submitDraft}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <MessageBanner tone="info">Les seuils d'appétence ne sont pas modifiables depuis cet écran ; ils restent tels que dans le brouillon.</MessageBanner>
        <FormField label="Grille de cotation" htmlFor="fd-scale"><select id="fd-scale" value={draftForm.ratingScaleId} onChange={(e) => set("ratingScaleId", e.target.value)}>{scaleOptions(draftForm.ratingScaleId)}</select></FormField>
        <FormField label="Mode d'évaluation par défaut" htmlFor="fd-mode"><select id="fd-mode" value={draftForm.defaultEvaluationMode} onChange={(e) => set("defaultEvaluationMode", e.target.value as EvaluationMode)}>{Object.entries(MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
        <FormField label="Seuil Comité (évaluation) *" htmlFor="fd-cemin"><input id="fd-cemin" type="number" min={1} max={36} value={draftForm.committeeEvaluationMinScore} onChange={(e) => set("committeeEvaluationMinScore", e.target.value)} required /></FormField>
        <label className="core-filter"><input type="checkbox" checked={draftForm.committeeEvaluationEnforced} onChange={(e) => set("committeeEvaluationEnforced", e.target.checked)} /> Seuil Comité appliqué</label>
        <FormField label="Seuil Comité (traitement)" htmlFor="fd-ctmin" help="Vide : aucun seuil."><input id="fd-ctmin" type="number" min={1} max={36} value={draftForm.committeeTreatmentMinScore} onChange={(e) => set("committeeTreatmentMinScore", e.target.value)} /></FormField>
        <FormField label="Seuil de criticité « faible »" htmlFor="fd-low" help="Aucune valeur par défaut : obligatoire pour demander l'activation."><input id="fd-low" type="number" min={1} max={36} value={draftForm.lowCriticalityThreshold} onChange={(e) => set("lowCriticalityThreshold", e.target.value)} /></FormField>
        <FormField label="Approbateur des changements" htmlFor="fd-appr" help="Le serveur n'accepte pour l'instant que le Risk Manager (vote Comité/Audit à venir)."><select id="fd-appr" value="RISK_MANAGER" disabled><option value="RISK_MANAGER">RISK_MANAGER</option></select></FormField>
        <label className="core-filter"><input type="checkbox" checked={draftForm.selfProposalAllowed} onChange={(e) => set("selfProposalAllowed", e.target.checked)} /> Auto-proposition autorisée</label>
        <label className="core-filter"><input type="checkbox" checked={draftForm.riskOwnerExecutorCumulAllowed} onChange={(e) => set("riskOwnerExecutorCumulAllowed", e.target.checked)} /> Cumul Risk Owner / exécutant autorisé</label>
        <label className="core-filter"><input type="checkbox" checked={draftForm.delegateExecutorCumulAllowed} onChange={(e) => set("delegateExecutorCumulAllowed", e.target.checked)} /> Cumul Délégué / exécutant autorisé</label>
        <FormField label="Durée maximale de délégation (jours)" htmlFor="fd-deleg" help="Vide : aucun plafond."><input id="fd-deleg" type="number" min={1} max={3650} value={draftForm.delegationMaxDays} onChange={(e) => set("delegationMaxDays", e.target.value)} /></FormField>
        <label className="core-filter"><input type="checkbox" checked={draftForm.hybridPolicyEnabled} onChange={(e) => set("hybridPolicyEnabled", e.target.checked)} /> Politique hybride activée</label>
        <FormField label="Source faisant foi pour la Maîtrise" htmlFor="fd-mastery"><select id="fd-mastery" value={draftForm.masteryAuthoritativeSource} onChange={(e) => set("masteryAuthoritativeSource", e.target.value as MasterySource)}>{Object.entries(MASTERY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>
        <FormField label="Règle de vote du Comité" htmlFor="fd-vote"><select id="fd-vote" value={draftForm.committeeVoteRule} onChange={(e) => set("committeeVoteRule", e.target.value as VoteRule)}>
          {draftForm.committeeVoteRule === "CUSTOM" && <option value="CUSTOM">CUSTOM (non modifiable)</option>}
          {VOTE_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select></FormField>
      </form>}
    </FormModal>

    <FormModal open={reasonAction !== null} onClose={() => setReasonAction(null)} title={reasonMeta?.title ?? ""} formId="fw-reason" saving={saving} submitLabel={reasonMeta?.submit ?? "Valider"}>
      <form id="fw-reason" onSubmit={submitReason}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        {reasonAction?.kind === "identity" && <>
          <FormField label="Nom" htmlFor="fi-name"><input id="fi-name" value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} required maxLength={120} /></FormField>
          <FormField label="Description" htmlFor="fi-desc"><textarea id="fi-desc" value={identity.description} onChange={(e) => setIdentity({ ...identity, description: e.target.value })} maxLength={1000} /></FormField>
        </>}
        <FormField label={reasonMeta?.label ?? ""} htmlFor="fw-reason-text"><textarea id="fw-reason-text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} required={reasonMeta?.required} maxLength={reasonAction?.kind === "approve" || reasonAction?.kind === "reject" ? 1000 : 500} /></FormField>
      </form>
    </FormModal>
  </section>;
}
