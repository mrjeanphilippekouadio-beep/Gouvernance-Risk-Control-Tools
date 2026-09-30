import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { ratingScalesApi, type RatingScale } from "../../api/evaluations";
import "../core/CorePages.css";

interface Props { token: string; }
const describeError = (err: unknown) => err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}` : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";

export function RatingScalesPage({ token }: Props) {
  const [rows, setRows] = useState<RatingScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Méthodologie GRC");
  const [version, setVersion] = useState("v1.0");
  const [probabilityLevels, setProbabilityLevels] = useState("5");
  const [impactLevels, setImpactLevels] = useState("5");
  const [includeArchived, setIncludeArchived] = useState(false);

  async function refresh() {
    setLoading(true); setError(null);
    try { setRows(await ratingScalesApi.list(token, includeArchived)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [token, includeArchived]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await ratingScalesApi.create(token, { name: name.trim(), version: version.trim(), probabilityLevels: Number(probabilityLevels), impactLevels: Number(impactLevels) });
      await refresh();
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  async function activate(row: RatingScale) {
    setError(null);
    try { await ratingScalesApi.activate(token, row.id); await refresh(); }
    catch (err) { setError(describeError(err)); }
  }

  return <section className="core-page">
    <div className="core-page__heading"><div><p className="core-page__eyebrow">RISQUES · MÉTHODOLOGIE</p><h1>Grilles de cotation</h1><p className="core-page__subtitle">Gérer les versions de la méthode de cotation : niveaux de probabilité, niveaux d’impact et activation de la version utilisée par les évaluations.</p></div></div>
    <div className="core-page__stats"><div className="core-stat"><span>Versions affichées</span><strong>{loading ? "—" : rows.length}</strong></div><div className="core-stat"><span>Version active</span><strong>{loading ? "—" : rows.filter((row) => row.status === "ACTIVE").length}</strong></div><div className="core-stat"><span>Versions en brouillon</span><strong>{loading ? "—" : rows.filter((row) => row.status === "DRAFT").length}</strong></div></div>
    {error && <div className="core-alert core-alert--error" role="alert">{error}</div>}
    <section className="core-panel"><div className="core-panel__head"><div><h2>Créer une version</h2><p>Les niveaux sont bornés de 1 à 5 par la règle métier du backend.</p></div></div><div className="core-panel__body"><form className="core-form" onSubmit={submit}>
      <div className="core-field"><label htmlFor="scale-name">Nom de la méthode *</label><input id="scale-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="core-field"><label htmlFor="scale-version">Version *</label><input id="scale-version" value={version} onChange={(e) => setVersion(e.target.value)} required /></div>
      <div className="core-field"><label htmlFor="scale-probability">Niveaux de probabilité *</label><select id="scale-probability" value={probabilityLevels} onChange={(e) => setProbabilityLevels(e.target.value)}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} niveau(x)</option>)}</select></div>
      <div className="core-field"><label htmlFor="scale-impact">Niveaux d’impact *</label><select id="scale-impact" value={impactLevels} onChange={(e) => setImpactLevels(e.target.value)}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} niveau(x)</option>)}</select></div>
      <div className="core-form-actions core-span-2"><Button type="submit" variant="primary" disabled={saving}>{saving ? "Création…" : "Créer la version"}</Button></div>
    </form></div></section>
    <section className="core-panel"><div className="core-panel__head"><div><h2>Versions de cotation</h2><p>Une version doit être activée pour être proposée par défaut dans les évaluations.</p></div><label className="core-filter"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Inclure les archivées</label></div>
      {loading ? <div className="core-empty">Chargement des grilles…</div> : rows.length === 0 ? <div className="core-empty">Aucune grille enregistrée.</div> :
      <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Méthodologie</th><th>Version</th><th>Probabilité</th><th>Impact</th><th>Axes d’impact</th><th>Statut</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.version}</td><td>{row.probabilityLevels} niveaux</td><td>{row.impactLevels} niveaux</td><td>{row.impactAxes?.axes.length ?? 0}</td><td><span className={`core-badge ${row.status === "ACTIVE" ? "core-badge--success" : row.status === "DRAFT" ? "core-badge--warning" : ""}`}>{row.status === "ACTIVE" ? "Active" : row.status === "DRAFT" ? "Brouillon" : "Archivée"}</span></td><td>{row.status === "DRAFT" && <Button variant="primary" onClick={() => void activate(row)}>Activer</Button>}</td></tr>)}</tbody></table></div>}
    </section>
    <div className="core-alert core-alert--info">Cette page gère la création et l’activation des versions. La configuration détaillée des seuils de criticité, des axes d’impact et des niveaux de maîtrise pourra être ajoutée comme sous-sections dédiées.</div>
  </section>;
}
