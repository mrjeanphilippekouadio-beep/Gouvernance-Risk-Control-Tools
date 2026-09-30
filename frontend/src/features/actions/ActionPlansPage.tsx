import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, DatePicker, FileUpload, FormField, Grid, GridItem, MessageBanner, Modal, ProgressBar, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { actionPlansApi, type ActionPlan, type ActionPlanSourceType, type ActionPlanStatus } from "../../api/actionPlans";
import { evidenceApi } from "../../api/evidence";
import { RaciPanel } from "../../design-system/RaciPanel";
import "./ActionPlansPage.css";

const sourceLabels: Record<ActionPlanSourceType, string> = {
  RISK: "Risque", CONTROL: "Contrôle", KRI: "KRI", AUDIT: "Audit", INCIDENT: "Incident", MANAGEMENT: "Management", FINDING: "Constat d'audit",
};
const statusLabels: Record<ActionPlanStatus, string> = {
  PLANIFIEE: "Planifiée", EN_COURS: "En cours", TERMINEE: "Terminée", EN_RETARD: "En retard",
};
const statusTone: Record<ActionPlanStatus, StatusTone> = {
  PLANIFIEE: "info", EN_COURS: "warning", TERMINEE: "success", EN_RETARD: "danger",
};
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const errorMessage = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";
const needsSourceId = (type: ActionPlanSourceType) => ["RISK", "CONTROL", "KRI", "FINDING"].includes(type);

interface Props { token: string; }
interface ProgressTarget { action: ActionPlan; }

export function ActionPlansPage({ token }: Props) {
  const [actions, setActions] = useState<ActionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | ActionPlanStatus>("");
  const [sourceFilter, setSourceFilter] = useState<"" | ActionPlanSourceType>("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<ActionPlanSourceType>("FINDING");
  const [sourceId, setSourceId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);

  const [progressTarget, setProgressTarget] = useState<ProgressTarget | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressComment, setProgressComment] = useState("");
  const [closeTarget, setCloseTarget] = useState<ActionPlan | null>(null);
  const [raciTarget, setRaciTarget] = useState<ActionPlan | null>(null);
  const [closureFile, setClosureFile] = useState<File | null>(null);
  const [evidenceId, setEvidenceId] = useState("");
  const [closureComment, setClosureComment] = useState("");
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await actionPlansApi.list(token, { status: statusFilter || undefined, sourceType: sourceFilter || undefined });
      setActions(rows);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, sourceFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCount = actions.filter((action) => action.computedStatus !== "TERMINEE").length;
  const overdueCount = actions.filter((action) => action.computedStatus === "EN_RETARD").length;
  const completedCount = actions.filter((action) => action.computedStatus === "TERMINEE").length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dueDate || !responsibleUserId.trim() || (needsSourceId(sourceType) && !sourceId.trim())) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await actionPlansApi.create(token, {
        title: title.trim(),
        description: description.trim() || null,
        sourceType,
        sourceId: needsSourceId(sourceType) ? sourceId.trim() : null,
        responsibleUserId: responsibleUserId.trim(),
        departmentId: departmentId.trim() || null,
        dueDate,
      });
      setTitle(""); setDescription(""); setSourceId(""); setResponsibleUserId(""); setDepartmentId(""); setDueDate(null);
      setNotice("Plan d'action créé. Le statut et les droits restent contrôlés par l'API.");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function startAction(action: ActionPlan) {
    setBusyId(action.id); setError(null); setNotice(null);
    try {
      await actionPlansApi.start(token, action.id);
      setNotice("Le plan d'action est passé au statut « En cours ».");
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  async function escalateAction(action: ActionPlan) {
    setBusyId(action.id); setError(null); setNotice(null);
    try {
      const result = await actionPlansApi.escalate(token, action.id);
      setNotice(result.escalated ? "Escalade enregistrée pour le plan en retard." : "Aucune escalade : le plan n'est pas en retard à cet instant.");
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  async function saveProgress() {
    if (!progressTarget) return;
    setBusyId(progressTarget.action.id); setError(null); setNotice(null);
    try {
      await actionPlansApi.updateProgress(token, progressTarget.action.id, progressPercent, progressComment.trim());
      setNotice("Avancement enregistré et journalisé.");
      setProgressTarget(null);
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  async function uploadClosureEvidence() {
    if (!closureFile) { setError("Sélectionnez d'abord un fichier de preuve."); return; }
    setUploadingEvidence(true); setError(null); setNotice(null);
    try {
      const evidence = await evidenceApi.upload(token, closureFile, "ACTION_PLAN_CLOSURE");
      setEvidenceId(evidence.id);
      setNotice(`Preuve déposée : ${evidence.fileName}. Vous pouvez maintenant confirmer la clôture.`);
    } catch (err) { setError(errorMessage(err)); }
    finally { setUploadingEvidence(false); }
  }

  async function closeAction() {
    if (!closeTarget || !evidenceId.trim()) return;
    setBusyId(closeTarget.id); setError(null); setNotice(null);
    try {
      await actionPlansApi.close(token, closeTarget.id, evidenceId.trim(), closureComment.trim());
      setNotice("Clôture enregistrée avec sa preuve. Le contrôle maker-checker est appliqué par le serveur.");
      setCloseTarget(null); setClosureFile(null); setEvidenceId(""); setClosureComment("");
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  const columns = useMemo<TableColumn<ActionPlan>[]>(() => [
    { key: "title", header: "Plan d'action", render: (action) => <div className="action-plan-cell"><strong>{action.title}</strong>{action.description && <span>{action.description}</span>}<small>Source : {sourceLabels[action.sourceType]}{action.sourceId ? ` · ${action.sourceId}` : ""}</small></div> },
    { key: "status", header: "Statut", render: (action) => <StatusBadge label={statusLabels[action.computedStatus]} tone={statusTone[action.computedStatus]} /> },
    { key: "owner", header: "Responsable", render: (action) => <div className="action-plan-cell"><strong>{action.responsibleUserId}</strong>{action.departmentId && <small>Département : {action.departmentId}</small>}</div> },
    { key: "due", header: "Échéance", render: (action) => dateLabel(action.dueDate) },
    { key: "progress", header: "Avancement", render: (action) => <div className="action-plan-progress"><ProgressBar value={action.progressPercent} label={`Avancement de ${action.title}`} /><small>{action.progressComment || "Aucun commentaire récent"}</small></div> },
    { key: "actions", header: "Actions", render: (action) => <div className="action-plan-row-actions">
      <Button onClick={() => setRaciTarget(action)}>RACI</Button>
      {action.status === "PLANIFIEE" && <Button disabled={busyId === action.id} onClick={() => void startAction(action)}>Démarrer</Button>}
      {action.computedStatus !== "TERMINEE" && <Button disabled={busyId === action.id} onClick={() => { setProgressTarget({ action }); setProgressPercent(action.progressPercent); setProgressComment(action.progressComment ?? ""); }}>Avancement</Button>}
      {action.computedStatus === "EN_RETARD" && <Button disabled={busyId === action.id} onClick={() => void escalateAction(action)}>Escalader</Button>}
      {action.computedStatus !== "TERMINEE" && <Button variant="destructive" disabled={busyId === action.id} onClick={() => { setCloseTarget(action); setClosureFile(null); setEvidenceId(""); setClosureComment(""); }}>Clôturer</Button>}
    </div> },
  ], [busyId]);

  return <section className="action-plans-page">
    <header className="action-plans-heading">
      <p className="action-plans-eyebrow">GOUVERNANCE · REMÉDIATION</p>
      <h1>Plans d'action</h1>
      <p>Attribuer une remédiation, suivre l'avancement et l'échéance, puis clôturer avec une preuve et une validation indépendante.</p>
    </header>

    {error && <MessageBanner tone="danger" title="Une erreur est survenue">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}

    <Grid columns={3} className="action-plans-stats">
      <GridItem><Card><span className="action-plans-stat-label">Plans ouverts</span><strong className="action-plans-stat-value">{loading ? "—" : openCount}</strong></Card></GridItem>
      <GridItem><Card><span className="action-plans-stat-label">En retard</span><strong className="action-plans-stat-value">{loading ? "—" : overdueCount}</strong></Card></GridItem>
      <GridItem><Card><span className="action-plans-stat-label">Terminés</span><strong className="action-plans-stat-value">{loading ? "—" : completedCount}</strong></Card></GridItem>
    </Grid>

    <Card header={<div><h2>Créer un plan d'action</h2><p>Les références métier et l'utilisateur responsable sont vérifiés par le serveur dans le périmètre du tenant.</p></div>}>
      <form className="action-plans-form" onSubmit={submit}>
        <div className="action-plans-form-grid">
          <div className="action-plans-span"><FormField label="Intitulé *" htmlFor="action-title"><input id="action-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={250} /></FormField></div>
          <FormField label="Source *" htmlFor="action-source-type"><select id="action-source-type" value={sourceType} onChange={(e) => { const next = e.target.value as ActionPlanSourceType; setSourceType(next); if (!needsSourceId(next)) setSourceId(""); }}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
          <FormField label={`ID de la source ${needsSourceId(sourceType) ? "*" : "(non requis pour cette source)"}`} htmlFor="action-source-id" help={sourceType === "FINDING" ? "Utilisez l'identifiant exact du constat d'audit." : "L'API valide l'existence et l'appartenance au tenant lorsque la source référence un objet."}><input id="action-source-id" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={!needsSourceId(sourceType)} required={needsSourceId(sourceType)} /></FormField>
          <FormField label="ID utilisateur responsable *" htmlFor="action-owner" help="Saisir l'identifiant exact de l'utilisateur actif."><input id="action-owner" value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} required /></FormField>
          <FormField label="ID département (facultatif)" htmlFor="action-department"><input id="action-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} /></FormField>
          <DatePicker label="Date d'échéance *" value={dueDate} onChange={setDueDate} />
          <div className="action-plans-span"><FormField label="Description / résultat attendu" htmlFor="action-description"><textarea id="action-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></FormField></div>
        </div>
        <div className="action-plans-actions"><Button variant="primary" type="submit" disabled={saving || !title.trim() || !responsibleUserId.trim() || !dueDate || (needsSourceId(sourceType) && !sourceId.trim())}>{saving ? "Création…" : "Créer le plan d'action"}</Button></div>
      </form>
    </Card>

    <Card header={<div><h2>Registre des plans d'action</h2><p>Le retard est calculé par l'API à partir de l'échéance ; il n'est pas stocké comme un statut distinct.</p></div>} footer={<Button onClick={() => void refresh()} disabled={loading}>Actualiser</Button>}>
      <div className="action-plans-filters">
        <FormField label="Statut" htmlFor="action-filter-status"><select id="action-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | ActionPlanStatus)}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Source" htmlFor="action-filter-source"><select id="action-filter-source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "" | ActionPlanSourceType)}><option value="">Toutes les sources</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      </div>
      <Table columns={columns} rows={actions} rowKey={(action) => action.id} loading={loading} emptyMessage="Aucun plan d'action ne correspond aux filtres." />
    </Card>

    {raciTarget && <section className="action-plan-raci">
      <div className="action-plan-raci-heading"><div><h2>RACI — {raciTarget.title}</h2><p>Les attributions sont chargées et modifiées par le composant métier existant.</p></div><Button onClick={() => setRaciTarget(null)}>Fermer</Button></div>
      <RaciPanel token={token} entityType="ACTION_PLAN" entityId={raciTarget.id} />
    </section>}

    <Modal open={!!progressTarget} onClose={() => setProgressTarget(null)} title="Mettre à jour l'avancement" actions={<><Button onClick={() => setProgressTarget(null)}>Annuler</Button><Button variant="primary" disabled={!progressTarget || !!busyId} onClick={() => void saveProgress()}>{busyId ? "Enregistrement…" : "Enregistrer"}</Button></>}>
      <p>La modification de l'avancement est historisée dans le journal d'audit.</p>
      <FormField label="Avancement (%)" htmlFor="action-progress"><input id="action-progress" type="number" min={0} max={100} step={1} value={progressPercent} onChange={(e) => setProgressPercent(Number(e.target.value))} /></FormField>
      <FormField label="Commentaire d'avancement" htmlFor="action-progress-comment"><textarea id="action-progress-comment" value={progressComment} onChange={(e) => setProgressComment(e.target.value)} rows={3} /></FormField>
    </Modal>

    <Modal open={!!closeTarget} onClose={() => { setCloseTarget(null); setClosureFile(null); setEvidenceId(""); }} title="Clôturer le plan d'action" actions={<><Button onClick={() => { setCloseTarget(null); setClosureFile(null); setEvidenceId(""); }}>Annuler</Button><Button variant="destructive" disabled={!closeTarget || !evidenceId.trim() || !!busyId} onClick={() => void closeAction()}>{busyId ? "Clôture…" : "Confirmer la clôture"}</Button></>}>
      <MessageBanner tone="warning" title="Preuve obligatoire">La clôture exige une preuve déposée dans le système et un validateur différent du créateur. Le serveur applique ces règles.</MessageBanner>
      <div className="action-plans-evidence">
        <strong>Preuve de clôture *</strong>
        <FileUpload buttonLabel="Choisir la preuve" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.csv" fileName={closureFile?.name} onSelect={(file) => { setClosureFile(file); setEvidenceId(""); }} disabled={uploadingEvidence || !!busyId} />
        <Button disabled={!closureFile || uploadingEvidence} onClick={() => void uploadClosureEvidence()}>{uploadingEvidence ? "Dépôt…" : "Déposer la preuve"}</Button>
        {evidenceId && <MessageBanner tone="success">Preuve enregistrée (référence : {evidenceId}).</MessageBanner>}
      </div>
      <FormField label="Commentaire de clôture (facultatif)" htmlFor="action-closure-comment"><textarea id="action-closure-comment" value={closureComment} onChange={(e) => setClosureComment(e.target.value)} rows={3} /></FormField>
    </Modal>
  </section>;
}
