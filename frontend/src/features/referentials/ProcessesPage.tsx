import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import {
  processesApi,
  type Process,
  type ProcessDocumentType,
  type ProcessInput,
  type ProcessLevel,
} from "../../api/processes";
import { departmentsApi, type DepartmentSummary } from "../../api/departments";
import { FormModal, dateOnly, describeError, isForbidden } from "../indicators/shared";
import { ArchiveModal } from "./ArchiveModal";
import { ProcessResponsibilitiesCard } from "./ProcessResponsibilitiesCard";
import { usersApi, type DirectoryEntry } from "../../api/users";
import { usePermissions } from "../../auth/usePermissions";
import "../core/CorePages.css";

const LEVEL_LABELS: Record<ProcessLevel, string> = { PROCESS: "Processus", SUBPROCESS: "Sous-processus", ACTIVITY: "Activité" };
const DOCUMENT_LABELS: Record<ProcessDocumentType, string> = {
  CHARTER: "Charte",
  POLICY: "Politique",
  PROCEDURES_MANUAL: "Manuel de procédures",
  PROCEDURE: "Procédure",
  WORK_INSTRUCTION: "Instruction de travail",
};
const MODE_LABELS = { CLASSIQUE: "Classique", PARTICIPATIF: "Participatif" } as const;

interface Form {
  name: string; level: ProcessLevel; parentId: string; departmentId: string; description: string;
  documentType: string; documentReference: string; owner: string; active: boolean;
}
const EMPTY_FORM: Form = {
  name: "", level: "PROCESS", parentId: "", departmentId: "", description: "",
  documentType: "", documentReference: "", owner: "", active: true,
};

const nullable = (value: string) => value.trim() || null;

/** Display order only: each process right after its parent (parent unknown or hidden -> treated as root). */
function inTreeOrder(rows: Process[]): { row: Process; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string | null, Process[]>();
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    children.set(key, [...(children.get(key) ?? []), row]);
  }
  const out: { row: Process; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const row of children.get(parent) ?? []) {
      if (seen.has(row.id)) continue; // guards against a cyclic payload
      seen.add(row.id);
      out.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function ProcessesPage({ token }: { token: string }) {
  const [rows, setRows] = useState<Process[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [departmentsUnavailable, setDepartmentsUnavailable] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<DirectoryEntry[]>([]);
  const { can } = usePermissions(token);
  const canAssign = can("process.responsibility.assign");
  const [formOpen, setFormOpen] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true); setError(null);
    try {
      const data = await processesApi.list(token, includeInactive);
      if (id === latest.current) setRows(data);
    } catch (err) { if (id === latest.current) setError(describeError(err)); }
    finally { if (id === latest.current) setLoading(false); }
  }, [token, includeInactive]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Account picker: only for an assigner; without it the names stay "Compte non listé", never guessed.
  useEffect(() => {
    if (!canAssign) return;
    usersApi.directory(token).then(setAccounts).catch(() => setAccounts([]));
  }, [token, canAssign]);
  useEffect(() => {
    departmentsApi.list(token, true).then((d) => { setDepartments(d); setDepartmentsUnavailable(false); })
      .catch(() => { setDepartments([]); setDepartmentsUnavailable(true); });
  }, [token]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const ordered = useMemo(() => inTreeOrder(rows), [rows]);
  const departmentLabel = (id: string | null) => {
    if (id === null) return "—";
    const found = departments.find((d) => d.id === id);
    if (found) return found.active ? found.name : `${found.name} (inactif)`;
    return departmentsUnavailable ? id : `${id} (archivé ou introuvable)`;
  };
  const parentLabel = (id: string | null) => id === null ? "—" : (rows.find((r) => r.id === id)?.name ?? id);

  function openCreate() { setForm(EMPTY_FORM); setFormError(null); setFormOpen("create"); }
  function openEdit(row: Process) {
    setForm({
      name: row.name, level: row.level, parentId: row.parentId ?? "", departmentId: row.departmentId ?? "",
      description: row.description ?? "", documentType: row.documentType ?? "", documentReference: row.documentReference ?? "",
      owner: row.owner ?? "", active: row.active,
    });
    setFormError(null); setFormOpen("edit");
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFormError(null);
    const input: ProcessInput = {
      name: form.name.trim(), level: form.level, parentId: nullable(form.parentId),
      description: nullable(form.description), documentType: (form.documentType || null) as ProcessDocumentType | null,
      documentReference: nullable(form.documentReference), owner: nullable(form.owner), active: form.active,
    };
    try {
      if (formOpen === "edit" && selected) {
        // The server refuses to detach a department once set: only send one when chosen.
        await processesApi.update(token, selected.id, form.departmentId ? { ...input, departmentId: form.departmentId } : input);
      } else {
        const created = await processesApi.create(token, { ...input, departmentId: form.departmentId });
        setSelectedId(created.id);
        if (!created.active) setIncludeInactive(true); // keep the new inactive process visible and selected
      }
      setFormOpen(null);
      await refresh();
    } catch (err) { setFormError(describeError(err)); if (isForbidden(err)) setFormOpen(null); }
    finally { setSaving(false); }
  }

  const columns: TableColumn<{ row: Process; depth: number }>[] = [
    { key: "name", header: "Nom", render: ({ row, depth }) => <div style={{ paddingLeft: depth * 20 }}><strong>{row.name}</strong>{!row.active && <div className="muted">Inactif</div>}</div> },
    { key: "level", header: "Niveau", render: ({ row }) => LEVEL_LABELS[row.level] },
    { key: "department", header: "Département", render: ({ row }) => departmentLabel(row.departmentId) },
    { key: "owner", header: "Responsable", render: ({ row }) => row.owner ?? "—" },
    { key: "status", header: "Statut", render: ({ row }) => <StatusBadge label={row.active ? "Actif" : "Inactif"} tone={row.active ? "success" : "neutral"} /> },
    { key: "open", header: "", render: ({ row }) => <Button onClick={() => setSelectedId(row.id)} aria-label={`Voir le détail de ${row.name}`}>Détail</Button> },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · RÉFÉRENTIELS</p>
        <h1>Processus</h1>
        <p className="core-page__subtitle">Hiérarchie Processus, Sous-processus, Activité. Les règles de rattachement (niveau du parent, département, références actives avant archivage) sont appliquées par le serveur.</p>
      </div>
      <Button variant="primary" onClick={openCreate}>Nouveau processus</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {departmentsUnavailable && <MessageBanner tone="info" title="Annuaire des départements indisponible">
      Le droit de lecture des départements est manquant ou l'API est injoignable : les identifiants sont affichés à la place des noms et la création d'un processus (département obligatoire) n'est pas possible depuis cet écran.
    </MessageBanner>}
    <Card header={<><strong>Liste des processus</strong> <label className="core-filter"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Inclure les inactifs</label></>}>
      <Table columns={columns} rows={ordered} rowKey={(item) => item.row.id} loading={loading} emptyMessage="Aucun processus défini pour l'instant." />
    </Card>

    {selected && <Card
      header={<><strong>{selected.name}</strong> <StatusBadge label={selected.active ? "Actif" : "Inactif"} tone={selected.active ? "success" : "neutral"} /></>}
      footer={<><Button onClick={() => openEdit(selected)}>Modifier</Button><Button variant="destructive" onClick={() => setArchiveOpen(true)}>Archiver</Button></>}
    >
      {selected.description && <p className="muted">{selected.description}</p>}
      <p className="muted">Niveau : {LEVEL_LABELS[selected.level]} · Parent : {parentLabel(selected.parentId)} · Département : {departmentLabel(selected.departmentId)}</p>
      <p className="muted">Responsable : {selected.owner ?? "—"} · Document : {selected.documentType ? DOCUMENT_LABELS[selected.documentType] : "—"}{selected.documentReference ? ` (${selected.documentReference})` : ""}</p>
      <p className="muted">Mode d'évaluation enregistré : {selected.evaluationMode ? MODE_LABELS[selected.evaluationMode] : "hérité (non défini sur ce processus)"} · Mis à jour le {dateOnly(selected.updatedAt)}</p>
      <MessageBanner tone="info">Le mode d'évaluation se modifie par une route et un droit dédiés (Risk Manager) : il n'est pas modifiable ici. La valeur héritée effective n'est pas exposée par l'API.</MessageBanner>
    </Card>}

    {selected && <ProcessResponsibilitiesCard token={token} processId={selected.id} accounts={accounts} canAssign={canAssign} />}

    <FormModal open={formOpen !== null} onClose={() => setFormOpen(null)} title={formOpen === "edit" ? "Modifier le processus" : "Nouveau processus"} formId="process-form" saving={saving} submitLabel={formOpen === "edit" ? "Enregistrer" : "Créer"}>
      <form id="process-form" onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Nom *" htmlFor="proc-name"><input id="proc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></FormField>
        <FormField label="Niveau *" htmlFor="proc-level">
          <select id="proc-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as ProcessLevel })}>
            {Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FormField>
        <FormField label="Parent" htmlFor="proc-parent" help="Un Processus n'a pas de parent ; le serveur valide le niveau du parent.">
          <select id="proc-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
            <option value="">Aucun</option>
            {form.parentId && !rows.some((r) => r.id === form.parentId) && <option value={form.parentId}>Parent actuel (non listé : inactif ou archivé)</option>}
            {rows.filter((r) => r.id !== selected?.id || formOpen !== "edit").map((r) => <option key={r.id} value={r.id}>{r.name} ({LEVEL_LABELS[r.level]}){r.active ? "" : " — inactif"}</option>)}
          </select>
        </FormField>
        <FormField label={formOpen === "create" ? "Département *" : "Département"} htmlFor="proc-dept" help={formOpen === "edit" ? "Un département peut être changé, jamais retiré." : undefined}>
          <select id="proc-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} required={formOpen === "create"}>
            <option value="">Sélectionner…</option>
            {form.departmentId && !departments.some((d) => d.id === form.departmentId) && <option value={form.departmentId}>Département actuel (non listé : archivé ou illisible)</option>}
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? "" : " — inactif"}</option>)}
          </select>
        </FormField>
        <FormField label="Responsable" htmlFor="proc-owner"><input id="proc-owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></FormField>
        <FormField label="Type de document" htmlFor="proc-doctype">
          <select id="proc-doctype" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
            <option value="">Aucun</option>
            {Object.entries(DOCUMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FormField>
        <FormField label="Référence du document" htmlFor="proc-docref"><input id="proc-docref" value={form.documentReference} onChange={(e) => setForm({ ...form, documentReference: e.target.value })} /></FormField>
        <FormField label="Description" htmlFor="proc-desc"><textarea id="proc-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
        <label className="core-filter"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Actif</label>
      </form>
    </FormModal>

    <ArchiveModal
      open={archiveOpen && selected !== null}
      title="Archiver le processus"
      subject={selected?.name ?? ""}
      onClose={() => setArchiveOpen(false)}
      onConfirm={async (reason) => {
        if (!selected) return;
        await processesApi.archive(token, selected.id, reason);
        setArchiveOpen(false); setSelectedId(null);
        await refresh();
      }}
    />
  </section>;
}
