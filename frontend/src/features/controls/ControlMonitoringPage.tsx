import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, DatePicker, FormField, Grid, GridItem, MessageBanner, Modal, StatusBadge, Table, Tabs, type TableColumn } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { controlsApi, type Control } from "../../api/controls";
import { executionsApi, effectivenessApi, type ControlExecution, type EffectivenessAssessment, type ExecutionStatus, type EffectivenessRating, type EffectivenessResult } from "../../api/controlMonitoring";
import "../core/WorkflowPages.css";

type Mode = "executions" | "effectiveness";
const executionLabels: Record<ExecutionStatus, string> = { DONE: "Réalisé", NOT_DONE: "Non réalisé", NOT_APPLICABLE: "Non applicable" };
const ratingLabels: Record<EffectivenessRating, string> = { EFFECTIVE: "Efficace", PARTIALLY_EFFECTIVE: "Partiellement efficace", INEFFECTIVE: "Inefficace" };
const resultLabels: Record<EffectivenessResult, string> = { ...ratingLabels, INCONCLUSIVE: "Non concluant" };
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const errorMessage = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";
interface Props { token: string; }
interface PendingValidation { kind: Mode; id: string; label: string; }

export function ControlMonitoringPage({ token }: Props) {
  const [mode, setMode] = useState<Mode>("executions");
  const [controls, setControls] = useState<Control[]>([]);
  const [controlId, setControlId] = useState("");
  const [executions, setExecutions] = useState<ControlExecution[]>([]);
  const [assessments, setAssessments] = useState<EffectivenessAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingValidation, setPendingValidation] = useState<PendingValidation | null>(null);
  const [validationComment, setValidationComment] = useState("");
  const [status, setStatus] = useState<ExecutionStatus>("DONE");
  const [plannedDate, setPlannedDate] = useState<string | null>(null);
  const [completedDate, setCompletedDate] = useState<string | null>(null);
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
      if (mode === "executions") setExecutions(await executionsApi.list(token, controlId));
      else setAssessments(await effectivenessApi.list(token, controlId));
    } catch (err) { setError(errorMessage(err)); }
  }, [token, controlId, mode]);

  useEffect(() => { void loadControls(); }, [loadControls]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const activeControl = controls.find((item) => item.id === controlId);
  const doneCount = executions.filter((item) => item.status === "DONE").length;
  const pendingValidationCount = executions.filter((item) => !item.validatedAt).length;
  const executionColumns = useMemo<TableColumn<ControlExecution>[]>(() => [
    { key: "planned", header: "Date prévue", render: (row) => dateLabel(row.plannedDate) },
    { key: "completed", header: "Date réalisée", render: (row) => dateLabel(row.completedDate) },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={executionLabels[row.status]} tone={row.status === "DONE" ? "success" : row.status === "NOT_DONE" ? "danger" : "warning"} /> },
    { key: "result", header: "Résultat / anomalies", render: (row) => row.result || row.observedAnomalies || row.justificationIfNotDone || "—" },
    { key: "actor", header: "Exécutant", render: (row) => row.executedBy },
    { key: "validation", header: "Validation", render: (row) => row.validatedAt ? <StatusBadge label={`Validée le ${dateLabel(row.validatedAt)}`} tone="success" /> : <StatusBadge label="En attente" tone="warning" /> },
    { key: "actions", header: "Action", render: (row) => !row.validatedAt ? <Button disabled={busyId === row.id} onClick={() => { setValidationComment(""); setPendingValidation({ kind: "executions", id: row.id, label: "cette exécution" }); }}>{busyId === row.id ? "Validation…" : "Valider"}</Button> : "—" },
  ], [busyId]);
  const assessmentColumns = useMemo<TableColumn<EffectivenessAssessment>[]>(() => [
    { key: "date", header: "Date", render: (row) => dateLabel(row.evalDate) },
    { key: "type", header: "Type", render: (row) => row.evalType || "—" },
    { key: "rating", header: "Efficacité", render: (row) => <StatusBadge label={ratingLabels[row.operationalEffectiveness]} tone={row.operationalEffectiveness === "EFFECTIVE" ? "success" : row.operationalEffectiveness === "INEFFECTIVE" ? "danger" : "warning"} /> },
    { key: "result", header: "Résultat", render: (row) => row.result ? resultLabels[row.result] : "—" },
    { key: "actor", header: "Évaluateur", render: (row) => row.evaluatedBy },
    { key: "status", header: "Statut", render: (row) => row.validatedAt ? <StatusBadge label="Validée" tone="success" /> : <StatusBadge label={row.status === "PROVISIONAL" ? "Provisoire" : "En attente de validation"} tone="warning" /> },
    { key: "actions", header: "Action", render: (row) => !row.validatedAt ? <Button disabled={busyId === row.id} onClick={() => { setValidationComment(""); setPendingValidation({ kind: "effectiveness", id: row.id, label: "cette évaluation" }); }}>{busyId === row.id ? "Validation…" : "Valider"}</Button> : "—" },
  ], [busyId]);

  async function submitExecution(event: FormEvent) {
    event.preventDefault(); if (!controlId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await executionsApi.create(token, { controlId, status, plannedDate, completedDate, result: result.trim() || null, observedAnomalies: observedAnomalies.trim() || null, justificationIfNotDone: justification.trim() || null });
      setResult(""); setObservedAnomalies(""); setJustification("");
      setNotice("Exécution enregistrée. Elle reste en attente de validation indépendante.");
      await loadRecords();
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  async function submitAssessment(event: FormEvent) {
    event.preventDefault(); if (!controlId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await effectivenessApi.create(token, { controlId, evalType: evalType.trim() || null, designAdequacy: designAdequacy.trim() || null, executionQuality: executionQuality.trim() || null, operationalEffectiveness: rating, result: assessmentResult, limitations: limitations.trim() || null, compensatingControls: compensatingControls.trim() || null, conclusion: conclusion.trim() || null, justification: assessmentJustification.trim(), status: "COMPLETED" });
      setDesignAdequacy(""); setExecutionQuality(""); setLimitations(""); setCompensatingControls(""); setConclusion(""); setAssessmentJustification("");
      setNotice("Évaluation d'efficacité enregistrée. La validation reste indépendante.");
      await loadRecords();
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  async function validateRecord() {
    if (!pendingValidation) return;
    setBusyId(pendingValidation.id); setError(null); setNotice(null);
    try {
      if (pendingValidation.kind === "executions") await executionsApi.validate(token, pendingValidation.id, validationComment.trim());
      else await effectivenessApi.validate(token, pendingValidation.id, validationComment.trim());
      setNotice("Validation enregistrée."); setPendingValidation(null); await loadRecords();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  return <section className="workflow-page">
    <header className="workflow-heading">
      <p className="workflow-eyebrow">CONTRÔLE INTERNE · SUIVI</p>
      <h1>Exécutions & efficacité</h1>
      <p>Tracer la réalisation des contrôles, puis évaluer séparément leur efficacité. L'exécution et l'évaluation sont historisées et soumises à une validation indépendante.</p>
    </header>
    {error && <MessageBanner tone="danger" title="Une erreur est survenue">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    <Grid columns={3} className="workflow-stats">
      <GridItem><Card><span className="workflow-stat-label">Exécutions enregistrées</span><strong className="workflow-stat-value">{loading ? "—" : executions.length}</strong></Card></GridItem>
      <GridItem><Card><span className="workflow-stat-label">En attente de validation</span><strong className="workflow-stat-value">{loading ? "—" : pendingValidationCount}</strong></Card></GridItem>
      <GridItem><Card><span className="workflow-stat-label">Exécutions réalisées</span><strong className="workflow-stat-value">{loading ? "—" : doneCount}</strong></Card></GridItem>
    </Grid>
    <Card header={<div><h2>Contrôle concerné</h2><p>Les opérations affichées sont limitées au contrôle sélectionné.</p></div>}>
      {loading ? <p>Chargement des contrôles…</p> : controls.length === 0 ? <MessageBanner tone="info">Aucun contrôle actif ou brouillon disponible. Créez d'abord un contrôle dans le référentiel.</MessageBanner> :
        <FormField label="Contrôle" htmlFor="monitor-control" help={activeControl ? `${activeControl.objective || "Aucun objectif renseigné"} · Fréquence : ${activeControl.frequency}` : undefined}>
          <select id="monitor-control" value={controlId} onChange={(event) => setControlId(event.target.value)}>{controls.map((control) => <option key={control.id} value={control.id}>{control.label} · {control.status}</option>)}</select>
        </FormField>}
    </Card>
    <Tabs items={[{ value: "executions", label: "Exécutions" }, { value: "effectiveness", label: "Efficacité des contrôles" }]} active={mode} onChange={setMode} />
    {mode === "executions" ? <>
      <Card header={<div><h2>Enregistrer une exécution</h2><p>Une ligne par occurrence. Une justification est obligatoire si le contrôle n'a pas été réalisé ou n'est pas applicable.</p></div>}>
        <form className="workflow-form" onSubmit={submitExecution}>
          <div className="workflow-form-grid">
            <FormField label="Statut *" htmlFor="execution-status"><select id="execution-status" value={status} onChange={(e) => setStatus(e.target.value as ExecutionStatus)}><option value="DONE">Réalisé</option><option value="NOT_DONE">Non réalisé</option><option value="NOT_APPLICABLE">Non applicable</option></select></FormField>
            <DatePicker label="Date prévue" value={plannedDate} onChange={setPlannedDate} />
            <DatePicker label="Date de réalisation" value={completedDate} onChange={setCompletedDate} />
            <FormField label="Résultat / référence" htmlFor="execution-result"><input id="execution-result" value={result} onChange={(e) => setResult(e.target.value)} placeholder="Échantillon contrôlé, période couverte…" /></FormField>
            <div className="workflow-field-span"><FormField label="Anomalies observées" htmlFor="execution-anomalies"><textarea id="execution-anomalies" value={observedAnomalies} onChange={(e) => setObservedAnomalies(e.target.value)} rows={3} /></FormField></div>
            <div className="workflow-field-span"><FormField label={`Justification si non réalisé / non applicable ${status !== "DONE" ? "*" : ""}`} htmlFor="execution-justification"><textarea id="execution-justification" value={justification} onChange={(e) => setJustification(e.target.value)} required={status !== "DONE"} rows={3} /></FormField></div>
          </div>
          <div className="workflow-actions"><Button variant="primary" type="submit" disabled={saving || !controlId}>{saving ? "Enregistrement…" : "Enregistrer l'exécution"}</Button></div>
        </form>
      </Card>
      <Card header={<div><h2>Historique des exécutions</h2><p>{executions.length} occurrence(s) pour ce contrôle · {doneCount} réalisée(s).</p></div>}>
        <Table columns={executionColumns} rows={executions} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucune exécution enregistrée pour ce contrôle." />
      </Card>
    </> : <>
      <Card header={<div><h2>Évaluer l'efficacité du contrôle</h2><p>Cette évaluation ne remplace pas l'exécution : elle documente la conception et l'efficacité opérationnelle du contrôle.</p></div>}>
        <form className="workflow-form" onSubmit={submitAssessment}>
          <div className="workflow-form-grid">
            <FormField label="Type d'évaluation" htmlFor="eval-type"><select id="eval-type" value={evalType} onChange={(e) => setEvalType(e.target.value)}><option>Périodique</option><option>À la suite d'un incident</option><option>Revue annuelle</option><option>Après action corrective</option></select></FormField>
            <FormField label="Efficacité opérationnelle *" htmlFor="operational-rating"><select id="operational-rating" value={rating} onChange={(e) => setRating(e.target.value as EffectivenessRating)}><option value="EFFECTIVE">Efficace</option><option value="PARTIALLY_EFFECTIVE">Partiellement efficace</option><option value="INEFFECTIVE">Inefficace</option></select></FormField>
            <FormField label="Conclusion de l'évaluation *" htmlFor="assessment-result"><select id="assessment-result" value={assessmentResult} onChange={(e) => setAssessmentResult(e.target.value as EffectivenessResult)}><option value="EFFECTIVE">Efficace</option><option value="PARTIALLY_EFFECTIVE">Partiellement efficace</option><option value="INEFFECTIVE">Inefficace</option><option value="INCONCLUSIVE">Non concluant</option></select></FormField>
            <FormField label="Adéquation de la conception" htmlFor="design-adequacy"><textarea id="design-adequacy" value={designAdequacy} onChange={(e) => setDesignAdequacy(e.target.value)} rows={3} /></FormField>
            <FormField label="Qualité d'exécution observée" htmlFor="execution-quality"><textarea id="execution-quality" value={executionQuality} onChange={(e) => setExecutionQuality(e.target.value)} rows={3} /></FormField>
            <FormField label="Limites constatées" htmlFor="limitations"><textarea id="limitations" value={limitations} onChange={(e) => setLimitations(e.target.value)} rows={3} /></FormField>
            <FormField label="Contrôles compensatoires" htmlFor="compensating-controls"><textarea id="compensating-controls" value={compensatingControls} onChange={(e) => setCompensatingControls(e.target.value)} rows={3} /></FormField>
            <div className="workflow-field-span"><FormField label="Conclusion détaillée" htmlFor="assessment-conclusion"><textarea id="assessment-conclusion" value={conclusion} onChange={(e) => setConclusion(e.target.value)} rows={3} /></FormField></div>
            <div className="workflow-field-span"><FormField label="Justification documentée *" htmlFor="assessment-justification"><textarea id="assessment-justification" value={assessmentJustification} onChange={(e) => setAssessmentJustification(e.target.value)} required rows={3} /></FormField></div>
          </div>
          <div className="workflow-actions"><Button variant="primary" type="submit" disabled={saving || !controlId}>{saving ? "Enregistrement…" : "Enregistrer l'évaluation"}</Button></div>
        </form>
      </Card>
      <Card header={<div><h2>Historique des évaluations</h2><p>{assessments.length} évaluation(s) pour ce contrôle.</p></div>}>
        <Table columns={assessmentColumns} rows={assessments} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucune évaluation d'efficacité pour ce contrôle." />
      </Card>
    </>}
    <Modal open={!!pendingValidation} onClose={() => setPendingValidation(null)} title="Valider l'enregistrement">
      <p>Vous êtes sur le point de valider {pendingValidation?.label}. Cette validation doit rester indépendante de l'enregistrement initial.</p>
      <FormField label="Commentaire de validation (facultatif)" htmlFor="validation-comment"><textarea id="validation-comment" value={validationComment} onChange={(e) => setValidationComment(e.target.value)} rows={3} /></FormField>
      <div className="workflow-actions"><Button onClick={() => setPendingValidation(null)}>Annuler</Button><Button variant="primary" disabled={!pendingValidation || !!busyId} onClick={() => void validateRecord()}>{busyId ? "Validation…" : "Confirmer la validation"}</Button></div>
    </Modal>
  </section>;
}
