import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, FormField, Grid, GridItem, MessageBanner, Modal, StatusBadge, Table, type TableColumn, type StatusTone } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { auditMissionsApi, findingsApi, type AuditMission, type Finding, type FindingSeverity, type FindingStatus, type RelatedObjectType } from "../../api/audit";
import "./WorkflowPages.css";

const severityLabels: Record<FindingSeverity, string> = { LOW: "Faible", MODERATE: "Modérée", HIGH: "Élevée", MAJOR: "Majeure", CRITICAL: "Critique" };
const statusLabels: Record<FindingStatus, string> = { OUVERT: "Ouvert", EN_TRAITEMENT: "En traitement", CLOS: "Clos" };
const relatedTypeLabels: Record<RelatedObjectType, string> = { RISK: "Risque", CONTROL: "Contrôle", INCIDENT: "Incident", ANOMALY: "Anomalie" };
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const errorMessage = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";
const toneForSeverity = (value: FindingSeverity): StatusTone => value === "CRITICAL" || value === "MAJOR" ? "danger" : value === "HIGH" ? "warning" : value === "MODERATE" ? "info" : "neutral";
const toneForStatus = (value: FindingStatus): StatusTone => value === "CLOS" ? "success" : value === "EN_TRAITEMENT" ? "warning" : "danger";
interface Props { token: string; }

export function AuditFindingsPage({ token }: Props) {
  const [missions, setMissions] = useState<AuditMission[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missionFilter, setMissionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | FindingStatus>("");
  const [severityFilter, setSeverityFilter] = useState<"" | FindingSeverity>("");
  const [missionId, setMissionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<FindingSeverity>("HIGH");
  const [recommendation, setRecommendation] = useState("");
  const [relatedType, setRelatedType] = useState<"" | RelatedObjectType>("");
  const [relatedId, setRelatedId] = useState("");
  const [closeTarget, setCloseTarget] = useState<Finding | null>(null);
  const [closureComment, setClosureComment] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [missionRows, findingRows] = await Promise.all([auditMissionsApi.list(token), findingsApi.list(token)]);
      setMissions(missionRows); setFindings(findingRows);
      setMissionId((current) => current && missionRows.some((mission) => mission.id === current && mission.status === "EN_COURS") ? current : missionRows.find((mission) => mission.status === "EN_COURS")?.id ?? "");
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  const missionById = useMemo(() => new Map(missions.map((mission) => [mission.id, mission])), [missions]);
  const activeMissions = missions.filter((mission) => mission.status === "EN_COURS");
  const filtered = useMemo(() => findings.filter((finding) => (!missionFilter || finding.auditMissionId === missionFilter) && (!statusFilter || finding.status === statusFilter) && (!severityFilter || finding.severity === severityFilter)), [findings, missionFilter, statusFilter, severityFilter]);
  const openCount = findings.filter((finding) => finding.status === "OUVERT").length;
  const treatmentCount = findings.filter((finding) => finding.status === "EN_TRAITEMENT").length;
  const criticalCount = findings.filter((finding) => finding.severity === "CRITICAL" && finding.status !== "CLOS").length;

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!missionId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await findingsApi.create(token, { auditMissionId: missionId, title: title.trim(), description: description.trim(), severity, recommendation: recommendation.trim() || null, relatedObjectType: relatedType || null, relatedObjectId: relatedType ? relatedId.trim() : null });
      setTitle(""); setDescription(""); setRecommendation(""); setRelatedType(""); setRelatedId("");
      setNotice("Constat créé. Son suivi de remédiation peut être porté par un plan d'action lié au constat.");
      await refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  async function startTreatment(row: Finding) {
    setBusyId(row.id); setError(null); setNotice(null);
    try { await findingsApi.startTreatment(token, row.id); setNotice("Le constat est passé en traitement."); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  async function closeFinding() {
    if (!closeTarget) return;
    if (!closureComment.trim()) { setError("Le commentaire de clôture est obligatoire."); return; }
    setBusyId(closeTarget.id); setError(null); setNotice(null);
    try { await findingsApi.close(token, closeTarget.id, closureComment.trim()); setNotice("Constat clôturé. La clôture est soumise au contrôle maker-checker."); setCloseTarget(null); await refresh(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusyId(""); }
  }

  const columns = useMemo<TableColumn<Finding>[]>(() => [
    { key: "finding", header: "Constat", render: (row) => <div className="workflow-cell-stack"><strong>{row.title}</strong><span>{row.description}</span>{row.relatedObjectType && <small>Lié à : {relatedTypeLabels[row.relatedObjectType]} · {row.relatedObjectId}</small>}</div> },
    { key: "mission", header: "Mission", render: (row) => { const mission = missionById.get(row.auditMissionId); return mission ? <div className="workflow-cell-stack"><strong>{mission.reference}</strong><span>{mission.title}</span></div> : row.auditMissionId; } },
    { key: "severity", header: "Gravité", render: (row) => <StatusBadge label={severityLabels[row.severity]} tone={toneForSeverity(row.severity)} /> },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={statusLabels[row.status]} tone={toneForStatus(row.status)} /> },
    { key: "recommendation", header: "Recommandation", render: (row) => row.recommendation || "—" },
    { key: "created", header: "Créé le", render: (row) => dateLabel(row.createdAt) },
    { key: "actions", header: "Actions", render: (row) => <div className="workflow-actions workflow-actions--compact">
      {row.status === "OUVERT" && <Button disabled={busyId === row.id} onClick={() => void startTreatment(row)}>{busyId === row.id ? "Traitement…" : "Démarrer"}</Button>}
      {row.status !== "CLOS" && <Button variant="destructive" disabled={busyId === row.id} onClick={() => { setClosureComment(""); setCloseTarget(row); }}>{busyId === row.id ? "Clôture…" : "Clôturer"}</Button>}
    </div> },
  ], [missionById, busyId]);

  return <section className="workflow-page">
    <header className="workflow-heading">
      <p className="workflow-eyebrow">AUDIT · CONSTATS & RECOMMANDATIONS</p>
      <h1>Constats & recommandations</h1>
      <p>Enregistrer les constats d'une mission en cours, documenter les recommandations, puis suivre leur traitement. La clôture est indépendante de l'auteur du constat.</p>
    </header>
    {error && <MessageBanner tone="danger" title="Une erreur est survenue">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    <Grid columns={3} className="workflow-stats">
      <GridItem><Card><span className="workflow-stat-label">Constats filtrés</span><strong className="workflow-stat-value">{loading ? "—" : filtered.length}</strong></Card></GridItem>
      <GridItem><Card><span className="workflow-stat-label">Ouverts</span><strong className="workflow-stat-value">{loading ? "—" : openCount}</strong></Card></GridItem>
      <GridItem><Card><span className="workflow-stat-label">Critiques non clos</span><strong className="workflow-stat-value">{loading ? "—" : criticalCount}</strong></Card></GridItem>
    </Grid>
    <Card header={<div><h2>Déclarer un constat</h2><p>Un constat ne peut être créé que pendant une mission au statut « En cours ».</p></div>}>
      {activeMissions.length === 0 ? <MessageBanner tone="info">Aucune mission d'audit en cours. Démarrez une mission avant de créer un constat.</MessageBanner> :
        <form className="workflow-form" onSubmit={submit}><div className="workflow-form-grid">
          <div className="workflow-field-span"><FormField label="Mission d'audit *" htmlFor="finding-mission" help={`Périmètre audité : ${missionById.get(missionId)?.scope ?? "—"}`}>
            <select id="finding-mission" value={missionId} onChange={(e) => setMissionId(e.target.value)} required>{activeMissions.map((mission) => <option key={mission.id} value={mission.id}>{mission.reference} · {mission.title}</option>)}</select>
          </FormField></div>
          <FormField label="Intitulé du constat *" htmlFor="finding-title"><input id="finding-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={250} /></FormField>
          <FormField label="Gravité *" htmlFor="finding-severity"><select id="finding-severity" value={severity} onChange={(e) => setSeverity(e.target.value as FindingSeverity)}>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
          <div className="workflow-field-span"><FormField label="Description factuelle *" htmlFor="finding-description"><textarea id="finding-description" value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} /></FormField></div>
          <div className="workflow-field-span"><FormField label="Recommandation" htmlFor="finding-recommendation"><textarea id="finding-recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value)} rows={3} /></FormField></div>
          <FormField label="Objet associé (facultatif)" htmlFor="finding-related-type"><select id="finding-related-type" value={relatedType} onChange={(e) => { setRelatedType(e.target.value as "" | RelatedObjectType); if (!e.target.value) setRelatedId(""); }}><option value="">Aucun</option>{Object.entries(relatedTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
          <FormField label="Identifiant de l'objet associé" htmlFor="finding-related-id" help="L'API vérifie l'existence de l'objet associé."><input id="finding-related-id" value={relatedId} onChange={(e) => setRelatedId(e.target.value)} disabled={!relatedType} required={!!relatedType} placeholder="ID exact de l'objet" /></FormField>
        </div><div className="workflow-actions"><Button variant="primary" type="submit" disabled={saving || !missionId}>{saving ? "Enregistrement…" : "Créer le constat"}</Button></div></form>}
    </Card>
    <Card header={<div><h2>Registre des constats</h2><p>Les transitions de statut sont contrôlées par le serveur et journalisées.</p></div>} footer={<Button onClick={() => void refresh()} disabled={loading}>Actualiser</Button>}>
      <div className="workflow-filter-row">
        <FormField label="Mission" htmlFor="filter-mission"><select id="filter-mission" value={missionFilter} onChange={(e) => setMissionFilter(e.target.value)}><option value="">Toutes les missions</option>{missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.reference} · {mission.title}</option>)}</select></FormField>
        <FormField label="Statut" htmlFor="filter-status"><select id="filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | FindingStatus)}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Gravité" htmlFor="filter-severity"><select id="filter-severity" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as "" | FindingSeverity)}><option value="">Toutes les gravités</option>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      </div>
      <Table columns={columns} rows={filtered} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucun constat ne correspond aux filtres." />
    </Card>
    <MessageBanner tone="info">Le texte de recommandation est conservé sur le constat. Le suivi opérationnel (responsable, échéance, avancement et preuve de clôture) doit être porté par un plan d'action lié à ce constat.</MessageBanner>
    <Grid columns={3} className="workflow-stats">
      <GridItem><Card><span className="workflow-stat-label">En traitement</span><strong className="workflow-stat-value">{loading ? "—" : treatmentCount}</strong></Card></GridItem>
      <GridItem><Card><span className="workflow-stat-label">Missions en cours</span><strong className="workflow-stat-value">{loading ? "—" : activeMissions.length}</strong></Card></GridItem>
      <GridItem><Card><span className="workflow-stat-label">Actions disponibles</span><strong className="workflow-stat-value">{loading ? "—" : findings.filter((finding) => finding.status !== "CLOS").length}</strong></Card></GridItem>
    </Grid>
    <Modal open={!!closeTarget} onClose={() => setCloseTarget(null)} title="Clôturer le constat">
      <p>La clôture est une transition métier contrôlée par le serveur et soumise au maker-checker.</p>
      <FormField label="Commentaire obligatoire de clôture" htmlFor="closure-comment" error={error === "Le commentaire de clôture est obligatoire." ? error : undefined}>
        <textarea id="closure-comment" value={closureComment} onChange={(e) => { setClosureComment(e.target.value); if (error === "Le commentaire de clôture est obligatoire.") setError(null); }} rows={4} required />
      </FormField>
      <div className="workflow-actions"><Button onClick={() => setCloseTarget(null)}>Annuler</Button><Button variant="destructive" disabled={!closureComment.trim() || !!busyId} onClick={() => void closeFinding()}>{busyId ? "Clôture…" : "Confirmer la clôture"}</Button></div>
    </Modal>
  </section>;
}
