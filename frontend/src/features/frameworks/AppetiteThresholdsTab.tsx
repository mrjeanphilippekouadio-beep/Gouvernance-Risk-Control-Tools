import { useEffect, useState, type FormEvent } from "react";
import { Button, FormField, MessageBanner, Table } from "@djamo/design-system";
import { riskFrameworksApi, type AppetiteEntry, type FrameworkVersion } from "../../api/riskFrameworks";
import type { RiskCategory } from "../../api/riskCategories";
import { describeError, isForbidden } from "../indicators/shared";

/** Editable mirror of an AppetiteEntry (numbers as text). `label` is the stored label, shown while no category is chosen. */
interface Row { key: number; subCategoryId: string; label: string; entity: string; threshold: string; description: string; }
/** Stable React key per edited row (array indexes shift when a row is removed). */
let rowSeq = 0;
const emptyRow = (): Row => ({ key: ++rowSeq, subCategoryId: "", label: "", entity: "", threshold: "", description: "" });
const toRows = (v: FrameworkVersion): Row[] => v.appetiteThresholds.map((a) => ({
  key: ++rowSeq, subCategoryId: a.subCategoryId ?? "", label: a.subCategory, entity: a.entity ?? "", threshold: String(a.threshold), description: a.description ?? "",
}));

/** Field by field: jsonb reorders keys, so comparing serialized strings would always report a change (Gitar, PR #186). */
function sameEntry(a: AppetiteEntry, b: AppetiteEntry) {
  return a.subCategory === b.subCategory && (a.subCategoryId ?? null) === (b.subCategoryId ?? null) && (a.entity ?? null) === (b.entity ?? null)
    && a.threshold === b.threshold && (a.description ?? null) === (b.description ?? null);
}

interface Props {
  token: string;
  frameworkId: string;
  version: FrameworkVersion;
  categories: RiskCategory[];
  categoriesError: string | null;
  onSaved: () => Promise<void>;
}

/** Appetite thresholds of one version. Editable only when the server says the version is a DRAFT; the server validates every value. */
export function AppetiteThresholdsTab({ token, frameworkId, version, categories, categoriesError, onSaved }: Props) {
  const editable = version.status === "DRAFT";
  const [rows, setRows] = useState<Row[]>(() => toRows(version));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Reset the form whenever another version (or a refreshed copy of it) is shown.
  useEffect(() => { setRows(toRows(version)); setError(null); setSaved(false); }, [version]);

  // Sub-categories only (children); the parent name gives context.
  const byId = new Map(categories.map((c) => [c.id, c]));
  const options = categories.filter((c) => c.parentId && c.active);
  const optionLabel = (c: RiskCategory) => `${byId.get(c.parentId ?? "")?.name ?? "—"} › ${c.name}`;
  const nameOf = (id: string) => { const c = byId.get(id); return c ? c.name : null; };

  function submit(event: FormEvent) {
    event.preventDefault();
    const missing = rows.findIndex((r) => r.subCategoryId === "");
    if (missing >= 0) { setError(`Le seuil ${missing + 1} n'a pas de sous-catégorie : choisissez-en une dans la liste des catégories de risque.`); return; }
    const next: AppetiteEntry[] = rows.map((r) => ({
      // The label follows the chosen category; the server derives it from subCategoryId.
      subCategory: (nameOf(r.subCategoryId) ?? r.label).trim(), subCategoryId: r.subCategoryId,
      entity: r.entity.trim() === "" ? null : r.entity.trim(), threshold: Number(r.threshold),
      description: r.description.trim() === "" ? null : r.description.trim(),
    }));
    const stored = version.appetiteThresholds;
    if (next.length === stored.length && next.every((a, i) => sameEntry(a, stored[i]))) { setError("Aucune modification à enregistrer."); return; }
    setSaving(true); setError(null); setSaved(false);
    riskFrameworksApi.updateDraft(token, frameworkId, version.id, { appetiteThresholds: next })
      .then(async () => { setSaved(true); await onSaved(); })
      .catch((err) => { if (!isForbidden(err)) setError(describeError(err)); })
      .finally(() => setSaving(false));
  }

  if (!editable) {
    return <>
      <MessageBanner tone="info">Cette version n'est pas un brouillon : ses seuils sont en lecture seule.</MessageBanner>
      <Table
        columns={[
          { key: "sub", header: "Sous-catégorie", render: (a: AppetiteEntry) => a.subCategory },
          { key: "entity", header: "Entité", render: (a: AppetiteEntry) => a.entity ?? "—" },
          { key: "thr", header: "Seuil", render: (a: AppetiteEntry) => a.threshold },
          { key: "desc", header: "Description", render: (a: AppetiteEntry) => a.description ?? "—" },
        ]}
        rows={version.appetiteThresholds}
        rowKey={(a) => `${a.subCategoryId ?? a.subCategory}|${a.entity ?? ""}`}
        loading={false}
        emptyMessage="Aucun seuil d'appétence dans cette version."
      />
    </>;
  }

  return <form onSubmit={submit} aria-label="Seuils d'appétence du brouillon">
    {error && <div role="alert"><MessageBanner tone="danger">{error}</MessageBanner></div>}
    {saved && <div role="status"><MessageBanner tone="success">Seuils enregistrés.</MessageBanner></div>}
    {categoriesError && <MessageBanner tone="warning" title="Catégories de risque indisponibles">{categoriesError} Sans cette liste, aucune sous-catégorie ne peut être choisie.</MessageBanner>}
    <p>La sous-catégorie se choisit dans les catégories de risque du référentiel. Le serveur valide chaque seuil (bornes, doublons) ; la liste enregistrée remplace celle du brouillon.</p>
    {rows.length === 0 && <p>Aucun seuil dans ce brouillon.</p>}
    {rows.map((row, i) => {
      const setRow = (patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      const known = row.subCategoryId === "" || options.some((c) => c.id === row.subCategoryId);
      return <fieldset key={row.key}>
        <legend>Seuil {i + 1}</legend>
        <FormField label="Sous-catégorie *" htmlFor={`ap-sub-${row.key}`}
          help={row.subCategoryId === "" && row.label ? `Libellé actuel : « ${row.label} » (non relié au référentiel). Choisissez la sous-catégorie correspondante.` : undefined}>
          <select id={`ap-sub-${row.key}`} value={row.subCategoryId} onChange={(e) => setRow({ subCategoryId: e.target.value })} required>
            <option value="">Sélectionner…</option>
            {!known && <option value={row.subCategoryId}>{nameOf(row.subCategoryId) ?? row.label} (inactive ou hors niveau)</option>}
            {options.map((c) => <option key={c.id} value={c.id}>{optionLabel(c)}</option>)}
          </select>
        </FormField>
        <FormField label="Entité" htmlFor={`ap-ent-${row.key}`} help="Vide : toutes les entités."><input id={`ap-ent-${row.key}`} value={row.entity} onChange={(e) => setRow({ entity: e.target.value })} maxLength={200} /></FormField>
        <FormField label="Seuil (1 à 36) *" htmlFor={`ap-thr-${row.key}`}><input id={`ap-thr-${row.key}`} type="number" min={1} max={36} step={1} value={row.threshold} onChange={(e) => setRow({ threshold: e.target.value })} required /></FormField>
        <FormField label="Description" htmlFor={`ap-desc-${row.key}`}><textarea id={`ap-desc-${row.key}`} value={row.description} onChange={(e) => setRow({ description: e.target.value })} maxLength={1000} /></FormField>
        <Button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Retirer le seuil ${i + 1}`}>Retirer</Button>
      </fieldset>;
    })}
    <div className="core-form-actions">
      <Button type="button" onClick={() => setRows([...rows, emptyRow()])}>Ajouter un seuil</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer les seuils"}</Button>
    </div>
  </form>;
}
