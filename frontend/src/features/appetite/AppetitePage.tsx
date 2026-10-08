import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, FormField, Modal } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { riskAppetiteApi, type RiskAppetite } from "../../api/riskAppetite";
import "../core/CorePages.css";

interface Props { token: string; }
const describeError = (err: unknown) => err instanceof ApiError
  ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`
  : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";

export function AppetitePage({ token }: Props) {
  const [rows, setRows] = useState<RiskAppetite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [subCategory, setSubCategory] = useState("");
  const [entity, setEntity] = useState("");
  const [threshold, setThreshold] = useState("12");
  const [methodologyVersion, setMethodologyVersion] = useState("v1.0");
  const [description, setDescription] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<RiskAppetite | null>(null);
  const [archiveReason, setArchiveReason] = useState("");

  async function refresh() {
    setLoading(true); setError(null);
    try { setRows(await riskAppetiteApi.list(token, includeInactive)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [token, includeInactive]);

  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);
  const criticalCount = useMemo(() => rows.filter((row) => row.threshold <= 8 && row.active).length, [rows]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await riskAppetiteApi.set(token, subCategory.trim(), {
        threshold: Number(threshold), methodologyVersion: methodologyVersion.trim(),
        entity: entity.trim() || null, description: description.trim() || null, active: true,
      });
      setSubCategory(""); setEntity(""); setDescription("");
      await refresh();
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  async function archive() {
    if (!archiveTarget || !archiveReason.trim()) return;
    setSaving(true); setError(null);
    try {
      await riskAppetiteApi.archive(token, archiveTarget.id, archiveReason.trim());
      setArchiveTarget(null); setArchiveReason("");
      await refresh();
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  return <section className="core-page">
    <div className="core-page__heading"><div><p className="core-page__eyebrow">RISQUES · GOUVERNANCE</p><h1>Appétence au risque</h1><p className="core-page__subtitle">L'appétence est la référence de décision consultée pendant le cycle d'évaluation (comparaison au score résiduel, page Évaluations) — elle n'est pas une fin en soi isolée. Cette page définit les seuils par sous-catégorie et, si nécessaire, par entité ; elle ne déclenche ni ne recalcule une évaluation.</p></div></div>
    <div className="core-page__stats">
      <div className="core-stat"><span>Seuils affichés</span><strong>{loading ? "—" : rows.length}</strong></div>
      <div className="core-stat"><span>Seuils actifs</span><strong>{loading ? "—" : activeCount}</strong></div>
      <div className="core-stat"><span>Seuils actifs ≤ 8/25</span><strong>{loading ? "—" : criticalCount}</strong></div>
    </div>
    {error && <div className="core-alert core-alert--error" role="alert">{error}</div>}
    <section className="core-panel">
      <div className="core-panel__head"><div><h2>Définir un seuil</h2><p>Un seuil existant pour la même sous-catégorie et entité sera mis à jour.</p></div></div>
      <div className="core-panel__body"><form className="core-form" onSubmit={submit}>
        <div className="core-field"><label htmlFor="app-subcategory">Sous-catégorie de risque *</label><input id="app-subcategory" value={subCategory} onChange={(e) => setSubCategory(e.target.value)} required maxLength={160} placeholder="Ex. Fraude et sécurité" /></div>
        <div className="core-field"><label htmlFor="app-entity">Entité (facultatif)</label><input id="app-entity" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Vide = toutes les entités" /></div>
        <div className="core-field"><label htmlFor="app-threshold">Seuil maximal (1 à 25) *</label><input id="app-threshold" type="number" min="1" max="25" step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} required /></div>
        <div className="core-field"><label htmlFor="app-version">Version méthodologique *</label><input id="app-version" value={methodologyVersion} onChange={(e) => setMethodologyVersion(e.target.value)} required /></div>
        <div className="core-field core-span-2"><label htmlFor="app-description">Justification / commentaire</label><textarea id="app-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexte, justification du seuil, instance de validation…" /></div>
        <div className="core-form-actions core-span-2"><Button type="submit" variant="primary" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer le seuil"}</Button></div>
      </form></div>
    </section>
    <section className="core-panel">
      <div className="core-panel__head"><div><h2>Référentiel des seuils</h2><p>Les seuils inactifs sont masqués par défaut.</p></div><label className="core-filter"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Inclure les inactifs</label></div>
      {loading ? <div className="core-empty">Chargement des seuils…</div> : rows.length === 0 ? <div className="core-empty">Aucun seuil d’appétence enregistré. Crée le premier seuil avec le formulaire ci-dessus.</div> :
      <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Sous-catégorie</th><th>Entité</th><th>Seuil /25</th><th>Méthodologie</th><th>État</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.subCategory}</strong>{row.description && <div className="muted">{row.description}</div>}</td><td>{row.entity || <span className="muted">Toutes</span>}</td><td><strong>{row.threshold}/25</strong></td><td>{row.methodologyVersion}</td><td><span className={`core-badge ${row.active ? "core-badge--success" : "core-badge--warning"}`}>{row.active ? "Actif" : "Inactif"}</span></td><td>{row.active && <Button variant="destructive" onClick={() => { setArchiveTarget(row); setArchiveReason(""); setError(null); }}>Retirer</Button>}</td></tr>)}</tbody></table></div>}
    </section>
    <Modal open={!!archiveTarget} onClose={() => { if (!saving) { setArchiveTarget(null); setArchiveReason(""); } }} title="Retirer le seuil d’appétence" actions={<><Button onClick={() => { setArchiveTarget(null); setArchiveReason(""); }} disabled={saving}>Annuler</Button><Button variant="destructive" disabled={!archiveTarget || !archiveReason.trim() || saving} onClick={() => void archive()}>{saving ? "Retrait…" : "Confirmer le retrait"}</Button></>}>
      <p>Le retrait est une transition métier irréversible pour ce seuil. Un motif est obligatoire et sera conservé dans la traçabilité.</p>
      <FormField label="Motif de retrait" htmlFor="app-archive-reason" help="Décris brièvement pourquoi ce seuil n’est plus applicable.">
        <textarea id="app-archive-reason" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={4} required autoFocus />
      </FormField>
    </Modal>
    <div className="core-alert core-alert--info">Ce module gère uniquement le seuil de score (1 à 25) par sous-catégorie/entité. La comparaison au score résiduel et le signalement de dépassement se font depuis le cycle d'évaluation (page Évaluations) ; cette page ne les déclenche pas.</div>
    <div className="core-alert core-alert--info">
      <strong>Décision de traitement en cas de dépassement (§8).</strong> Les 5 options validées — Accepter, Surveiller, Réduire, Transférer, Éviter — restent distinctes (Accepter ≠ Surveiller). Aucune n'est gérée ici : il n'existe à ce jour aucune entité/endpoint Treatment Decision côté backend (gap déjà consigné, voir <code>ACTION_ITEMS.md</code>, entrée « GAPS FRONTEND RM V1 »). Cette page n'invente donc aucune action de déclenchement.
    </div>
    <div className="core-alert core-alert--info">
      <strong>Seuils de passage Comité (§8).</strong> Le contrat exige deux seuils indépendants et configurables côté backend — l'un pour le passage en Comité de l'Évaluation, l'autre pour le passage en Comité de la Treatment Decision. Aujourd'hui, seul le premier existe, et il est codé en dur côté backend (<code>COMMITTEE_VALIDATION_MIN_SCORE = 15</code>, <code>RiskEvaluationService.ts</code>) — ni configurable, ni exposé par une API. Le second n'a pas d'équivalent (Treatment Decision absente). Cette page n'affiche ni ne permet de modifier un seuil Comité : ce n'est pas un seuil d'appétence (score) et aucun contrat n'existe pour l'éditer.
    </div>
  </section>;
}
