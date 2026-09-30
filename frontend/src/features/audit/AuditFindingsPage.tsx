import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import {
  auditMissionsApi,
  findingsApi,
  type AuditMission,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
  type RelatedObjectType,
} from "../../api/audit";
import "../core/CorePages.css";

const severityLabels: Record<FindingSeverity, string> = {
  LOW: "Faible", MODERATE: "Modérée", HIGH: "Élevée", MAJOR: "Majeure", CRITICAL: "Critique",
};
const statusLabels: Record<FindingStatus, string> = {
  OUVERT: "Ouvert", EN_TRAITEMENT: "En traitement", CLOS: "Clos",
};
const relatedTypeLabels: Record<RelatedObjectType, string> = {
  RISK: "Risque", CONTROL: "Contrôle", INCIDENT: "Incident", ANOMALY: "Anomalie",
};
const dateLabel = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const errorMessage = (err: unknown) =>
  err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`
    : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [missionRows, findingRows] = await Promise.all([
        auditMissionsApi.list(token),
        findingsApi.list(token),
      ]);
      setMissions(missionRows);
      setFindings(findingRows);
      setMissionId((current) => current && missionRows.some((mission) => mission.id === current && mission.status === "EN_COURS")
        ? current : missionRows.find((mission) => mission.status === "EN_COURS")?.id ?? "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const missionById = useMemo(() => new Map(missions.map((mission) => [mission.id, mission])), [missions]);
  const activeMissions = missions.filter((mission) => mission.status === "EN_COURS");
  const filtered = useMemo(() => findings.filter((finding) =>
    (!missionFilter || finding.auditMissionId === missionFilter) &&
    (!statusFilter || finding.status === statusFilter) &&
    (!severityFilter || finding.severity === severityFilter)
  ), [findings, missionFilter, statusFilter, severityFilter]);
  const openCount = findings.filter((finding) => finding.status === "OUVERT").length;
  const treatmentCount = findings.filter((finding) => finding.status === "EN_TRAITEMENT").length;
  const criticalCount = findings.filter((finding) => finding.severity === "CRITICAL" && finding.status !== "CLOS").length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!missionId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await findingsApi.create(token, {
        auditMissionId: missionId,
        title: title.trim(),
        description: description.trim(),
        severity,
        recommendation: recommendation.trim() || null,
        relatedObjectType: relatedType || null,
        relatedObjectId: relatedType ? relatedId.trim() : null,
      });
      setTitle(""); setDescription(""); setRecommendation(""); setRelatedType(""); setRelatedId("");
      setNotice("Constat créé. Son suivi de remédiation peut être porté par un plan d'action lié au constat.");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function startTreatment(row: Finding) {
    setBusyId(row.id); setError(null); setNotice(null);
    try {
      await findingsApi.startTreatment(token, row.id);
      setNotice("Le constat est passé en traitement.");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  async function closeFinding(row: Finding) {
    const comment = window.prompt("Commentaire obligatoire de clôture du constat :");
    if (comment === null) return;
    if (!comment.trim()) {
      setError("Le commentaire de clôture est obligatoire.");
      return;
    }
    setBusyId(row.id); setError(null); setNotice(null);
    try {
      await findingsApi.close(token, row.id, comment.trim());
      setNotice("Constat clôturé. La clôture est soumise au contrôle maker-checker.");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  return <section className="core-page">
    <div className="core-page__heading">
      <div><p className="core-page__eyebrow">AUDIT · CONSTATS & RECOMMANDATIONS</p><h1>Constats & recommandations</h1>
        <p className="core-page__subtitle">Enregistrer les constats d'une mission en cours, documenter les recommandations, puis suivre leur traitement. La clôture est indépendante de l'auteur du constat.</p></div>
    </div>

    {error && <div className="core-alert core-alert--error" role="alert">{error}</div>}
    {notice && <div className="core-alert core-alert--info" role="status">{notice}</div>}

    <div className="core-page__stats">
      <div className="core-stat"><span>Constats affichés</span><strong>{loading ? "—" : findings.length}</strong></div>
      <div className="core-stat"><span>Ouverts</span><strong>{loading ? "—" : openCount}</strong></div>
      <div className="core-stat"><span>Critiques non clos</span><strong>{loading ? "—" : criticalCount}</strong></div>
    </div>

    <section className="core-panel">
      <div className="core-panel__head"><div><h2>Déclarer un constat</h2><p>Un constat ne peut être créé que pendant une mission au statut « En cours ».</p></div></div>
      <div className="core-panel__body">
        {activeMissions.length === 0 ? <div className="core-alert core-alert--info">Aucune mission d'audit en cours. Démarrez une mission avant de créer un constat.</div> :
          <form className="core-form" onSubmit={submit}>
            <div className="core-field core-span-2"><label htmlFor="finding-mission">Mission d'audit *</label>
              <select id="finding-mission" value={missionId} onChange={(event) => setMissionId(event.target.value)} required>
                {activeMissions.map((mission) => <option key={mission.id} value={mission.id}>{mission.reference} · {mission.title}</option>)}
              </select>
              <small>Le périmètre audité : {missionById.get(missionId)?.scope ?? "—"}</small>
            </div>
            <div className="core-field"><label htmlFor="finding-title">Intitulé du constat *</label><input id="finding-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={250} /></div>
            <div className="core-field"><label htmlFor="finding-severity">Gravité *</label><select id="finding-severity" value={severity} onChange={(event) => setSeverity(event.target.value as FindingSeverity)}>
              {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
            <div className="core-field core-span-2"><label htmlFor="finding-description">Description factuelle *</label><textarea id="finding-description" value={description} onChange={(event) => setDescription(event.target.value)} required /></div>
            <div className="core-field core-span-2"><label htmlFor="finding-recommendation">Recommandation</label><textarea id="finding-recommendation" value={recommendation} onChange={(event) => setRecommendation(event.target.value)} /></div>
            <div className="core-field"><label htmlFor="finding-related-type">Objet associé (facultatif)</label><select id="finding-related-type" value={relatedType} onChange={(event) => { setRelatedType(event.target.value as "" | RelatedObjectType); if (!event.target.value) setRelatedId(""); }}>
              <option value="">Aucun</option>{Object.entries(relatedTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
            <div className="core-field"><label htmlFor="finding-related-id">Identifiant de l'objet associé</label><input id="finding-related-id" value={relatedId} onChange={(event) => setRelatedId(event.target.value)} disabled={!relatedType} required={!!relatedType} placeholder="ID exact de l'objet" />
              <small>Pour Risque, Contrôle ou Anomalie, l'API vérifie que l'objet existe dans votre espace.</small>
            </div>
            <div className="core-form-actions core-span-2"><button className="core-button core-button--primary" type="submit" disabled={saving || !missionId}>{saving ? "Enregistrement…" : "Créer le constat"}</button></div>
          </form>}
      </div>
    </section>

    <section className="core-panel">
      <div className="core-panel__head"><div><h2>Registre des constats</h2><p>Les transitions de statut sont contrôlées par le serveur et journalisées.</p></div>
        <button type="button" className="core-button" onClick={() => void refresh()} disabled={loading}>Actualiser</button>
      </div>
      <div className="core-panel__body"><div className="core-filter">
        <select aria-label="Filtrer par mission" value={missionFilter} onChange={(event) => setMissionFilter(event.target.value)}>
          <option value="">Toutes les missions</option>{missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.reference} · {mission.title}</option>)}
        </select>
        <select aria-label="Filtrer par statut" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | FindingStatus)}>
          <option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Filtrer par gravité" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "" | FindingSeverity)}>
          <option value="">Toutes les gravités</option>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div></div>
      {loading ? <div className="core-empty">Chargement des constats…</div> : filtered.length === 0 ? <div className="core-empty">Aucun constat ne correspond aux filtres.</div> :
        <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Constat</th><th>Mission</th><th>Gravité</th><th>Statut</th><th>Recommandation</th><th>Créé le</th><th>Actions</th></tr></thead>
          <tbody>{filtered.map((row) => {
            const mission = missionById.get(row.auditMissionId);
            const severityTone = row.severity === "CRITICAL" || row.severity === "MAJOR" ? "core-badge--danger" : row.severity === "HIGH" ? "core-badge--warning" : "";
            return <tr key={row.id}>
              <td><strong>{row.title}</strong><div className="muted">{row.description}</div>{row.relatedObjectType && <div className="muted">Lié à : {relatedTypeLabels[row.relatedObjectType]} · {row.relatedObjectId}</div>}</td>
              <td>{mission ? <><strong>{mission.reference}</strong><div className="muted">{mission.title}</div></> : <span className="muted">{row.auditMissionId}</span>}</td>
              <td><span className={`core-badge ${severityTone}`}>{severityLabels[row.severity]}</span></td>
              <td><span className={`core-badge ${row.status === "CLOS" ? "core-badge--success" : row.status === "EN_TRAITEMENT" ? "core-badge--warning" : "core-badge--danger"}`}>{statusLabels[row.status]}</span></td>
              <td>{row.recommendation || "—"}</td><td>{dateLabel(row.createdAt)}</td>
              <td><div className="core-form-actions">
                {row.status === "OUVERT" && <button type="button" className="core-button" disabled={busyId === row.id} onClick={() => void startTreatment(row)}>{busyId === row.id ? "Traitement…" : "Démarrer"}</button>}
                {row.status !== "CLOS" && <button type="button" className="core-button" disabled={busyId === row.id} onClick={() => void closeFinding(row)}>{busyId === row.id ? "Clôture…" : "Clôturer"}</button>}
              </div></td>
            </tr>;
          })}</tbody></table></div>}
    </section>
    <div className="core-alert core-alert--info">Le texte de recommandation est conservé sur le constat. Le suivi opérationnel (responsable, échéance, avancement et preuve de clôture) doit être porté par un plan d'action lié à ce constat.</div>
    <div className="core-page__stats">
      <div className="core-stat"><span>En traitement</span><strong>{loading ? "—" : treatmentCount}</strong></div>
      <div className="core-stat"><span>Missions en cours</span><strong>{loading ? "—" : activeMissions.length}</strong></div>
      <div className="core-stat"><span>Actions disponibles</span><strong>{loading ? "—" : findings.filter((finding) => finding.status !== "CLOS").length}</strong></div>
    </div>
  </section>;
}
