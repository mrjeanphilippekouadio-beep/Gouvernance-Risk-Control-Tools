import { useEffect, useState, type FormEvent } from "react";
import { Button, Modal, Table, type TableColumn } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import {
  ratingScalesApi,
  type ImpactAxis,
  type RatingScale,
  type ScaleLevel,
  type ScoreThreshold,
} from "../../api/evaluations";
import "../core/CorePages.css";
import "./RatingScalesPage.css";

interface Props { token: string; }

const describeError = (err: unknown) =>
  err instanceof ApiError ? `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`
    : err instanceof Error ? err.message : "Une erreur inattendue est survenue.";

const RETAINED_IMPACT_RULE_LABEL: Record<string, string> = {
  MAX: "Maximum des axes (règle de référence, §6)",
  AVERAGE: "Moyenne des axes",
  WEIGHTED_SUM: "Somme pondérée des axes",
};

/** A level/axis/threshold row never has a stable backend id before save — index-keyed rows are the whole row's identity while editing, matching the array-of-plain-values shape these JSONB sub-configs have (see RatingScale.ts header). */
function withRow<T>(rows: T[], index: number, patch: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}
function withoutRow<T>(rows: T[], index: number): T[] {
  return rows.filter((_, i) => i !== index);
}

export function RatingScalesPage({ token }: Props) {
  const [rows, setRows] = useState<RatingScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("Méthodologie GRC");
  const [version, setVersion] = useState("v1.0");
  const [probabilityLevels, setProbabilityLevels] = useState("5");
  const [impactLevels, setImpactLevels] = useState("5");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const editable = selected?.status === "DRAFT";

  // Axes d'impact (§6) — jamais de nombre d'axes supposé : tableau libre,
  // 0..N lignes ajoutées/retirées par l'utilisateur, aucune constante.
  const [axesDraft, setAxesDraft] = useState<ImpactAxis[]>([]);
  const [retainedImpactRule, setRetainedImpactRule] = useState<"MAX" | "AVERAGE" | "WEIGHTED_SUM">("MAX");
  const [savingAxes, setSavingAxes] = useState(false);

  const [thresholdsDraft, setThresholdsDraft] = useState<ScoreThreshold[]>([]);
  const [savingThresholds, setSavingThresholds] = useState(false);

  const [velocityDraft, setVelocityDraft] = useState<ScaleLevel[]>([]);
  const [savingVelocity, setSavingVelocity] = useState(false);

  const [persistenceDraft, setPersistenceDraft] = useState<ScaleLevel[]>([]);
  const [savingPersistence, setSavingPersistence] = useState(false);

  const [masteryLevelsDraft, setMasteryLevelsDraft] = useState<ScaleLevel[]>([]);
  const [masteryLinesDraft, setMasteryLinesDraft] = useState<string[]>([]);
  const [masteryThresholdsDraft, setMasteryThresholdsDraft] = useState<ScoreThreshold[]>([]);
  const [savingMastery, setSavingMastery] = useState(false);

  const [disableTarget, setDisableTarget] = useState<RatingScale | null>(null);
  const [disableReason, setDisableReason] = useState("");
  const [disabling, setDisabling] = useState(false);

  async function refresh() {
    setLoading(true); setError(null);
    try { setRows(await ratingScalesApi.list(token, includeArchived)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [token, includeArchived]);

  function selectScale(scale: RatingScale) {
    setSelectedId(scale.id);
    setError(null); setNotice(null);
    setAxesDraft(scale.impactAxes?.axes ?? []);
    setRetainedImpactRule(scale.impactAxes?.retainedImpactRule ?? "MAX");
    setThresholdsDraft(scale.criticalityThresholds ?? []);
    setVelocityDraft(scale.velocityLevels ?? []);
    setPersistenceDraft(scale.persistenceLevels ?? []);
    setMasteryLevelsDraft(scale.masteryScale?.levels ?? []);
    setMasteryLinesDraft(scale.masteryScale?.defenseLines ?? []);
    setMasteryThresholdsDraft(scale.masteryScale?.thresholds ?? []);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await ratingScalesApi.create(token, { name: name.trim(), version: version.trim(), probabilityLevels: Number(probabilityLevels), impactLevels: Number(impactLevels) });
      await refresh();
    } catch (err) { setError(describeError(err)); }
    finally { setSaving(false); }
  }

  async function activate(row: RatingScale) {
    setError(null);
    try {
      const updated = await ratingScalesApi.activate(token, row.id);
      await refresh();
      if (selectedId === row.id) selectScale(updated);
    } catch (err) { setError(describeError(err)); }
  }

  async function saveAxes() {
    if (!selected) return;
    setSavingAxes(true); setError(null); setNotice(null);
    try {
      const updated = await ratingScalesApi.updateImpactAxes(token, selected.id, { axes: axesDraft, retainedImpactRule });
      await refresh(); selectScale(updated);
      setNotice("Axes d'impact enregistrés.");
    } catch (err) { setError(describeError(err)); }
    finally { setSavingAxes(false); }
  }

  async function saveThresholds() {
    if (!selected) return;
    setSavingThresholds(true); setError(null); setNotice(null);
    try {
      const updated = await ratingScalesApi.updateThresholds(token, selected.id, thresholdsDraft);
      await refresh(); selectScale(updated);
      setNotice("Seuils de criticité enregistrés.");
    } catch (err) { setError(describeError(err)); }
    finally { setSavingThresholds(false); }
  }

  async function saveVelocity() {
    if (!selected) return;
    setSavingVelocity(true); setError(null); setNotice(null);
    try {
      const updated = await ratingScalesApi.updateVelocity(token, selected.id, velocityDraft);
      await refresh(); selectScale(updated);
      setNotice("Niveaux de vélocité enregistrés.");
    } catch (err) { setError(describeError(err)); }
    finally { setSavingVelocity(false); }
  }

  async function savePersistence() {
    if (!selected) return;
    setSavingPersistence(true); setError(null); setNotice(null);
    try {
      const updated = await ratingScalesApi.updatePersistence(token, selected.id, persistenceDraft);
      await refresh(); selectScale(updated);
      setNotice("Niveaux de persistance enregistrés.");
    } catch (err) { setError(describeError(err)); }
    finally { setSavingPersistence(false); }
  }

  async function saveMastery() {
    if (!selected) return;
    setSavingMastery(true); setError(null); setNotice(null);
    try {
      const updated = await ratingScalesApi.updateMastery(token, selected.id, {
        levels: masteryLevelsDraft,
        defenseLines: masteryLinesDraft,
        thresholds: masteryThresholdsDraft.length > 0 ? masteryThresholdsDraft : null,
      });
      await refresh(); selectScale(updated);
      setNotice("Maîtrise globale enregistrée.");
    } catch (err) { setError(describeError(err)); }
    finally { setSavingMastery(false); }
  }

  async function confirmDisable() {
    if (!disableTarget || !disableReason.trim()) return;
    setDisabling(true); setError(null);
    try {
      await ratingScalesApi.disable(token, disableTarget.id, disableReason.trim());
      setDisableTarget(null); setDisableReason("");
      if (selectedId === disableTarget.id) setSelectedId(null);
      await refresh();
    } catch (err) { setError(describeError(err)); }
    finally { setDisabling(false); }
  }

  const axisColumns: TableColumn<ImpactAxis>[] = [
    { key: "code", header: "Code", render: (axis) => { const i = axesDraft.indexOf(axis); return editable
      ? <input className="scales-row-input" value={axis.code} onChange={(e) => setAxesDraft((prev) => withRow(prev, i, { code: e.target.value }))} />
      : <span className="scales-readonly-value">{axis.code}</span>; } },
    { key: "label", header: "Libellé", render: (axis) => { const i = axesDraft.indexOf(axis); return editable
      ? <input className="scales-row-input" value={axis.label} onChange={(e) => setAxesDraft((prev) => withRow(prev, i, { label: e.target.value }))} />
      : <span className="scales-readonly-value">{axis.label}</span>; } },
    { key: "order", header: "Ordre", render: (axis) => { const i = axesDraft.indexOf(axis); return editable
      ? <input className="scales-row-input" type="number" value={axis.order} onChange={(e) => setAxesDraft((prev) => withRow(prev, i, { order: Number(e.target.value) }))} />
      : <span className="scales-readonly-value">{axis.order}</span>; } },
    ...(editable ? [{ key: "actions", header: "", render: (axis: ImpactAxis) => { const i = axesDraft.indexOf(axis); return <div className="scales-row-actions"><Button variant="destructive" onClick={() => setAxesDraft((prev) => withoutRow(prev, i))}>Retirer</Button></div>; } }] : []),
  ];

  const thresholdColumns = (draft: ScoreThreshold[], setDraft: (v: ScoreThreshold[]) => void): TableColumn<ScoreThreshold>[] => [
    { key: "label", header: "Libellé", render: (t) => { const i = draft.indexOf(t); return editable
      ? <input className="scales-row-input" value={t.label} onChange={(e) => setDraft(withRow(draft, i, { label: e.target.value }))} />
      : <span className="scales-readonly-value">{t.label}</span>; } },
    { key: "min", header: "Min", render: (t) => { const i = draft.indexOf(t); return editable
      ? <input className="scales-row-input" type="number" value={t.min} onChange={(e) => setDraft(withRow(draft, i, { min: Number(e.target.value) }))} />
      : <span className="scales-readonly-value">{t.min}</span>; } },
    { key: "max", header: "Max", render: (t) => { const i = draft.indexOf(t); return editable
      ? <input className="scales-row-input" type="number" value={t.max} onChange={(e) => setDraft(withRow(draft, i, { max: Number(e.target.value) }))} />
      : <span className="scales-readonly-value">{t.max}</span>; } },
    ...(editable ? [{ key: "actions", header: "", render: (t: ScoreThreshold) => { const i = draft.indexOf(t); return <div className="scales-row-actions"><Button variant="destructive" onClick={() => setDraft(withoutRow(draft, i))}>Retirer</Button></div>; } }] : []),
  ];

  const levelColumns = (draft: ScaleLevel[], setDraft: (v: ScaleLevel[]) => void): TableColumn<ScaleLevel>[] => [
    { key: "level", header: "Niveau", render: (l) => { const i = draft.indexOf(l); return editable
      ? <input className="scales-row-input" type="number" value={l.level} onChange={(e) => setDraft(withRow(draft, i, { level: Number(e.target.value) }))} />
      : <span className="scales-readonly-value">{l.level}</span>; } },
    { key: "label", header: "Libellé", render: (l) => { const i = draft.indexOf(l); return editable
      ? <input className="scales-row-input" value={l.label} onChange={(e) => setDraft(withRow(draft, i, { label: e.target.value }))} />
      : <span className="scales-readonly-value">{l.label}</span>; } },
    ...(editable ? [{ key: "actions", header: "", render: (l: ScaleLevel) => { const i = draft.indexOf(l); return <div className="scales-row-actions"><Button variant="destructive" onClick={() => setDraft(withoutRow(draft, i))}>Retirer</Button></div>; } }] : []),
  ];

  return <section className="core-page">
    <div className="core-page__heading"><div><p className="core-page__eyebrow">RISQUES · MÉTHODOLOGIE</p><h1>Grilles de cotation</h1><p className="core-page__subtitle">Référentiel de cotation configurable : niveaux de probabilité/impact, axes d'impact (nombre libre), seuils de criticité, vélocité, persistance et maîtrise globale. Une version n'est modifiable qu'en brouillon (R-01) ; une fois active, elle devient immuable et toute évolution passe par une nouvelle version.</p></div></div>
    <div className="core-page__stats"><div className="core-stat"><span>Versions affichées</span><strong>{loading ? "—" : rows.length}</strong></div><div className="core-stat"><span>Version active</span><strong>{loading ? "—" : rows.filter((row) => row.status === "ACTIVE").length}</strong></div><div className="core-stat"><span>Versions en brouillon</span><strong>{loading ? "—" : rows.filter((row) => row.status === "DRAFT").length}</strong></div></div>
    {error && <div className="core-alert core-alert--error" role="alert">{error}</div>}
    {notice && <div className="core-alert core-alert--info" role="status">{notice}</div>}

    <section className="core-panel"><div className="core-panel__head"><div><h2>Créer une version</h2><p>Les niveaux de probabilité et d'impact (grille N×N) sont bornés de 1 à 5 par la règle métier du backend. Les axes d'impact, seuils, vélocité, persistance et maîtrise se configurent ensuite, une fois la version créée (brouillon).</p></div></div><div className="core-panel__body"><form className="core-form" onSubmit={submitCreate}>
      <div className="core-field"><label htmlFor="scale-name">Nom de la méthode *</label><input id="scale-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="core-field"><label htmlFor="scale-version">Version *</label><input id="scale-version" value={version} onChange={(e) => setVersion(e.target.value)} required /></div>
      <div className="core-field"><label htmlFor="scale-probability">Niveaux de probabilité *</label><select id="scale-probability" value={probabilityLevels} onChange={(e) => setProbabilityLevels(e.target.value)}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} niveau(x)</option>)}</select></div>
      <div className="core-field"><label htmlFor="scale-impact">Niveaux d'impact *</label><select id="scale-impact" value={impactLevels} onChange={(e) => setImpactLevels(e.target.value)}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} niveau(x)</option>)}</select></div>
      <div className="core-form-actions core-span-2"><Button type="submit" variant="primary" disabled={saving}>{saving ? "Création…" : "Créer la version"}</Button></div>
    </form></div></section>

    <section className="core-panel"><div className="core-panel__head"><div><h2>Versions de cotation</h2><p>Sélectionne une version pour configurer ses axes d'impact, seuils et niveaux. Une version doit être activée pour être proposée par défaut dans les évaluations.</p></div><label className="core-filter"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Inclure les archivées</label></div>
      {loading ? <div className="core-empty">Chargement des grilles…</div> : rows.length === 0 ? <div className="core-empty">Aucune grille enregistrée.</div> :
      <div className="core-table-wrap"><table className="core-table"><thead><tr><th>Méthodologie</th><th>Version</th><th>Probabilité</th><th>Impact</th><th>Axes d'impact</th><th>Statut</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={row.id === selectedId ? "core-badge--success" : undefined}><td><strong>{row.name}</strong></td><td>{row.version}</td><td>{row.probabilityLevels} niveaux</td><td>{row.impactLevels} niveaux</td><td>{row.impactAxes?.axes.length ?? 0}</td><td><span className={`core-badge ${row.status === "ACTIVE" ? "core-badge--success" : row.status === "DRAFT" ? "core-badge--warning" : ""}`}>{row.status === "ACTIVE" ? "Active" : row.status === "DRAFT" ? "Brouillon" : "Archivée"}</span></td><td><div className="scales-row-actions"><Button onClick={() => selectScale(row)}>Configurer</Button>{row.status === "DRAFT" && <Button variant="primary" onClick={() => void activate(row)}>Activer</Button>}{row.status !== "ACTIVE" && <Button variant="destructive" onClick={() => { setDisableTarget(row); setDisableReason(""); setError(null); }}>Désactiver</Button>}</div></td></tr>)}</tbody></table></div>}
    </section>

    {selected && <section className="core-panel scales-detail">
      <div className="core-panel__head scales-detail-head"><div><h2>Configuration — {selected.name} ({selected.version})</h2><p>{editable ? "Version en brouillon : chaque sous-section s'enregistre indépendamment via sa propre action métier (pas de PATCH générique)." : "Version active ou archivée : immuable (R-01). Crée une nouvelle version (DRAFT) pour faire évoluer cette méthodologie."}</p></div><span className={`core-badge ${selected.status === "ACTIVE" ? "core-badge--success" : selected.status === "DRAFT" ? "core-badge--warning" : ""}`}>{selected.status === "ACTIVE" ? "Active — immuable" : selected.status === "DRAFT" ? "Brouillon — modifiable" : "Archivée — immuable"}</span></div>

      <div className="core-panel__body">
        <div className="core-alert core-alert--info">
          <strong>Niveaux de probabilité/impact (grille {selected.probabilityLevels}×{selected.impactLevels}).</strong> Ces libellés ne sont fixés qu'à la création de la version — aucun endpoint backend ne permet de les modifier ensuite (gap consigné, voir <code>ACTION_ITEMS.md</code>, entrée « GAPS FRONTEND RM V1 »). Affichage en lecture seule : {(selected.probabilityLabels ?? Array.from({ length: selected.probabilityLevels }, (_, i) => ({ level: i + 1, label: `Niveau ${i + 1}` }))).map((l) => l.label).join(" · ")} (probabilité) / {(selected.impactLabels ?? Array.from({ length: selected.impactLevels }, (_, i) => ({ level: i + 1, label: `Niveau ${i + 1}` }))).map((l) => l.label).join(" · ")} (impact).
        </div>

        <section className="core-panel" style={{ marginTop: 14 }}>
          <div className="core-panel__head"><div><h2>Axes d'impact (§6)</h2><p>Nombre d'axes libre — ajoute ou retire une ligne sans limite imposée par le code. L'impact retenu de l'évaluation est dérivé de ces axes selon la règle choisie.</p></div></div>
          <div className="core-panel__body">
            <Table columns={axisColumns} rows={axesDraft} rowKey={(axis) => `${axesDraft.indexOf(axis)}`} loading={false} emptyMessage="Aucun axe configuré." />
            <div className="core-form-actions" style={{ marginTop: 10 }}>
              {editable && <Button className="scales-add-row" onClick={() => setAxesDraft((prev) => [...prev, { code: "", label: "", order: prev.length + 1 }])}>Ajouter un axe</Button>}
              <div className="core-field" style={{ maxWidth: 320 }}>
                <label htmlFor="axis-rule">Règle de l'impact retenu</label>
                {editable
                  ? <select id="axis-rule" value={retainedImpactRule} onChange={(e) => setRetainedImpactRule(e.target.value as typeof retainedImpactRule)}>{Object.entries(RETAINED_IMPACT_RULE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  : <span className="scales-readonly-value">{RETAINED_IMPACT_RULE_LABEL[selected.impactAxes?.retainedImpactRule ?? "MAX"]}</span>}
              </div>
              {editable && <Button variant="primary" disabled={savingAxes || axesDraft.length === 0} onClick={() => void saveAxes()}>{savingAxes ? "Enregistrement…" : "Enregistrer les axes"}</Button>}
            </div>
          </div>
        </section>

        <section className="core-panel" style={{ marginTop: 14 }}>
          <div className="core-panel__head"><div><h2>Seuils de criticité</h2><p>Bandes de score (ex. Faible, Modéré, Élevé, Critique) utilisées pour qualifier un score Probabilité × Impact.</p></div></div>
          <div className="core-panel__body">
            <Table columns={thresholdColumns(thresholdsDraft, setThresholdsDraft)} rows={thresholdsDraft} rowKey={(t) => `${thresholdsDraft.indexOf(t)}`} loading={false} emptyMessage="Aucun seuil configuré." />
            <div className="core-form-actions" style={{ marginTop: 10 }}>
              {editable && <Button onClick={() => setThresholdsDraft((prev) => [...prev, { label: "", min: 1, max: 1 }])}>Ajouter un seuil</Button>}
              {editable && <Button variant="primary" disabled={savingThresholds || thresholdsDraft.length === 0} onClick={() => void saveThresholds()}>{savingThresholds ? "Enregistrement…" : "Enregistrer les seuils"}</Button>}
            </div>
          </div>
        </section>

        <section className="core-panel" style={{ marginTop: 14 }}>
          <div className="core-panel__head"><div><h2>Vélocité</h2><p>Niveaux ordinaux (1..5) appréciant la rapidité de matérialisation du risque, distincts du score Probabilité × Impact.</p></div></div>
          <div className="core-panel__body">
            <Table columns={levelColumns(velocityDraft, setVelocityDraft)} rows={velocityDraft} rowKey={(l) => `${velocityDraft.indexOf(l)}`} loading={false} emptyMessage="Aucun niveau de vélocité configuré." />
            <div className="core-form-actions" style={{ marginTop: 10 }}>
              {editable && <Button onClick={() => setVelocityDraft((prev) => [...prev, { level: prev.length + 1, label: "" }])} disabled={velocityDraft.length >= 5}>Ajouter un niveau</Button>}
              {editable && <Button variant="primary" disabled={savingVelocity || velocityDraft.length === 0} onClick={() => void saveVelocity()}>{savingVelocity ? "Enregistrement…" : "Enregistrer la vélocité"}</Button>}
            </div>
          </div>
        </section>

        <section className="core-panel" style={{ marginTop: 14 }}>
          <div className="core-panel__head"><div><h2>Persistance</h2><p>Niveaux ordinaux (1..5) appréciant la durée dans le temps des effets du risque.</p></div></div>
          <div className="core-panel__body">
            <Table columns={levelColumns(persistenceDraft, setPersistenceDraft)} rows={persistenceDraft} rowKey={(l) => `${persistenceDraft.indexOf(l)}`} loading={false} emptyMessage="Aucun niveau de persistance configuré." />
            <div className="core-form-actions" style={{ marginTop: 10 }}>
              {editable && <Button onClick={() => setPersistenceDraft((prev) => [...prev, { level: prev.length + 1, label: "" }])} disabled={persistenceDraft.length >= 5}>Ajouter un niveau</Button>}
              {editable && <Button variant="primary" disabled={savingPersistence || persistenceDraft.length === 0} onClick={() => void savePersistence()}>{savingPersistence ? "Enregistrement…" : "Enregistrer la persistance"}</Button>}
            </div>
          </div>
        </section>

        <section className="core-panel" style={{ marginTop: 14 }}>
          <div className="core-panel__head"><div><h2>Maîtrise globale (§5)</h2><p>Niveaux de maîtrise (1..3), lignes de défense évaluées et agrégation. L'agrégation est <strong>MIN non-compensatoire</strong> (CHALLENGE-001, décision PO définitive) — ce n'est jamais un choix proposé ici.</p></div></div>
          <div className="core-panel__body">
            <p className="scales-mastery-note">Agrégation des lignes de défense : <strong>MIN (non-compensatoire)</strong> — une ligne faible domine toujours le résultat, cette règle n'est pas éditable.</p>
            <Table columns={levelColumns(masteryLevelsDraft, setMasteryLevelsDraft)} rows={masteryLevelsDraft} rowKey={(l) => `${masteryLevelsDraft.indexOf(l)}`} loading={false} emptyMessage="Aucun niveau de maîtrise configuré." />
            {editable && <Button onClick={() => setMasteryLevelsDraft((prev) => [...prev, { level: prev.length + 1, label: "" }])} disabled={masteryLevelsDraft.length >= 3} style={{ marginTop: 10 }}>Ajouter un niveau</Button>}

            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Lignes de défense évaluées</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {masteryLinesDraft.map((line, i) => <div key={i} className="scales-row-actions" style={{ justifyContent: "flex-start" }}>
                  {editable
                    ? <input className="scales-row-input" style={{ maxWidth: 280 }} value={line} onChange={(e) => setMasteryLinesDraft((prev) => prev.map((l, idx) => idx === i ? e.target.value : l))} />
                    : <span className="scales-readonly-value">{line}</span>}
                  {editable && <Button variant="destructive" onClick={() => setMasteryLinesDraft((prev) => withoutRow(prev, i))}>Retirer</Button>}
                </div>)}
                {masteryLinesDraft.length === 0 && <div className="core-empty">Aucune ligne de défense configurée.</div>}
              </div>
              {editable && <Button onClick={() => setMasteryLinesDraft((prev) => [...prev, ""])} style={{ marginTop: 8 }}>Ajouter une ligne de défense</Button>}
            </div>

            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Seuils de maîtrise (facultatif)</h3>
              <Table columns={thresholdColumns(masteryThresholdsDraft, setMasteryThresholdsDraft)} rows={masteryThresholdsDraft} rowKey={(t) => `${masteryThresholdsDraft.indexOf(t)}`} loading={false} emptyMessage="Aucun seuil de maîtrise configuré." />
              {editable && <Button onClick={() => setMasteryThresholdsDraft((prev) => [...prev, { label: "", min: 1, max: 1 }])} style={{ marginTop: 8 }}>Ajouter un seuil</Button>}
            </div>

            <div className="scales-section-footer">
              {editable && <Button variant="primary" disabled={savingMastery || masteryLevelsDraft.length === 0 || masteryLinesDraft.length === 0} onClick={() => void saveMastery()}>{savingMastery ? "Enregistrement…" : "Enregistrer la maîtrise globale"}</Button>}
            </div>
          </div>
        </section>

        <div className="core-alert core-alert--info" style={{ marginTop: 14 }}>
          <strong>Lien Dispositif (§10).</strong> Le contrat rattache la méthodologie de cotation au Dispositif/référentiel méthodologique du Processus. <code>RiskFramework</code>/<code>risk_frameworks</code> n'existe pas côté backend (gap déjà consigné, voir <code>ACTION_ITEMS.md</code>, entrée « GAPS FRONTEND RM V1 », point 1) : cette page ne montre donc aucun lien Dispositif et n'en invente aucun — une grille de cotation reste aujourd'hui une version autonome, sélectionnée par activation globale (ACT-176) plutôt que par Processus.
        </div>
      </div>
    </section>}

    <div className="core-alert core-alert--info">Cette page gère la méthodologie de cotation complète : création/activation de versions, axes d'impact (nombre libre), seuils de criticité, vélocité, persistance et maîtrise globale (agrégation MIN fixe). Une version active est immuable — toute évolution passe par une nouvelle version en brouillon (R-01).</div>
    <Modal open={!!disableTarget} onClose={() => { if (!disabling) { setDisableTarget(null); setDisableReason(""); } }} title="Désactiver la grille de cotation" actions={<><Button onClick={() => { setDisableTarget(null); setDisableReason(""); }} disabled={disabling}>Annuler</Button><Button variant="destructive" disabled={!disableTarget || !disableReason.trim() || disabling} onClick={() => void confirmDisable()}>{disabling ? "Désactivation…" : "Confirmer"}</Button></>}>
      <p>Désactivation (suppression douce) d'une version non active. Refusée par le backend si au moins une évaluation la référence encore — son historique doit rester interprétable (R-01). Un motif est obligatoire.</p>
      <div className="core-field"><label htmlFor="scale-disable-reason">Motif *</label><textarea id="scale-disable-reason" value={disableReason} onChange={(e) => setDisableReason(e.target.value)} rows={4} required autoFocus /></div>
    </Modal>
  </section>;
}
