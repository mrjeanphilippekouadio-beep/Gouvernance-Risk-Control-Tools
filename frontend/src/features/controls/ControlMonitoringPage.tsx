import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { controlsApi, type Control } from "../../api/controls";
import { executionsApi, effectivenessApi, type ControlExecution, type EffectivenessAssessment, type ExecutionStatus, type EffectivenessRating, type EffectivenessResult } from "../../api/controlMonitoring";
import "../core/CorePages.css";

type Mode = "executions" | "effectiveness";
const executionLabels: Record<ExecutionStatus, string> = { DONE: "Réalisé", NOT_DONE: "Non réalisé", NOT_APPLICABLE: "Non applicable" };
const ratingLabels: Record<EffectivenessRating, string> = { EFFECTIVE: "Efficace", PARTIALLY_EFFECTIVE: "Partiellement efficace", INEFFECTIVE: "Inefficace" };
const resultLabels: Record<EffectivenessResult, string> = { ...ratingLabels, INCONCLUSIVE: "Non concluant" };
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const errorMessage = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";

interface Props { token: string; }

export function ControlMonitoringPage({ token }: Props) {
  const [mode, setMode] = useState<Mode>("executions");
  const [controls, setControls] = useState<Control[]>([]);
  const [controlId, setControlId] = useState("");
  const [executions, setExecutions] = useState<ControlExecution[]>([]);
  const [assessments, setAssessments] = useState<EffectivenessAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validatingId, setValidatingId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [status, setStatus] = useState<ExecutionStatus>("DONE");
  const [plannedDate, setPlannedDate] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [result, setResult] = useState("");
  const [observedAnomalies, setObservedAnomalies] = useState("");
  const [justification, setJustification] = useState("");
  const [rating, setRating] = useState<EffectivenessRating>("EFFECTIVE");
  const [assessmentResult, setAssessmentResult] = useState<EffectivenessResult>("EFFECTIVE");
  const [evalType, setEvalType] = useState("Périodique");
  const [designAdequacy, setDesignAdequacy] = useState("");
  const [executionQuality, setExecutionQuality] = useState("");
  const [limitations, setLimitations] = useState("");
  const [compensatingControls, setCompensatingControls] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [assessmentJustification, setAssessmentJustification] = useState("");

  const loadControls = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const items = (await controlsApi.list(token)).filter((item) => item.status !== "ARCHIVED");
      setControls(items);
      setControlId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [token]);

  const loadRecords = useCallback(async () => {
    if (!controlId) { setExecutions([]); setAssessments([]); return; }
    setError(null);
    try {
      if (mode === "executions") {
        setExecutions(await executionsApi.list(token, controlId));
      } else {
        setAssessments(await effectivenessApi.list(token, controlId));
      }
    } catch (err) { setError(errorMessage(err)); }
  }, [token, controlId, mode]);

  useEffect(() => { void loadControls(); }, [loadControls]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const activeControl = controls.find((item) => item.id === controlId);
  const doneCount = executions.filter((item) => item.status === "DONE").length;
  const pendingValidationCount = executions.filter((item) => !item.validatedAt).length;

  async function submitExecution(event: FormEvent) {
    event.preventDefault();
    if (!controlId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await executionsApi.create(token, {
        controlId, status, plannedDate: plannedDate || null, completedDate: completedDate || null,
        result: result.trim() || null, observedAnomalies: observedAnomalies.trim() || null,
        justificationIfNotDone: justification.trim() || null,
      });
      setResult(""); setObservedAnomalies(""); setJustification("");
      setNotice("Exécution enregistrée. Elle reste en attente de validation indépendante.");
      await loadRecords();
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  async function submitAssessment(event: FormEvent) {
    event.preventDefault();
    if (!controlId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await effectivenessApi.create(token, {
        controlId, evalType: evalType.trim() || null, designAdequacy: designAdequacy.trim() || null,
        executionQuality: executionQuality.trim() || null, operationalEffectiveness: rating,
        result: assessmentResult, limitations: limitations.trim() || null,
        compensatingControls: compensatingControls.trim() || null, conclusion: conclusion.trim() || null,
        justification: assessmentJustification.trim(), status: "COMPLETED",
      });
      setDesignAdequacy(""); setExecutionQuality(""); setLimitations(""); setCompensatingControls(""); setConclusion(""); setAssessmentJustification("");
      setNotice("Évaluation d'efficacité enregistrée. La validation reste indépendante.");
      await loadRecords();
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  async function validateRecord(kind: Mode, id: string) {
    const comment = window.prompt("Commentaire de validation (facultatif) :");
    if (comment === null) return;
    setValidatingId(id); setError(null); setNotice(null);
    try {
      if (kind === "executions") await executionsApi.validate(token, id, comment.trim());
      else await effectivenessApi.validate(token, id, comment.trim());
      setNotice("Validation enregistrée.");
      await loadRecords();
    } catch (err) { setError(errorMessage(err)); }
    finally { setValidatingId(""); }
  }

  return <section className="core-page">
    <div className="core-page__heading">
      <div><p className="core-page__eyebrow">CONTRÔLE INTERNE · SUIVI</p><h1>Exécutions & efficacité</h1>
        <p className="core-page__subtitle">Tracer la réalisation des contrôles, puis évaluer séparément leur efficacité. L'exécution et l'évaluation sont historisées et soumises à une validation indépendante.</p></div>
    </div>

    {error && <div className="core-alert core-alert--error" role="alert">{error}</div>}
    {notice && <div className="core-alert core-alert--info" role="status">{notice}</div>}

    <div className="core-page__stats">
      <div className="core-stat"><span>Exécutions enregistrées</span><strong>{executions.length}</strong></div>
      <div className="core-stat"><span>En attente de validation</span><strong>{pendingValidationCount}</strong></div>
      <div className="core-stat"><span>Exécutions réalisées</span><strong>{doneCount}</strong></div>
    </div>

    <section className="core-panel">
      <div className="core-panel__head"><div><h2>Contrôle concerné</h2><p>Les opérations affichées sont limitées au contrôle sélectionné.</p></div></div>
      <div className="core-panel__body">
        {loading ? <p className="muted">Chargement des contrôles…</p> : controls.length === 0 ?
          <div className="core-empty">Aucun contrôle actif ou brouillon disponible. Créez d'abord un contrôle dans le référentiel.</div> :
          <div className="core-field"><label htmlFor="monitor-control">Contrôle</label>
            <select id="monitor-control" value={controlId} onChange={(event) => setControlId(event.target.value)}>
              {controls.map((control) => <option key={control.id} value={control.id}>{control.label} · {control.status}</option>)}
            </select>
            {activeControl && <small>{activeControl.objective || "Aucun objectif renseigné"} · Fréquence : {activeControl.frequency}</small>}
          </div>}
      </div>
    </section>

    <div className="core-filter" role="tablist" aria-label="Type de suivi">
      <button type="button" role="tab" aria-selected={mode === "executions"} className={mode === "executions" ? "core-tab core-tab--active" : "core-tab"} onClick={() => setMode("executions")}>Exécutions</button>
      <button type="button" role="tab" aria-selected={mode === "effectiveness"} className={mode === "effectiveness" ? "core-tab core-tab--active" : "core-tab"} onClick={() => setMode("effectiveness")}>Efficacité des contrôles</button>
    </div>

    {mode === "executions" ? <>
      <section className="core-panel">
        <div className="core-panel__head"><div><h2>Enregistrer une exécution</h2><p>Une ligne par occurrence. Une justification est obligatoire si le contrôle n'a pas été réalisé ou n'est pas applicable.</p></div></div>
        <div className="core-panel__body">
          <form className="core-form" onSubmit={submitExecution}>
            <div className="core-field"><label htmlFor="execution-status">Statut *</label><select id="execution-status" value={status} onChange={(e) => setStatus(e.target.value as ExecutionStatus)}><option value="DONE">Réalisé</option><option value="NOT_DONE">Non réalisé</option><option value="NOT_APPLICABLE">Non applicable</option></select></div>
            <div className="core-field"><label htmlFor="planned-date">Date prévue</label><input id="planned-date" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} /></div>
            <div className="core-field"><label htmlFor="completed-date">Date de réalisation</label><input id="completed-date" type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} /></div>
            <div className="core-field"><label htmlFor="execution-result">Résultat / référence</label><input id="execution-result" value={result} onChange={(e) => setResult(e.target.value)} placeholder="Ex. échantillon contrôlé, période couverte…" /></div>
            <div className="core-field core-span-2"><label htmlFor="execution-anomalies">Anomalies observées</label><textarea id="execution-anomalies" value={observedAnomalies} onChange={(e) => setObservedAnomalies(e.target.value)} /></div>
            <div className="core-field core-span-2"><label htmlFor="execution-justification">Justification si non réalisé / non applicable {status !== "DONE" ? "*" : ""}</label><textarea id="execution-justification" value={justification} onChange={(e) => setJustification(e.target.value)} required={status !== "DONE"} /></div>
            <div className="core-form-actions core-span-2"><button className="core-button core-button--primary" type="submit" disabled={saving || !controlId}>{saving ? "Enregistrement…" : "Enregistrer l'exécution"}</button></div>
          </form>
        </div>
      </section>

      <section className="core-panel">
        <div className="core-panel__head"><div><h2>Historique des exécutions</h2><p>{executions.length} occurrence(s) pour ce contrôle · {doneCount} réalisée(s).</p></div></div>
        <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Date prévue</th><th>Date réalisée</th><th>Statut</th><th>Résultat / anomalies</th><th>Exécutant</th><th>Validation</th><th>Action</th></tr></thead>
          <tbody>{executions.map((item) => <tr key={item.id}><td>{dateLabel(item.plannedDate)}</td><td>{dateLabel(item.completedDate)}</td><td><span className={`core-badge ${item.status === "DONE" ? "core-badge--success" : item.status === "NOT_DONE" ? "core-badge--danger" : "core-badge--warning"}`}>{executionLabels[item.status]}</span></td><td>{item.result || item.observedAnomalies || item.justificationIfNotDone || "—"}</td><td>{item.executedBy}</td><td>{item.validatedAt ? <span className="core-badge core-badge--success">Validée le {dateLabel(item.validatedAt)}</span> : <span className="core-badge core-badge--warning">En attente</span>}</td><td>{!item.validatedAt && <button type="button" className="core-button" disabled={validatingId === item.id} onClick={() => void validateRecord("executions", item.id)}>{validatingId === item.id ? "Validation…" : "Valider"}</button>}</td></tr>)}
          {executions.length === 0 && <tr><td colSpan={7} className="core-empty">Aucune exécution enregistrée pour ce contrôle.</td></tr>}</tbody></table></div>
      </section>
    </> : <>
      <section className="core-panel">
        <div className="core-panel__head"><div><h2>Évaluer l'efficacité du contrôle</h2><p>Cette évaluation ne remplace pas l'exécution : elle documente la conception et l'efficacité opérationnelle du contrôle.</p></div></div>
        <div className="core-panel__body">
          <form className="core-form" onSubmit={submitAssessment}>
            <div className="core-field"><label htmlFor="eval-type">Type d'évaluation</label><select id="eval-type" value={evalType} onChange={(e) => setEvalType(e.target.value)}><option>Périodique</option><option>À la suite d'un incident</option><option>Revue annuelle</option><option>Après action corrective</option></select></div>
            <div className="core-field"><label htmlFor="operational-rating">Efficacité opérationnelle *</label><select id="operational-rating" value={rating} onChange={(e) => setRating(e.target.value as EffectivenessRating)}><option value="EFFECTIVE">Efficace</option><option value="PARTIALLY_EFFECTIVE">Partiellement efficace</option><option value="INEFFECTIVE">Inefficace</option></select></div>
            <div className="core-field"><label htmlFor="assessment-result">Conclusion de l'évaluation *</label><select id="assessment-result" value={assessmentResult} onChange={(e) => setAssessmentResult(e.target.value as EffectivenessResult)}><option value="EFFECTIVE">Efficace</option><option value="PARTIALLY_EFFECTIVE">Partiellement efficace</option><option value="INEFFECTIVE">Inefficace</option><option value="INCONCLUSIVE">Non concluant</option></select></div>
            <div className="core-field"><label htmlFor="design-adequacy">Adéquation de la conception</label><textarea id="design-adequacy" value={designAdequacy} onChange={(e) => setDesignAdequacy(e.target.value)} /></div>
            <div className="core-field"><label htmlFor="execution-quality">Qualité d'exécution observée</label><textarea id="execution-quality" value={executionQuality} onChange={(e) => setExecutionQuality(e.target.value)} /></div>
            <div className="core-field"><label htmlFor="limitations">Limites constatées</label><textarea id="limitations" value={limitations} onChange={(e) => setLimitations(e.target.value)} /></div>
            <div className="core-field"><label htmlFor="compensating-controls">Contrôles compensatoires</label><textarea id="compensating-controls" value={compensatingControls} onChange={(e) => setCompensatingControls(e.target.value)} /></div>
            <div className="core-field core-span-2"><label htmlFor="assessment-conclusion">Conclusion détaillée</label><textarea id="assessment-conclusion" value={conclusion} onChange={(e) => setConclusion(e.target.value)} /></div>
            <div className="core-field core-span-2"><label htmlFor="assessment-justification">Justification documentée * </label><textarea id="assessment-justification" value={assessmentJustification} onChange={(e) => setAssessmentJustification(e.target.value)} required /></div>
            <div className="core-form-actions core-span-2"><button className="core-button core-button--primary" type="submit" disabled={saving || !controlId}>{saving ? "Enregistrement…" : "Enregistrer l'évaluation"}</button></div>
          </form>
        </div>
      </section>

      <section className="core-panel">
        <div className="core-panel__head"><div><h2>Historique des évaluations</h2><p>{assessments.length} évaluation(s) pour ce contrôle.</p></div></div>
        <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Date</th><th>Type</th><th>Efficacité</th><th>Résultat</th><th>Évaluateur</th><th>Statut</th><th>Action</th></tr></thead>
          <tbody>{assessments.map((item) => <tr key={item.id}><td>{dateLabel(item.evalDate)}</td><td>{item.evalType || "—"}</td><td><span className={`core-badge ${item.operationalEffectiveness === "EFFECTIVE" ? "core-badge--success" : item.operationalEffectiveness === "INEFFECTIVE" ? "core-badge--danger" : "core-badge--warning"}`}>{ratingLabels[item.operationalEffectiveness]}</span></td><td>{item.result ? resultLabels[item.result] : "—"}</td><td>{item.evaluatedBy}</td><td>{item.validatedAt ? <span className="core-badge core-badge--success">Validée</span> : <span className="core-badge core-badge--warning">{item.status === "PROVISIONAL" ? "Provisoire" : "En attente de validation"}</span>}</td><td>{!item.validatedAt && <button type="button" className="core-button" disabled={validatingId === item.id} onClick={() => void validateRecord("effectiveness", item.id)}>{validatingId === item.id ? "Validation…" : "Valider"}</button>}</td></tr>)}
          {assessments.length === 0 && <tr><td colSpan={7} className="core-empty">Aucune évaluation d'efficacité pour ce contrôle.</td></tr>}</tbody></table></div>
      </section>
    </>}
  </section>;
}
