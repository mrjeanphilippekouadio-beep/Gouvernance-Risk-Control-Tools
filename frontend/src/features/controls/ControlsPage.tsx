import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { controlsApi, type Control, type ControlType } from "../../api/controls";
import { risksApi, type Risk } from "../../api/risks";
import "../core/CorePages.css";

interface Props { token: string; }
const typeLabels: Record<ControlType, string> = { PREVENTIVE: "Préventif", DETECTIVE: "Détectif", CORRECTIVE: "Correctif" };
const describeError = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";

export function ControlsPage({ token }: Props) {
  const [rows, setRows] = useState<Control[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [objective, setObjective] = useState("");
  const [coveredRiskIds, setCoveredRiskIds] = useState<string[]>([]);
  const [controlType, setControlType] = useState<ControlType>("PREVENTIVE");
  const [process, setProcess] = useState("");
  const [frequency, setFrequency] = useState("Mensuelle");
  const [executor, setExecutor] = useState("");
  const [validator, setValidator] = useState("");
  const [procedureDescription, setProcedureDescription] = useState("");
  const [expectedEvidence, setExpectedEvidence] = useState("");
  const [complianceCriteria, setComplianceCriteria] = useState("");

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const [controls, riskRows] = await Promise.all([controlsApi.list(token, includeArchived), risksApi.list(token)]);
      setRows(controls); setRisks(riskRows.filter((risk) => risk.status !== "ARCHIVED"));
    } catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [token, includeArchived]);

  const filtered = useMemo(() => rows.filter((row) => [row.label, row.process ?? "", row.executor, row.complianceCriteria].join(" ").toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const activeCount = rows.filter((row) => row.status === "ACTIVE").length;
  const draftCount = rows.filter((row) => row.status === "DRAFT").length;

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await controlsApi.create(token, {
        label: label.trim(), objective: objective.trim() || null, coveredRiskIds, process: process.trim() || null,
        controlType, frequency, executor: executor.trim(), validator: validator.trim() || null,
        procedureDescription: procedureDescription.trim() || null, expectedEvidence: expectedEvidence.trim() || null,
        complianceCriteria: complianceCriteria.trim(),
      });
      setLabel(""); setObjective(""); setCoveredRiskIds([]); setProcess(""); setExecutor(""); setValidator(""); setProcedureDescription(""); setExpectedEvidence(""); setComplianceCriteria("");
      await refresh();
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  async function archive(row: Control) {
    const reason = window.prompt("Motif d’archivage du contrôle :");
    if (!reason?.trim()) return;
    setError(null);
    try { await controlsApi.archive(token, row.id, reason.trim()); await refresh(); }
    catch (err) { setError(describeError(err)); }
  }

  return <section className="core-page">
    <div className="core-page__heading"><div><p className="core-page__eyebrow">CONTRÔLE INTERNE · DISPOSITIF</p><h1>Contrôles</h1><p className="core-page__subtitle">Référentiel des contrôles associés aux risques : procédure, fréquence, exécutant, critères de conformité et preuves attendues.</p></div></div>
    <div className="core-page__stats"><div className="core-stat"><span>Contrôles affichés</span><strong>{loading ? "—" : rows.length}</strong></div><div className="core-stat"><span>Actifs</span><strong>{loading ? "—" : activeCount}</strong></div><div className="core-stat"><span>Brouillons</span><strong>{loading ? "—" : draftCount}</strong></div></div>
    {error && <div className="core-alert core-alert--error" role="alert">{error}</div>}
    <section className="core-panel"><div className="core-panel__head"><div><h2>Créer une fiche de contrôle</h2><p>Un contrôle doit couvrir au moins un risque. Les champs marqués * sont obligatoires.</p></div></div>
      <div className="core-panel__body"><form className="core-form" onSubmit={submit}>
        <div className="core-field"><label htmlFor="ctrl-label">Intitulé du contrôle *</label><input id="ctrl-label" value={label} onChange={(e) => setLabel(e.target.value)} required /></div>
        <div className="core-field"><label htmlFor="ctrl-type">Type *</label><select id="ctrl-type" value={controlType} onChange={(e) => setControlType(e.target.value as ControlType)}><option value="PREVENTIVE">Préventif</option><option value="DETECTIVE">Détectif</option><option value="CORRECTIVE">Correctif</option></select></div>
        <div className="core-field"><label htmlFor="ctrl-objective">Objectif</label><input id="ctrl-objective" value={objective} onChange={(e) => setObjective(e.target.value)} /></div>
        <div className="core-field"><label htmlFor="ctrl-process">Processus</label><input id="ctrl-process" value={process} onChange={(e) => setProcess(e.target.value)} /></div>
        <div className="core-field"><label htmlFor="ctrl-frequency">Fréquence *</label><select id="ctrl-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}><option>Quotidienne</option><option>Hebdomadaire</option><option>Mensuelle</option><option>Trimestrielle</option><option>Semestrielle</option><option>Annuelle</option><option>En continu</option></select></div>
        <div className="core-field"><label htmlFor="ctrl-executor">Exécutant / responsable *</label><input id="ctrl-executor" value={executor} onChange={(e) => setExecutor(e.target.value)} required /></div>
        <div className="core-field"><label htmlFor="ctrl-validator">Validateur</label><input id="ctrl-validator" value={validator} onChange={(e) => setValidator(e.target.value)} /></div>
        <div className="core-field core-span-2"><label>Risques couverts * (sélection multiple)</label><div className="core-table-wrap" style={{maxHeight:160,overflowY:"auto",border:"1px solid var(--gs-border)",borderRadius:8,padding:10}}>{risks.length === 0 ? <span className="muted">Aucun risque actif disponible : crée d’abord un risque dans le registre.</span> : risks.map((risk) => <label key={risk.id} style={{display:"flex",gap:8,alignItems:"start",padding:"5px 0",fontSize:12}}><input type="checkbox" checked={coveredRiskIds.includes(risk.id)} onChange={(e) => setCoveredRiskIds((current) => e.target.checked ? [...current, risk.id] : current.filter((id) => id !== risk.id))} /><span><strong>{risk.description}</strong><span className="muted"> · {risk.process}</span></span></label>)}</div></div>
        <div className="core-field core-span-2"><label htmlFor="ctrl-procedure">Description de la procédure</label><textarea id="ctrl-procedure" value={procedureDescription} onChange={(e) => setProcedureDescription(e.target.value)} /></div>
        <div className="core-field"><label htmlFor="ctrl-evidence">Preuve attendue</label><textarea id="ctrl-evidence" value={expectedEvidence} onChange={(e) => setExpectedEvidence(e.target.value)} /></div>
        <div className="core-field"><label htmlFor="ctrl-criteria">Critères de conformité *</label><textarea id="ctrl-criteria" value={complianceCriteria} onChange={(e) => setComplianceCriteria(e.target.value)} required /></div>
        <div className="core-form-actions core-span-2"><Button type="submit" variant="primary" disabled={saving || coveredRiskIds.length === 0}>{saving ? "Enregistrement…" : "Créer le contrôle"}</Button></div>
      </form></div>
    </section>
    <section className="core-panel"><div className="core-panel__head"><div><h2>Référentiel des contrôles</h2><p>Les exécutions et tests d’efficacité sont gérés dans des modules distincts.</p></div><label className="core-filter"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Inclure les archivés</label></div>
      <div className="core-panel__body"><div className="core-filter"><input aria-label="Rechercher un contrôle" placeholder="Rechercher un contrôle…" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
      {loading ? <div className="core-empty">Chargement des contrôles…</div> : filtered.length === 0 ? <div className="core-empty">Aucun contrôle correspondant.</div> :
      <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Contrôle</th><th>Risques couverts</th><th>Type</th><th>Fréquence</th><th>Exécutant</th><th>Statut</th><th>Action</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.label}</strong>{row.objective && <div className="muted">{row.objective}</div>}<div className="muted">{row.process || "Processus non renseigné"}</div></td><td>{row.coveredRiskIds.length}</td><td>{typeLabels[row.controlType]}</td><td>{row.frequency}</td><td>{row.executor}</td><td><span className={`core-badge ${row.status === "ACTIVE" ? "core-badge--success" : row.status === "DRAFT" ? "core-badge--warning" : ""}`}>{row.status === "ACTIVE" ? "Actif" : row.status === "DRAFT" ? "Brouillon" : "Archivé"}</span></td><td>{row.status !== "ARCHIVED" && <Button variant="destructive" onClick={() => void archive(row)}>Archiver</Button>}</td></tr>)}</tbody></table></div>}
    </section>
  </section>;
}
