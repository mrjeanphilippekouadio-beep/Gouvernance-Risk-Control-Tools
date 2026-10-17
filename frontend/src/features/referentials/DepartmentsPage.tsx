import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { departmentsApi, type Department, type DepartmentCreateInput } from "../../api/departments";
import { FormModal, dateOnly, describeError, isForbidden } from "../indicators/shared";
import { ArchiveModal } from "./ArchiveModal";
import "../core/CorePages.css";

interface Form { name: string; manager: string; entity: string; riskOwner: string; linkedProcesses: string; active: boolean }
const EMPTY_FORM: Form = { name: "", manager: "", entity: "", riskOwner: "", linkedProcesses: "", active: true };

const nullable = (value: string) => value.trim() || null;
/** Server marker of a Risk Owner that still tracks the manager (PostgresDepartmentRepository). */
const isDefaultOwner = (d: Department) => d.riskOwnerDesignatedBy?.startsWith("Pilote par défaut") ?? false;

export function DepartmentsPage({ token }: { token: string }) {
  const [rows, setRows] = useState<Department[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerValue, setOwnerValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true); setError(null);
    try {
      const data = await departmentsApi.listFull(token, includeInactive);
      if (id === latest.current) setRows(data);
    } catch (err) { if (id === latest.current) setError(describeError(err)); }
    finally { if (id === latest.current) setLoading(false); }
  }, [token, includeInactive]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  function openCreate() { setForm(EMPTY_FORM); setFormError(null); setFormOpen("create"); }
  function openEdit(row: Department) {
    setForm({ name: row.name, manager: row.manager, entity: row.entity ?? "", riskOwner: "", linkedProcesses: row.linkedProcesses ?? "", active: row.active });
    setFormError(null); setFormOpen("edit");
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFormError(null);
    const base = { name: form.name.trim(), manager: form.manager.trim(), entity: nullable(form.entity), linkedProcesses: nullable(form.linkedProcesses), active: form.active };
    try {
      if (formOpen === "edit" && selected) await departmentsApi.update(token, selected.id, base);
      else {
        const input: DepartmentCreateInput = { ...base, riskOwner: nullable(form.riskOwner) };
        const created = await departmentsApi.create(token, input);
        setSelectedId(created.id);
        if (!created.active) setIncludeInactive(true);
      }
      setFormOpen(null);
      await refresh();
    } catch (err) { setFormError(describeError(err)); if (isForbidden(err)) setFormOpen(null); }
    finally { setSaving(false); }
  }

  async function submitOwner(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setFormError(null);
    try {
      await departmentsApi.designateRiskOwner(token, selected.id, ownerValue.trim());
      setOwnerOpen(false);
      await refresh();
    } catch (err) { setFormError(describeError(err)); if (isForbidden(err)) setOwnerOpen(false); }
    finally { setSaving(false); }
  }

  const columns: TableColumn<Department>[] = [
    { key: "name", header: "Département", render: (row) => <><strong>{row.name}</strong>{!row.active && <div className="muted">Inactif</div>}</> },
    { key: "entity", header: "Entité", render: (row) => row.entity ?? "—" },
    { key: "manager", header: "Responsable", render: (row) => row.manager },
    { key: "riskOwner", header: "Risk Owner", render: (row) => row.riskOwner },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={row.active ? "Actif" : "Inactif"} tone={row.active ? "success" : "neutral"} /> },
    { key: "open", header: "", render: (row) => <Button onClick={() => setSelectedId(row.id)} aria-label={`Voir le détail de ${row.name}`}>Détail</Button> },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · RÉFÉRENTIELS</p>
        <h1>Départements</h1>
        <p className="core-page__subtitle">Chaque processus est rattaché à un département. Le changement de Risk Owner passe par une désignation tracée, distincte de la modification.</p>
      </div>
      <Button variant="primary" onClick={openCreate}>Nouveau département</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    <Card header={<><strong>Liste des départements</strong> <label className="core-filter"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Inclure les inactifs</label></>}>
      <Table columns={columns} rows={rows} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucun département défini pour l'instant." />
    </Card>

    {selected && <Card
      header={<><strong>{selected.name}</strong> <StatusBadge label={selected.active ? "Actif" : "Inactif"} tone={selected.active ? "success" : "neutral"} /></>}
      footer={<><Button onClick={() => openEdit(selected)}>Modifier</Button><Button onClick={() => { setOwnerValue(""); setFormError(null); setOwnerOpen(true); }}>Désigner le Risk Owner</Button><Button variant="destructive" onClick={() => setArchiveOpen(true)}>Archiver</Button></>}
    >
      <p className="muted">Entité : {selected.entity ?? "—"} · Responsable : {selected.manager}</p>
      <p className="muted">Risk Owner : {selected.riskOwner}{isDefaultOwner(selected) ? " · pilote par défaut (aucune désignation explicite)" : selected.riskOwnerDesignatedAt ? ` · désigné le ${dateOnly(selected.riskOwnerDesignatedAt)}` : ""}</p>
      <p className="muted">Processus liés (texte libre hérité) : {selected.linkedProcesses ?? "—"}</p>
      <MessageBanner tone="info">Les processus rattachés à ce département ne sont pas listés ici : l'API des départements n'expose pas ce lien (voir l'écran Processus).</MessageBanner>
    </Card>}

    <FormModal open={formOpen !== null} onClose={() => setFormOpen(null)} title={formOpen === "edit" ? "Modifier le département" : "Nouveau département"} formId="dept-form" saving={saving} submitLabel={formOpen === "edit" ? "Enregistrer" : "Créer"}>
      <form id="dept-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Nom *" htmlFor="dept-name"><input id="dept-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></FormField>
        <FormField label="Responsable *" htmlFor="dept-manager" help={formOpen === "edit" && selected && isDefaultOwner(selected) && form.manager.trim() !== selected.manager ? "Le Risk Owner est le pilote par défaut : le serveur le fera suivre ce nouveau responsable." : undefined}><input id="dept-manager" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} required /></FormField>
        <FormField label="Entité" htmlFor="dept-entity"><input id="dept-entity" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} /></FormField>
        {formOpen === "create" && <FormField label="Risk Owner" htmlFor="dept-owner" help="Laisser vide : le serveur applique sa règle par défaut. Un changement ultérieur passe par « Désigner le Risk Owner »."><input id="dept-owner" value={form.riskOwner} onChange={(e) => setForm({ ...form, riskOwner: e.target.value })} /></FormField>}
        <FormField label="Processus liés (texte libre)" htmlFor="dept-linked"><input id="dept-linked" value={form.linkedProcesses} onChange={(e) => setForm({ ...form, linkedProcesses: e.target.value })} /></FormField>
        <label className="core-filter"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Actif</label>
      </form>
    </FormModal>

    <FormModal open={ownerOpen} onClose={() => setOwnerOpen(false)} title="Désigner le Risk Owner" formId="dept-owner-form" saving={saving} submitLabel="Désigner">
      <form id="dept-owner-form" onSubmit={submitOwner}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Nouveau Risk Owner *" htmlFor="dept-newowner" help="La désignation est enregistrée avec votre identité côté serveur."><input id="dept-newowner" value={ownerValue} onChange={(e) => setOwnerValue(e.target.value)} required /></FormField>
      </form>
    </FormModal>

    <ArchiveModal
      open={archiveOpen && selected !== null}
      title="Archiver le département"
      subject={selected?.name ?? ""}
      onClose={() => setArchiveOpen(false)}
      onConfirm={async (reason) => {
        if (!selected) return;
        await departmentsApi.archive(token, selected.id, reason);
        setArchiveOpen(false); setSelectedId(null);
        await refresh();
      }}
    />
  </section>;
}
