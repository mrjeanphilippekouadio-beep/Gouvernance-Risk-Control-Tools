import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { riskCategoriesApi, type RiskCategory } from "../../api/riskCategories";
import { FormModal, describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

interface Form { name: string; parentId: string; active: boolean }
const EMPTY_FORM: Form = { name: "", parentId: "", active: true };

/** Display order only: each sub-category right after its category. */
function grouped(rows: RiskCategory[]): { row: RiskCategory; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows.filter((r) => !r.parentId || !ids.has(r.parentId));
  return roots.flatMap((root) => [
    { row: root, depth: 0 },
    ...rows.filter((r) => r.parentId === root.id).map((row) => ({ row, depth: 1 })),
  ]);
}

export function RiskCategoriesPage({ token }: { token: string }) {
  const [rows, setRows] = useState<RiskCategory[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RiskCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true); setError(null);
    try {
      const data = await riskCategoriesApi.list(token, includeInactive);
      if (id === latest.current) setRows(data);
    } catch (err) { if (id === latest.current) setError(describeError(err)); }
    finally { if (id === latest.current) setLoading(false); }
  }, [token, includeInactive]);

  useEffect(() => { void refresh(); }, [refresh]);

  const ordered = useMemo(() => grouped(rows), [rows]);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setFormError(null); setFormOpen(true); }
  function openEdit(row: RiskCategory) {
    setEditing(row); setForm({ name: row.name, parentId: row.parentId ?? "", active: row.active }); setFormError(null); setFormOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFormError(null);
    const body = { name: form.name.trim(), parentId: form.parentId || null, active: form.active };
    try {
      if (editing) await riskCategoriesApi.update(token, editing.id, body);
      else {
        await riskCategoriesApi.create(token, body);
        if (!body.active) setIncludeInactive(true); // keep the new inactive category visible
      }
      setFormOpen(false);
      await refresh();
    } catch (err) { setFormError(describeError(err)); if (isForbidden(err)) setFormOpen(false); }
    finally { setSaving(false); }
  }

  const columns: TableColumn<{ row: RiskCategory; depth: number }>[] = [
    { key: "name", header: "Catégorie", render: ({ row, depth }) => <div style={{ paddingLeft: depth * 20 }}><strong>{row.name}</strong>{depth > 0 && <div className="muted">Sous-catégorie</div>}</div> },
    { key: "status", header: "Statut", render: ({ row }) => <StatusBadge label={row.active ? "Active" : "Inactive"} tone={row.active ? "success" : "neutral"} /> },
    { key: "edit", header: "", render: ({ row }) => <Button onClick={() => openEdit(row)} aria-label={`Modifier ${row.name}`}>Modifier</Button> },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · RÉFÉRENTIELS</p>
        <h1>Catégories de risque</h1>
        <p className="core-page__subtitle">Taxonomie des catégories et sous-catégories (un seul niveau de sous-catégorie, contrôlé par le serveur).</p>
      </div>
      <Button variant="primary" onClick={openCreate}>Nouvelle catégorie</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    <MessageBanner tone="info" title="Périmètre de l'API">
      Il n'existe pas de route d'archivage : une catégorie se désactive via « Actif » dans la modification. Les risques, évaluations et seuils d'appétence ne référencent pas encore ce référentiel (texte libre), et l'API n'indique pas l'usage d'une catégorie.
    </MessageBanner>
    <Card header={<><strong>Catégories</strong> <label className="core-filter"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Inclure les inactives</label></>}>
      <Table columns={columns} rows={ordered} rowKey={(item) => item.row.id} loading={loading} emptyMessage="Aucune catégorie définie pour l'instant." />
    </Card>

    <FormModal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Modifier la catégorie" : "Nouvelle catégorie"} formId="category-form" saving={saving} submitLabel={editing ? "Enregistrer" : "Créer"}>
      <form id="category-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Nom *" htmlFor="cat-name"><input id="cat-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></FormField>
        <FormField label="Catégorie parente" htmlFor="cat-parent" help="Vide : catégorie de premier niveau.">
          <select id="cat-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
            <option value="">Aucune</option>
            {form.parentId && !rows.some((r) => r.id === form.parentId && !r.parentId) && <option value={form.parentId}>Parent actuel (non listé : inactif ou hors niveau)</option>}
            {rows.filter((r) => !r.parentId && r.id !== editing?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FormField>
        <label className="core-filter"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
      </form>
    </FormModal>
  </section>;
}
