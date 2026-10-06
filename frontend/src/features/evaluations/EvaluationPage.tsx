import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Timeline, type TimelineItem } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import {
  evaluationsApi, ratingScalesApi,
  type AppetiteComparison, type EvaluationContext, type EvaluationStatus, type EvaluationType,
  type MasteryLineScore, type RatingScale, type RiskEvaluation,
} from "../../api/evaluations";
import { risksApi, type Risk } from "../../api/risks";
import {
  decisionsForEvaluation, treatmentDecisionsApi, TREATMENT_OPTIONS,
  type TreatmentDecision, type TreatmentDecisionStatus, type TreatmentOption,
} from "../../api/treatmentDecisions";
import { usersApi, type UserSummary } from "../../api/users";
import "./EvaluationPage.css";

interface EvaluationPageProps { token: string; initialRiskId?: string; }

const STATUS: Record<EvaluationStatus, { label: string; tone: "neutral" | "success" | "danger" | "warning" }> = {
  BROUILLON: { label: "Brouillon", tone: "warning" },
  VALIDATED: { label: "Validée", tone: "success" },
  VALIDE_COMITE: { label: "Validée en comité", tone: "success" },
  REJECTED: { label: "Rejetée", tone: "danger" },
};
const TYPE_LABEL: Record<EvaluationType, string> = {
  AD_HOC: "Ponctuelle", ANNUELLE: "Annuelle", ANTICIPEE: "Anticipée",
};
const EVALUATION_MODE_LABEL: Record<string, string> = {
  CLASSIQUE: "Classique", PARTICIPATIF: "Participatif",
};
const AUTHORITATIVE_STATUSES: EvaluationStatus[] = ["VALIDATED", "VALIDE_COMITE"];
const TREATMENT_OPTION_LABEL: Record<TreatmentOption, string> = {
  ACCEPTER: "Accepter", SURVEILLER: "Surveiller", REDUIRE: "Réduire", TRANSFERER: "Transférer", EVITER: "Éviter",
};
const TREATMENT_STATUS: Record<TreatmentDecisionStatus, { label: string; tone: "neutral" | "success" | "danger" | "warning" }> = {
  PROPOSEE: { label: "Proposée", tone: "warning" },
  CONFIRMEE: { label: "Confirmée", tone: "success" },
  INVALIDEE: { label: "Invalidée", tone: "danger" },
  VALIDEE_COMITE: { label: "Validée en comité", tone: "success" },
};
const describeError = (error: unknown) =>
  error instanceof ApiError ? `${error.message}${error.requestId ? ` (réf. ${error.requestId})` : ""}`
    : error instanceof Error ? error.message : "Une erreur inattendue est survenue.";

export function EvaluationPage({ token, initialRiskId }: EvaluationPageProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [scales, setScales] = useState<RatingScale[]>([]);
  const [selectedRiskId, setSelectedRiskId] = useState("");
  const [evaluations, setEvaluations] = useState<RiskEvaluation[]>([]);
  const [selectedEvaluationId, setSelectedEvaluationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Identification context (§4) — Risk Owner display. Directory read
  // requires "user.read"; a 403 degrades to showing the raw id (same
  // posture as RaciPanel), never a fatal error.
  const [userDirectory, setUserDirectory] = useState<Record<string, UserSummary>>({});

  // Analyse context (§4, DIV-07) — covering controls + their last known
  // effectiveness. Read-only, informs the human mastery judgement, never
  // feeds a computed mastery score.
  const [context, setContext] = useState<EvaluationContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  // ACT-160 — residual vs applicable appetite threshold, with its source
  // (override vs auto-suggested vs none). Fetched once residual is scored.
  const [appetiteComparison, setAppetiteComparison] = useState<AppetiteComparison | null>(null);

  // Treatment Decision (§8/§12, Lot C) — proposed/tracked on the parent
  // evaluation once it is authoritative. Fetched per risk (the only real
  // GET contract is riskId-scoped); the per-evaluation view is derived
  // client-side via decisionsForEvaluation.
  const [treatmentDecisions, setTreatmentDecisions] = useState<TreatmentDecision[]>([]);
  const [treatmentDecisionsError, setTreatmentDecisionsError] = useState<string | null>(null);
  const [treatmentOption, setTreatmentOption] = useState<TreatmentOption>("ACCEPTER");
  const [treatmentJustification, setTreatmentJustification] = useState("");
  const [treatmentActionComment, setTreatmentActionComment] = useState("");
  const [treatmentSaving, setTreatmentSaving] = useState(false);
  const [treatmentError, setTreatmentError] = useState<string | null>(null);
  const [treatmentNotice, setTreatmentNotice] = useState<string | null>(null);

  const [evaluationType, setEvaluationType] = useState<EvaluationType>("ANNUELLE");
  const [subCategory, setSubCategory] = useState("");
  const [entity, setEntity] = useState("");
  const [probability, setProbability] = useState(3);
  const [inherentImpacts, setInherentImpacts] = useState<Record<string, number>>({});
  const [mastery, setMastery] = useState<Record<string, { adequacy: number; execution: number; effectiveness: number }>>({});
  const [residualProbability, setResidualProbability] = useState(2);
  const [residualImpacts, setResidualImpacts] = useState<Record<string, number>>({});
  const [residualJustification, setResidualJustification] = useState("");
  const [appetiteOverride, setAppetiteOverride] = useState("");
  const [decisionComment, setDecisionComment] = useState("");

  // Guides the user to the existing "Valider en Comité" action when the
  // backend refuses the ordinary validate() because the residual score is
  // at/above the configured Comité threshold (see RiskEvaluationService.validate,
  // ACT-253). The frontend never recomputes that threshold itself — it only
  // reacts to the backend's own refusal message.
  const [highlightCommittee, setHighlightCommittee] = useState(false);
  const committeeActionRef = useRef<HTMLDivElement | null>(null);

  const selectedRisk = risks.find((risk) => risk.id === selectedRiskId);
  const selectedEvaluation = evaluations.find((evaluation) => evaluation.id === selectedEvaluationId);
  const activeScale = scales.find((scale) => scale.status === "ACTIVE") ?? null;
  const axes = useMemo(() => [...(activeScale?.impactAxes?.axes ?? [])].sort((a, b) => a.order - b.order), [activeScale]);
  const probabilityLevels = activeScale?.probabilityLabels ?? Array.from({ length: activeScale?.probabilityLevels ?? 5 }, (_, i) => ({ level: i + 1, label: `Niveau ${i + 1}` }));
  const impactLevels = activeScale?.impactLabels ?? Array.from({ length: activeScale?.impactLevels ?? 5 }, (_, i) => ({ level: i + 1, label: `Niveau ${i + 1}` }));
  const masteryScale = activeScale?.masteryScale;
  const isDraft = selectedEvaluation?.status === "BROUILLON";
  const ownerLabel = selectedRisk?.ownerId
    ? userDirectory[selectedRisk.ownerId]?.displayName ?? selectedRisk.ownerId
    : "Non assigné";
  const isAuthoritative = !!selectedEvaluation && AUTHORITATIVE_STATUSES.includes(selectedEvaluation.status);
  const evaluationDecisions = selectedEvaluationId ? decisionsForEvaluation(treatmentDecisions, selectedEvaluationId) : [];
  const activeTreatmentDecision = evaluationDecisions[0] ?? null;
  const treatmentDecisionHistory = evaluationDecisions.slice(1);
  const resolveUser = (id: string | null) => (id ? userDirectory[id]?.displayName ?? id : "—");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        const [riskData, scaleData] = await Promise.all([risksApi.list(token), ratingScalesApi.list(token)]);
        if (cancelled) return;
        setRisks(riskData.filter((risk) => risk.status !== "ARCHIVED"));
        setScales(scaleData);
        if (!selectedRiskId) setSelectedRiskId(initialRiskId ?? riskData.find((risk) => risk.status !== "ARCHIVED")?.id ?? "");
      } catch (err) { if (!cancelled) setError(describeError(err)); }
      finally { if (!cancelled) setLoading(false); }
      // Best-effort — most evaluators won't carry "user.read"; degrade to
      // raw ids rather than blocking the page (see usersApi doc comment).
      try {
        const users = await usersApi.list(token);
        if (cancelled) return;
        setUserDirectory(Object.fromEntries(users.map((u) => [u.id, u])));
      } catch { /* no directory available — ids are shown verbatim */ }
    }
    void load();
    return () => { cancelled = true; };
    // The initial list is intentionally loaded once per authenticated token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialRiskId]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      if (!selectedRiskId) { setEvaluations([]); setSelectedEvaluationId(""); setTreatmentDecisions([]); return; }
      try {
        const rows = await evaluationsApi.listForRisk(token, selectedRiskId);
        if (cancelled) return;
        setEvaluations(rows);
        setSelectedEvaluationId((current) => rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? ""));
      } catch (err) { if (!cancelled) setError(describeError(err)); }
      // Best-effort — not every evaluator carries "treatmentdecision.read";
      // degrade to an empty list rather than blocking the page.
      try {
        const decisions = await treatmentDecisionsApi.listForRisk(token, selectedRiskId);
        if (!cancelled) { setTreatmentDecisions(decisions); setTreatmentDecisionsError(null); }
      } catch (err) {
        if (!cancelled) { setTreatmentDecisions([]); setTreatmentDecisionsError(describeError(err)); }
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [token, selectedRiskId]);

  useEffect(() => {
    if (!selectedEvaluation) return;
    const inherent: Record<string, number> = {};
    const residual: Record<string, number> = {};
    const masteryValues: Record<string, { adequacy: number; execution: number; effectiveness: number }> = {};
    axes.forEach((axis) => {
      inherent[axis.code] = selectedEvaluation.inherentImpacts?.find((item) => item.code === axis.code)?.value ?? 1;
      residual[axis.code] = selectedEvaluation.residualImpacts?.find((item) => item.code === axis.code)?.value ?? 1;
    });
    (masteryScale?.defenseLines ?? []).forEach((line) => {
      const saved = selectedEvaluation.masteryLines?.find((item) => item.line === line);
      masteryValues[line] = { adequacy: saved?.adequacy ?? 2, execution: saved?.execution ?? 2, effectiveness: saved?.effectiveness ?? 2 };
    });
    setProbability(selectedEvaluation.inherentProbability ?? Math.min(3, activeScale?.probabilityLevels ?? 5));
    setResidualProbability(selectedEvaluation.residualProbability ?? Math.min(2, activeScale?.probabilityLevels ?? 5));
    setInherentImpacts(inherent); setResidualImpacts(residual); setMastery(masteryValues);
    setResidualJustification(selectedEvaluation.residualJustification ?? "");
    setAppetiteOverride(selectedEvaluation.appetiteThresholdOverride === null ? "" : String(selectedEvaluation.appetiteThresholdOverride));
    setDecisionComment("");
    setTreatmentJustification(""); setTreatmentActionComment(""); setTreatmentError(null); setTreatmentNotice(null);
  }, [selectedEvaluationId, selectedEvaluation?.id, activeScale?.id]);

  // Analyse context (DIV-07): fetched per selected evaluation, read-only.
  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      if (!selectedEvaluationId) { setContext(null); setContextError(null); return; }
      try {
        const data = await evaluationsApi.getContext(token, selectedEvaluationId);
        if (!cancelled) { setContext(data); setContextError(null); }
      } catch (err) {
        if (!cancelled) { setContext(null); setContextError(describeError(err)); }
      }
    }
    void loadContext();
    return () => { cancelled = true; };
  }, [token, selectedEvaluationId]);

  // ACT-160: comparison to appetite, available once residual is scored.
  useEffect(() => {
    let cancelled = false;
    async function loadComparison() {
      if (!selectedEvaluationId || selectedEvaluation?.residualScore === null || selectedEvaluation?.residualScore === undefined) {
        setAppetiteComparison(null);
        return;
      }
      try {
        const data = await evaluationsApi.compareToAppetite(token, selectedEvaluationId);
        if (!cancelled) setAppetiteComparison(data);
      } catch { if (!cancelled) setAppetiteComparison(null); }
    }
    void loadComparison();
    return () => { cancelled = true; };
  }, [token, selectedEvaluationId, selectedEvaluation?.residualScore]);

  async function refreshHistory(preferredId?: string) {
    if (!selectedRiskId) return;
    const rows = await evaluationsApi.listForRisk(token, selectedRiskId);
    setEvaluations(rows);
    const nextId = preferredId ?? selectedEvaluationId;
    setSelectedEvaluationId(rows.some((row) => row.id === nextId) ? nextId : (rows[0]?.id ?? ""));
  }

  async function refreshTreatmentDecisions() {
    if (!selectedRiskId) return;
    try {
      const rows = await treatmentDecisionsApi.listForRisk(token, selectedRiskId);
      setTreatmentDecisions(rows);
      setTreatmentDecisionsError(null);
    } catch (err) {
      setTreatmentDecisions([]);
      setTreatmentDecisionsError(describeError(err));
    }
  }

  async function proposeTreatmentDecision(event: FormEvent) {
    event.preventDefault();
    if (!selectedEvaluation) return;
    setTreatmentSaving(true); setTreatmentError(null); setTreatmentNotice(null);
    try {
      await treatmentDecisionsApi.create(token, {
        riskEvaluationId: selectedEvaluation.id,
        option: treatmentOption,
        justification: treatmentJustification.trim(),
      });
      await refreshTreatmentDecisions();
      setTreatmentJustification("");
      setTreatmentNotice("Décision de traitement proposée.");
    } catch (err) { setTreatmentError(describeError(err)); }
    finally { setTreatmentSaving(false); }
  }

  async function performTreatmentAction(action: () => Promise<TreatmentDecision>, message: string) {
    setTreatmentSaving(true); setTreatmentError(null); setTreatmentNotice(null);
    try {
      await action();
      await refreshTreatmentDecisions();
      setTreatmentActionComment("");
      setTreatmentNotice(message);
    } catch (err) { setTreatmentError(describeError(err)); }
    finally { setTreatmentSaving(false); }
  }

  async function createEvaluation(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const created = await evaluationsApi.create(token, {
        riskId: selectedRiskId, evaluationType, subCategory: subCategory.trim(), entity: entity.trim() || null,
      });
      await refreshHistory(created.id);
      setNotice("Évaluation créée. Tu peux maintenant renseigner la cotation inhérente, la maîtrise et le résiduel.");
      setSubCategory(""); setEntity("");
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  async function perform(action: () => Promise<RiskEvaluation>, message: string) {
    if (!selectedEvaluation) return;
    setSaving(true); setError(null); setNotice(null); setHighlightCommittee(false);
    try {
      const updated = await action();
      await refreshHistory(updated.id);
      setNotice(message);
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  // The ordinary validate() refuses server-side when the residual score is
  // at/above the configured Comité threshold — the backend's own message
  // already names the "validate-committee" endpoint as the way forward.
  // Reused verbatim rather than rewritten, so the two never diverge; the
  // frontend only matches on that marker, it never recomputes the threshold.
  async function handleValidate() {
    if (!selectedEvaluation) return;
    setSaving(true); setError(null); setNotice(null); setHighlightCommittee(false);
    try {
      const updated = await evaluationsApi.validate(token, selectedEvaluation.id, decisionComment.trim());
      await refreshHistory(updated.id);
      setNotice("Évaluation validée.");
    } catch (err) {
      if (err instanceof ApiError && err.message.includes("validate-committee")) {
        setError(err.message);
        setHighlightCommittee(true);
        committeeActionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setError(describeError(err));
      }
    } finally { setSaving(false); }
  }

  const selectedImpactPayload = (values: Record<string, number>) => axes.map((axis) => ({ code: axis.code, value: values[axis.code] ?? 1 }));
  const scorePreview = (p: number, values: Record<string, number>) => {
    if (!values || !axes.length || activeScale?.impactAxes?.retainedImpactRule === "WEIGHTED_SUM") return null;
    const vals = axes.map((axis) => values[axis.code] ?? 1);
    const retained = activeScale?.impactAxes?.retainedImpactRule === "AVERAGE"
      ? vals.reduce((sum, value) => sum + value, 0) / vals.length
      : Math.max(...vals);
    return { retained, score: p * retained };
  };
  const inherentPreview = scorePreview(probability, inherentImpacts);
  const residualPreview = scorePreview(residualProbability, residualImpacts);

  function renderImpactFields(values: Record<string, number>, setValues: (value: Record<string, number>) => void, prefix: string) {
    if (!axes.length) return <p className="eval-muted">Aucun axe d'impact n'est configuré dans la grille active.</p>;
    return <div className="eval-impact-grid">{axes.map((axis) => (
      <FormField key={axis.code} label={axis.label} htmlFor={`${prefix}-${axis.code}`}>
        <select id={`${prefix}-${axis.code}`} value={values[axis.code] ?? 1}
          onChange={(event) => setValues({ ...values, [axis.code]: Number(event.target.value) })}>
          {impactLevels.map((level) => <option key={level.level} value={level.level}>{level.level} · {level.label}</option>)}
        </select>
      </FormField>
    ))}</div>;
  }

  function renderProbability(label: string, value: number, onChange: (value: number) => void) {
    return <FormField label={label} htmlFor={label === "Probabilité inhérente" ? "inherent-probability" : "residual-probability"}>
      <select id={label === "Probabilité inhérente" ? "inherent-probability" : "residual-probability"} value={value}
        onChange={(event) => onChange(Number(event.target.value))}>
        {probabilityLevels.map((level) => <option key={level.level} value={level.level}>{level.level} · {level.label}</option>)}
      </select>
    </FormField>;
  }

  // Timeline (design system) replaces the previous hand-coded step list —
  // "done/current/pending" states for the four cotation/décision steps
  // of the currently selected evaluation.
  const steps: TimelineItem[] = selectedEvaluation ? (() => {
    const inherentDone = selectedEvaluation.inherentScore !== null;
    const masteryDone = !!selectedEvaluation.masteryLines?.length;
    const residualDone = selectedEvaluation.residualScore !== null;
    const decisionDone = selectedEvaluation.status !== "BROUILLON";
    const stateFor = (done: boolean, isNext: boolean): "done" | "current" | "pending" =>
      done ? "done" : isNext ? "current" : "pending";
    return [
      { label: "Risque inhérent", detail: "Cotation retenue — Risk Owner", state: stateFor(inherentDone, !inherentDone) },
      { label: "Maîtrise", detail: "Cotation retenue — Risk Owner", state: stateFor(masteryDone, inherentDone && !masteryDone) },
      { label: "Risque résiduel", detail: "Cotation retenue — Risk Owner", state: stateFor(residualDone, inherentDone && masteryDone && !residualDone) },
      { label: "Décision de validation", detail: "Maker-checker — jamais l'évaluateur", state: stateFor(decisionDone, inherentDone && masteryDone && residualDone && !decisionDone) },
    ];
  })() : [];

  if (loading) return <div className="eval-page"><div className="eval-skeleton" aria-label="Chargement des évaluations" /></div>;

  return (
    <section className="eval-page">
      <div className="eval-pagehead">
        <div><p className="eval-eyebrow">GOUVERNANCE · RISQUES</p><h1>Évaluation des risques</h1>
          <p className="eval-subtitle">Coter le risque, documenter la maîtrise et suivre le risque résiduel.</p></div>
        <div className="eval-pagehead-badges"><span className="eval-mode-chip">{selectedEvaluation?.evaluationMode ? EVALUATION_MODE_LABEL[selectedEvaluation.evaluationMode] ?? selectedEvaluation.evaluationMode : "Mode à la création"}</span>
          <span className="eval-mode-chip">{activeScale ? `Méthode ${activeScale.version}` : "Grille non configurée"}</span></div>
      </div>

      {error && <MessageBanner tone="danger">{error}</MessageBanner>}
      {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
      {!activeScale && <MessageBanner tone="warning">Aucune grille de cotation active n'est disponible. Configure et active une grille avant de saisir les scores.</MessageBanner>}
      {activeScale?.impactAxes?.retainedImpactRule === "WEIGHTED_SUM" && <MessageBanner tone="warning">La règle d'impact retenu « somme pondérée » n'est pas encore prise en charge par le moteur de cotation. Configure une règle MAX ou AVERAGE avant de saisir les scores.</MessageBanner>}

      <div className="eval-context-bar">
        <FormField label="Risque à évaluer" htmlFor="eval-risk-select">
          <select id="eval-risk-select" value={selectedRiskId} onChange={(event) => setSelectedRiskId(event.target.value)}>
            <option value="">Sélectionner un risque</option>
            {risks.map((risk) => <option key={risk.id} value={risk.id}>{risk.process} — {risk.description}</option>)}
          </select>
        </FormField>
        {selectedRisk && <div className="eval-risk-context"><span className="eval-risk-dot" /><div><strong>{selectedRisk.process}</strong><span>{selectedRisk.description}</span></div><StatusBadge label={selectedRisk.status === "ACTIVE" ? "Actif" : "Brouillon"} tone={selectedRisk.status === "ACTIVE" ? "success" : "neutral"} /></div>}
      </div>

      {selectedRisk && <Card className="eval-identification-card" header={<div className="eval-card-heading"><div><h2>Identification &amp; Analyse</h2><p>Contexte cumulatif hérité du risque — visible ici, non modifiable depuis l'évaluation.</p></div><span className="eval-step-pill">Contexte</span></div>}>
        <div className="eval-identification-grid">
          <div className="eval-identification-block">
            <span className="eval-identification-label">Identification — Risk Owner</span>
            <strong>{ownerLabel}</strong>
            <small>{selectedRisk.process} · {selectedRisk.description}</small>
          </div>
          <div className="eval-identification-block">
            <span className="eval-identification-label">Référentiel méthodologique</span>
            <strong>{activeScale ? `${activeScale.name} · ${activeScale.version}` : "Grille non configurée"}</strong>
            <small>Mode : {selectedEvaluation?.evaluationMode ? EVALUATION_MODE_LABEL[selectedEvaluation.evaluationMode] ?? selectedEvaluation.evaluationMode : "résolu à la création de l'évaluation"} (lecture seule)</small>
          </div>
          <div className="eval-identification-block eval-identification-wide">
            <span className="eval-identification-label">Analyse — Contrôles connus (dispositif de maîtrise)</span>
            {!selectedEvaluationId ? <small>Crée ou sélectionne une évaluation pour afficher les contrôles couvrant ce risque.</small>
              : contextError ? <small>{contextError}</small>
              : !context ? <small>Chargement…</small>
              : context.coveringControls.length === 0 ? <small>Aucun contrôle ne couvre ce risque à ce jour.</small>
              : <ul className="eval-controls-list">{context.coveringControls.map(({ control, lastEffectiveness }) => (
                  <li key={control.id}>
                    <strong>{control.label}</strong>
                    <span>{lastEffectiveness ? `Dernière efficacité : ${lastEffectiveness.operationalEffectiveness}` : "Jamais évalué"}</span>
                  </li>
                ))}</ul>}
          </div>
        </div>
        <div className="eval-gap-banner">
          <MessageBanner tone="info">
            Contributions (Signalement, Identification, Analyse, Inhérent, Maîtrise — §7) : capacité multi-acteurs prévue par le contrat métier, pas encore disponible côté backend (aucune entité Contribution). Non implémentée dans ce lot — en attente d'un contrat API dédié.
          </MessageBanner>
        </div>
      </Card>}

      <div className="eval-workspace">
        <div className="eval-main-column">
          <Card header={<div className="eval-card-heading"><div><h2>Nouvelle évaluation</h2><p>Chaque occurrence est historisée ; une évaluation finalisée n'est plus modifiable.</p></div><span className="eval-step-pill">01 · Créer</span></div>}>
            <form className="eval-create-form" onSubmit={createEvaluation}>
              <FormField label="Type d'évaluation" htmlFor="eval-type">
                <select id="eval-type" value={evaluationType} onChange={(event) => setEvaluationType(event.target.value as EvaluationType)}>
                  <option value="ANNUELLE">Annuelle</option><option value="AD_HOC">Ponctuelle</option><option value="ANTICIPEE">Anticipée</option>
                </select>
              </FormField>
              <FormField label="Sous-catégorie" htmlFor="eval-subcategory" help="Utilisée pour rechercher le seuil d'appétence applicable.">
                <input id="eval-subcategory" value={subCategory} onChange={(event) => setSubCategory(event.target.value)} required placeholder="Ex. : Fraude opérationnelle" />
              </FormField>
              <FormField label="Entité (facultatif)" htmlFor="eval-entity">
                <input id="eval-entity" value={entity} onChange={(event) => setEntity(event.target.value)} placeholder="Ex. : Côte d'Ivoire" />
              </FormField>
              <Button type="submit" variant="primary" disabled={!selectedRiskId || !subCategory.trim() || saving}>Créer l'évaluation</Button>
            </form>
          </Card>

          <Card header={<div className="eval-card-heading"><div><h2>Historique des cycles de réévaluation</h2><p>{evaluations.length} occurrence(s) pour le risque sélectionné — une réévaluation est un nouveau cycle, jamais un écrasement</p></div><span className="eval-step-pill">02 · Historique</span></div>}>
            {!selectedRiskId ? <div className="eval-empty">Sélectionne un risque pour consulter son historique.</div>
              : evaluations.length === 0 ? <div className="eval-empty"><span className="eval-empty-icon">↗</span><strong>Aucune évaluation pour ce risque</strong><span>Crée une première occurrence ci-dessus pour démarrer la cotation.</span></div>
              : <div className="eval-history-list">{evaluations.map((evaluation, index) => {
                const status = STATUS[evaluation.status];
                const cycleNumber = evaluations.length - index;
                return <button type="button" key={evaluation.id} className={evaluation.id === selectedEvaluationId ? "eval-history-item selected" : "eval-history-item"} onClick={() => setSelectedEvaluationId(evaluation.id)}>
                  <span className="eval-history-icon">{evaluation.status === "BROUILLON" ? "◷" : "✓"}</span>
                  <span className="eval-history-main"><strong>Évaluation #{cycleNumber} · {TYPE_LABEL[evaluation.evaluationType]}</strong><small>{new Date(evaluation.createdAt).toLocaleDateString("fr-FR")} · {evaluation.subCategory}{evaluation.entity ? ` · ${evaluation.entity}` : ""}</small></span>
                  <span className="eval-history-score">{evaluation.residualScore ?? evaluation.inherentScore ?? "—"}</span>
                  <StatusBadge label={status.label} tone={status.tone} />
                </button>;
              })}</div>}
          </Card>
        </div>

        <aside className="eval-side-column">
          <Card header={<div className="eval-card-heading"><div><h2>Lecture rapide</h2><p>Scores calculés par le serveur.</p></div></div>}>
            <div className="eval-score-pair">
              <div className="eval-score-block"><span>Inhérent</span><strong>{selectedEvaluation?.inherentScore ?? "—"}</strong><small>{selectedEvaluation?.inherentProbability ?? "—"} × {selectedEvaluation?.inherentImpactRetained ?? "—"}</small></div>
              <div className="eval-score-arrow">→</div>
              <div className="eval-score-block residual"><span>Résiduel</span><strong>{selectedEvaluation?.residualScore ?? "—"}</strong><small>{selectedEvaluation?.residualProbability ?? "—"} × {selectedEvaluation?.residualImpactRetained ?? "—"}</small></div>
            </div>
            <div className="eval-summary-row"><span>Maîtrise globale (MIN non-compensatoire)</span><strong>{selectedEvaluation?.masteryGlobal === null || selectedEvaluation?.masteryGlobal === undefined ? "—" : selectedEvaluation.masteryGlobal.toFixed(2)}</strong></div>
            <div className="eval-summary-row"><span>Seuil d'appétence appliqué</span><strong>{appetiteComparison?.threshold ?? selectedEvaluation?.appetiteThresholdApplied ?? selectedEvaluation?.appetiteThresholdSuggested ?? "Non défini"}</strong></div>
            {appetiteComparison && <div className="eval-summary-row"><span>Source du seuil</span><strong>{appetiteComparison.source === "OVERRIDE" ? "Dérogation manuelle" : appetiteComparison.source === "AUTO" ? "Suggéré automatiquement" : "Aucun seuil applicable"}</strong></div>}
            {selectedEvaluation?.appetiteExceeded !== null && selectedEvaluation?.appetiteExceeded !== undefined &&
              <div className={selectedEvaluation.appetiteExceeded ? "eval-appetite-alert exceeded" : "eval-appetite-alert"}>{selectedEvaluation.appetiteExceeded ? "Seuil d'appétence dépassé" : "Sous le seuil d'appétence"}</div>}
            {selectedEvaluation?.appetiteExceeded && isAuthoritative && (
              <div className="eval-gap-banner">
                <MessageBanner tone="warning">
                  Seuil dépassé — une décision de traitement est attendue (voir la section « Décision de traitement » ci-dessous).
                </MessageBanner>
              </div>
            )}
            {selectedEvaluation && <div className="eval-summary-row"><span>Mode</span><strong>{selectedEvaluation.evaluationMode ? EVALUATION_MODE_LABEL[selectedEvaluation.evaluationMode] ?? selectedEvaluation.evaluationMode : "Historique non renseigné"}</strong></div>}
          </Card>
          <Card header={<div className="eval-card-heading"><div><h2>Étapes de cotation</h2><p>Une évaluation brouillon peut être complétée progressivement.</p></div></div>}>
            {selectedEvaluation ? <Timeline items={steps} /> : <p className="eval-muted">Sélectionne une évaluation pour suivre sa progression.</p>}
          </Card>
        </aside>
      </div>

      {selectedEvaluation && isAuthoritative && selectedEvaluation.appetiteExceeded && (
        <Card className="eval-treatment-card" header={
          <div className="eval-card-heading">
            <div><h2>Décision de traitement</h2><p>Déclenchée par le dépassement du seuil d'appétence sur cette évaluation (§8) — Accepter / Surveiller / Réduire / Transférer / Éviter.</p></div>
            {activeTreatmentDecision && <StatusBadge label={TREATMENT_STATUS[activeTreatmentDecision.status].label} tone={TREATMENT_STATUS[activeTreatmentDecision.status].tone} />}
          </div>
        }>
          {treatmentError && <MessageBanner tone="danger">{treatmentError}</MessageBanner>}
          {treatmentNotice && <MessageBanner tone="success">{treatmentNotice}</MessageBanner>}
          {treatmentDecisionsError && <MessageBanner tone="warning">{treatmentDecisionsError}</MessageBanner>}

          {!activeTreatmentDecision ? (
            <form className="eval-treatment-form" onSubmit={proposeTreatmentDecision}>
              <FormField label="Option de traitement" htmlFor="treatment-option">
                <select id="treatment-option" value={treatmentOption} onChange={(event) => setTreatmentOption(event.target.value as TreatmentOption)}>
                  {TREATMENT_OPTIONS.map((option) => <option key={option} value={option}>{TREATMENT_OPTION_LABEL[option]}</option>)}
                </select>
              </FormField>
              <FormField label="Justification" htmlFor="treatment-justification" help="Obligatoire — explique le choix de traitement retenu.">
                <textarea id="treatment-justification" rows={3} value={treatmentJustification} onChange={(event) => setTreatmentJustification(event.target.value)} required />
              </FormField>
              <Button type="submit" variant="primary" disabled={treatmentSaving || !treatmentJustification.trim()}>Proposer la décision</Button>
            </form>
          ) : activeTreatmentDecision.status === "PROPOSEE" ? (
            <div className="eval-treatment-active">
              <div className="eval-identification-grid">
                <div className="eval-identification-block">
                  <span className="eval-identification-label">Option proposée</span>
                  <strong>{TREATMENT_OPTION_LABEL[activeTreatmentDecision.option]}</strong>
                  <small>{activeTreatmentDecision.justification}</small>
                </div>
                <div className="eval-identification-block">
                  <span className="eval-identification-label">Validateur désigné</span>
                  <strong>{resolveUser(activeTreatmentDecision.validatorId)}</strong>
                  <small>Propriétaire supérieur du risque, figé au moment de la proposition</small>
                </div>
              </div>
              <FormField label="Commentaire (facultatif sauf invalidation)" htmlFor="treatment-comment">
                <input id="treatment-comment" value={treatmentActionComment} onChange={(event) => setTreatmentActionComment(event.target.value)} placeholder="Commentaire pour la traçabilité" />
              </FormField>
              <div className="eval-decision-actions">
                <Button variant="primary" disabled={treatmentSaving} onClick={() => void performTreatmentAction(() => treatmentDecisionsApi.confirm(token, activeTreatmentDecision.id, treatmentActionComment.trim() || null), "Décision de traitement confirmée.")}>Confirmer</Button>
                <Button disabled={treatmentSaving} onClick={() => { if (!treatmentActionComment.trim()) { setTreatmentError("Un commentaire est obligatoire pour invalider une décision de traitement."); return; } void performTreatmentAction(() => treatmentDecisionsApi.invalidate(token, activeTreatmentDecision.id, treatmentActionComment.trim()), "Décision de traitement invalidée."); }}>Invalider</Button>
                <Button disabled={treatmentSaving} onClick={() => void performTreatmentAction(() => treatmentDecisionsApi.validateByCommittee(token, activeTreatmentDecision.id, treatmentActionComment.trim() || null), "Décision de traitement validée en Comité.")}>Valider en Comité</Button>
              </div>
            </div>
          ) : (
            <div className="eval-finalized">
              <strong>Option retenue : {TREATMENT_OPTION_LABEL[activeTreatmentDecision.option]}</strong>
              <span>{activeTreatmentDecision.justification}</span>
              {activeTreatmentDecision.comment && <span>Commentaire : {activeTreatmentDecision.comment}</span>}
              <span>Validé par {resolveUser(activeTreatmentDecision.validatedBy)}{activeTreatmentDecision.validatedAt ? ` le ${new Date(activeTreatmentDecision.validatedAt).toLocaleDateString("fr-FR")}` : ""}</span>
            </div>
          )}

          {treatmentDecisionHistory.length > 0 && (
            <div className="eval-treatment-history">
              <span className="eval-identification-label">Tentatives précédentes sur cette évaluation</span>
              <div className="eval-history-list">
                {treatmentDecisionHistory.map((decision) => (
                  <div className="eval-history-item eval-treatment-history-item" key={decision.id}>
                    <span className="eval-history-main">
                      <strong>{TREATMENT_OPTION_LABEL[decision.option]}</strong>
                      <small>{new Date(decision.createdAt).toLocaleDateString("fr-FR")}{decision.comment ? ` · ${decision.comment}` : ""}</small>
                    </span>
                    <StatusBadge label={TREATMENT_STATUS[decision.status].label} tone={TREATMENT_STATUS[decision.status].tone} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {selectedEvaluation && <Card className="eval-scoring-card" header={<div className="eval-card-heading"><div><h2>Compléter l'évaluation</h2><p>{selectedEvaluation.subCategory} · {TYPE_LABEL[selectedEvaluation.evaluationType]}</p></div><StatusBadge label={STATUS[selectedEvaluation.status].label} tone={STATUS[selectedEvaluation.status].tone} /></div>}>
        {!isDraft ? <div className="eval-finalized"><strong>Cette évaluation est finalisée.</strong><span>Conformément au cycle de vie métier, une nouvelle cotation doit être créée pour modifier le score.</span>
            {selectedEvaluation.comment && <span>Commentaire de décision : {selectedEvaluation.comment}</span>}
          </div>
          : <>
            <div className="eval-scoring-grid">
              <section className="eval-scoring-section">
                <div className="eval-section-title"><span>01</span><div><h3>Risque inhérent</h3><p>Cotation retenue par le Risk Owner, avant prise en compte du dispositif de maîtrise.</p></div></div>
                {renderProbability("Probabilité inhérente", probability, setProbability)}
                {renderImpactFields(inherentImpacts, setInherentImpacts, "inherent")}
                <div className="eval-score-preview"><span>Score indicatif</span><strong>{inherentPreview ? inherentPreview.score.toFixed(1).replace(/\.0$/, "") : "—"}</strong><small>Probabilité × impact retenu · le serveur reste la référence</small></div>
                <Button disabled={saving || !activeScale?.impactAxes?.axes.length || activeScale?.impactAxes?.retainedImpactRule === "WEIGHTED_SUM"} onClick={() => perform(() => evaluationsApi.recordInherent(token, selectedEvaluation.id, probability, selectedImpactPayload(inherentImpacts)), "Cotation inhérente enregistrée.")}>Enregistrer l'inhérent</Button>
              </section>

              <section className="eval-scoring-section">
                <div className="eval-section-title"><span>02</span><div><h3>Évaluation de la maîtrise</h3><p>Appréciation humaine par ligne de défense (règle MIN non-compensatoire), jamais dérivée automatiquement des contrôles.</p></div></div>
                {!masteryScale?.defenseLines?.length ? <MessageBanner tone="warning">La grille active ne définit pas les lignes de défense pour la maîtrise.</MessageBanner>
                  : <div className="eval-mastery-table"><div className="eval-mastery-head"><span>Ligne</span><span>Adéquation</span><span>Exécution</span><span>Efficacité</span></div>
                    {masteryScale.defenseLines.map((line) => <div className="eval-mastery-row" key={line}><strong>{line}</strong>
                      {(["adequacy", "execution", "effectiveness"] as const).map((field) => <select aria-label={`${line} — ${field}`} key={field} value={mastery[line]?.[field] ?? 2} onChange={(event) => setMastery((current) => ({ ...current, [line]: { adequacy: current[line]?.adequacy ?? 2, execution: current[line]?.execution ?? 2, effectiveness: current[line]?.effectiveness ?? 2, [field]: Number(event.target.value) } }))}>
                        {(masteryScale.levels ?? [{ level: 1, label: "Inadéquat" }, { level: 2, label: "Partiel" }, { level: 3, label: "Adéquat" }]).map((level) => <option key={level.level} value={level.level}>{level.level} · {level.label}</option>)}
                      </select>)}
                    </div>)}
                  </div>}
                <Button disabled={saving || !masteryScale?.defenseLines?.length} onClick={() => perform(() => evaluationsApi.recordMastery(token, selectedEvaluation.id, (masteryScale?.defenseLines ?? []).map((line): MasteryLineScore => ({ line, adequacy: mastery[line]?.adequacy ?? 2, execution: mastery[line]?.execution ?? 2, effectiveness: mastery[line]?.effectiveness ?? 2 }))), "Évaluation de la maîtrise enregistrée.")}>Enregistrer la maîtrise</Button>
              </section>

              <section className="eval-scoring-section">
                <div className="eval-section-title"><span>03</span><div><h3>Risque résiduel</h3><p>Cotation retenue par le Risk Owner — réévaluation humaine après maîtrise, jamais dérivée par formule.</p></div></div>
                {renderProbability("Probabilité résiduelle", residualProbability, setResidualProbability)}
                {renderImpactFields(residualImpacts, setResidualImpacts, "residual")}
                <FormField label="Justification" htmlFor="residual-justification" help="Explique les facteurs ayant conduit au score résiduel.">
                  <textarea id="residual-justification" rows={3} value={residualJustification} onChange={(event) => setResidualJustification(event.target.value)} required />
                </FormField>
                <FormField label="Dérogation au seuil d'appétence (facultatif)" htmlFor="appetite-override" help="Laisse vide pour conserver le seuil proposé automatiquement.">
                  <input id="appetite-override" type="number" min="1" max="25" value={appetiteOverride} onChange={(event) => setAppetiteOverride(event.target.value)} />
                </FormField>
                <div className="eval-score-preview"><span>Score indicatif</span><strong>{residualPreview ? residualPreview.score.toFixed(1).replace(/\.0$/, "") : "—"}</strong><small>Score final recalculé par le serveur</small></div>
                <Button disabled={saving || !activeScale?.impactAxes?.axes.length || !residualJustification.trim()} onClick={() => perform(() => evaluationsApi.recordResidual(token, selectedEvaluation.id, residualProbability, selectedImpactPayload(residualImpacts), residualJustification.trim(), appetiteOverride === "" ? null : Number(appetiteOverride)), "Cotation résiduelle enregistrée.")}>Enregistrer le résiduel</Button>
              </section>
            </div>
            <div className="eval-decision-bar"><div><strong>Décision de validation (maker-checker)</strong><span>La validation est irréversible et ne peut jamais être réalisée par l'évaluateur lui-même. Vérifie les scores et la justification avant de confirmer.</span></div>
              <FormField label="Commentaire de décision (facultatif sauf rejet)" htmlFor="decision-comment"><input id="decision-comment" value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} placeholder="Commentaire pour la traçabilité" /></FormField>
              <div className="eval-decision-actions">
                <Button disabled={saving || selectedEvaluation.residualScore === null} onClick={() => void handleValidate()} variant="primary">Valider</Button>
                <div ref={committeeActionRef} className={highlightCommittee ? "eval-committee-highlight" : undefined}>
                  <Button disabled={saving || selectedEvaluation.residualScore === null} onClick={() => perform(() => evaluationsApi.validateByCommittee(token, selectedEvaluation.id, decisionComment.trim()), "Évaluation validée en Comité des Risques.")}>Valider en Comité</Button>
                </div>
                <Button disabled={saving} onClick={() => { if (!decisionComment.trim()) { setError("Un commentaire est obligatoire pour rejeter une évaluation."); return; } void perform(() => evaluationsApi.reject(token, selectedEvaluation.id, decisionComment.trim()), "Évaluation rejetée."); }}>Rejeter</Button>
              </div>
            </div>
          </>}
      </Card>}
    </section>
  );
}
