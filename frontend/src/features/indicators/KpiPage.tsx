import { useCallback, useEffect, useMemo, useState, type FormEvent, useRef } from "react";
import { HiddenCountNotice } from "../risks/HiddenCountNotice";
import { ResourceVisibilityCard, RiskVisibilityBadge } from "../risks/RiskVisibility";
import { kpiVisibilityApi, PERIMETER_HELP } from "../../api/visibility";
import { Button, Card, FormField, LineChart, MessageBanner, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import {
  kpisApi,
  processesApi,
  type IndicatorFrequency,
  type Kpi,
  type KpiInput,
  type KpiMeasure,
  type KpiStatus,
  type ProcessSummary,
} from "../../api/indicators";
import { departmentsApi, type DepartmentSummary } from "../../api/departments";
import {
  FormModal,
  FREQUENCY_LABELS,
  dateOnly,
  describeError,
  fmt,
  isForbidden,
} from "./shared";
import "../core/CorePages.css";

// Presentation of the status string returned by the backend — no recomputation.
const STATUS: Record<KpiStatus, { label: string; tone: StatusTone }> = {
  ACHIEVED: { label: "Atteint", tone: "success" },
  AT_RISK: { label: "À risque", tone: "warning" },
  NOT_ACHIEVED: { label: "Non atteint", tone: "danger" },
  NO_MEASURE: { label: "Aucune mesure", tone: "neutral" },
};

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

interface Form {
  label: string; targetValue: string; unit: string; frequency: IndicatorFrequency; owner: string; departmentId: string; processId: string;
}
const EMPTY_FORM: Form = { label: "", targetValue: "", unit: "", frequency: "MONTHLY", owner: "", departmentId: "", processId: "" };

interface MeasureForm { period: string; value: string; comment: string }
const EMPTY_MEASURE: MeasureForm = { period: "", value: "", comment: "" };

export function KpiPage({ token }: { token: string }) {
  const [rows, setRows] = useState<Kpi[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measures, setMeasures] = useState<KpiMeasure[]>([]);
  const [measuresLoading, setMeasuresLoading] = useState(false);
  const [measuresError, setMeasuresError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [measureForm, setMeasureForm] = useState<MeasureForm>(EMPTY_MEASURE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fail = useCallback((err: unknown, setter: (message: string | null) => void) => {
    setter(describeError(err));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await kpisApi.list(token)); }
    catch (err) { fail(err, setError); }
    finally { setLoading(false); }
  }, [token, fail]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Directories are conveniences: a 403/failure falls back to the raw id.
  useEffect(() => {
    departmentsApi.list(token).then(setDepartments).catch(() => setDepartments([]));
    processesApi.list(token).then(setProcesses).catch(() => setProcesses([]));
  }, [token]);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const scope = (row: Kpi) => [
    row.departmentId && `Département : ${departments.find((d) => d.id === row.departmentId)?.name ?? row.departmentId}`,
    row.processId && `Processus : ${processes.find((p) => p.id === row.processId)?.name ?? row.processId}`,
  ].filter(Boolean).join(" · ") || "—";

  const measuresFor = useRef<string | null>(null);
  const loadMeasures = useCallback(async (kpiId: string) => {
    measuresFor.current = kpiId; // ignore a late answer for a previously selected indicator
    setMeasuresLoading(true); setMeasuresError(null);
    try { const rows = await kpisApi.measures(token, kpiId); if (measuresFor.current === kpiId) setMeasures(rows); }
    catch (err) { if (measuresFor.current === kpiId) { setMeasures([]); fail(err, setMeasuresError); } }
    finally { if (measuresFor.current === kpiId) setMeasuresLoading(false); }
  }, [token, fail]);

  useEffect(() => { if (selectedId) void loadMeasures(selectedId); else setMeasures([]); }, [selectedId, loadMeasures]);

  function openCreate() { setForm(EMPTY_FORM); setFormError(null); setFormOpen("create"); }
  function openEdit(row: Kpi) {
    setForm({ label: row.label, targetValue: String(row.targetValue), unit: row.unit, frequency: row.frequency, owner: row.owner, departmentId: row.departmentId ?? "", processId: row.processId ?? "" });
    setFormError(null); setFormOpen("edit");
  }

  async function submitKpi(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFormError(null);
    const input: KpiInput = {
      label: form.label.trim(), targetValue: Number(form.targetValue), unit: form.unit.trim(), frequency: form.frequency, owner: form.owner.trim(),
      departmentId: form.departmentId || null, processId: form.processId || null,
    };
    try {
      if (formOpen === "edit" && selected) await kpisApi.update(token, selected.id, input);
      else setSelectedId((await kpisApi.create(token, input)).id);
      setFormOpen(null);
      await refresh();
    } catch (err) { fail(err, setFormError); if (isForbidden(err)) setFormOpen(null); }
    finally { setSaving(false); }
  }

  async function submitMeasure(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setFormError(null);
    try {
      await kpisApi.record(token, { kpiId: selected.id, period: measureForm.period, value: Number(measureForm.value), comment: measureForm.comment.trim() || null });
      setMeasureOpen(false);
      await Promise.all([refresh(), loadMeasures(selected.id)]);
    } catch (err) { fail(err, setFormError); if (isForbidden(err)) setMeasureOpen(false); }
    finally { setSaving(false); }
  }

  const columns: TableColumn<Kpi>[] = [
    { key: "label", header: "Indicateur", render: (row) => <><strong>{row.label}</strong>{!row.active && <div className="muted">Inactif</div>}<div className="muted">{scope(row)}</div></> },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={STATUS[row.status].label} tone={STATUS[row.status].tone} /> },
    { key: "target", header: "Cible", render: (row) => `${fmt(row.targetValue)} ${row.unit}` },
    { key: "latest", header: "Dernière mesure", render: (row) => row.latestMeasureValue === null ? "—" : <><strong>{fmt(row.latestMeasureValue)} {row.unit}</strong><div className="muted">{dateOnly(row.latestMeasurePeriod)}</div></> },
    { key: "rate", header: "Atteinte", render: (row) => row.achievementRate === null ? "—" : percent.format(row.achievementRate) },
    { key: "owner", header: "Responsable", render: (row) => row.owner },
    { key: "visibility", header: "Visibilité", render: (row) => <RiskVisibilityBadge visibility={row.visibility} /> },
    { key: "open", header: "", render: (row) => <Button onClick={() => setSelectedId(row.id)} aria-label={`Voir le détail de ${row.label}`}>Détail</Button> },
  ];

  const measureColumns: TableColumn<KpiMeasure>[] = [
    { key: "period", header: "Période", render: (m) => dateOnly(m.period) },
    { key: "value", header: "Valeur", render: (m) => <strong>{fmt(m.value)} {selected?.unit}</strong> },
    { key: "comment", header: "Commentaire", render: (m) => m.comment ?? "—" },
  ];

  const chronological = [...measures].reverse();

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">INDICATEURS · PERFORMANCE</p>
        <h1>Indicateurs de performance (KPI)</h1>
        <p className="core-page__subtitle">Cible, dernière mesure et statut tels que calculés par le serveur. Un KPI est rattaché à un département ou à un processus.</p>
      </div>
      <Button variant="primary" onClick={openCreate}>Nouveau KPI</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    <Card header={<strong>Liste des KPI</strong>}>
      <Table columns={columns} rows={rows} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucun KPI défini pour l'instant." />
      <HiddenCountNotice token={token} type="KPI" />
    </Card>

    {selected && <Card
      header={<><strong>{selected.label}</strong> <StatusBadge label={STATUS[selected.status].label} tone={STATUS[selected.status].tone} /></>}
      footer={<><Button onClick={() => openEdit(selected)}>Modifier</Button><Button variant="primary" onClick={() => { setMeasureForm(EMPTY_MEASURE); setFormError(null); setMeasureOpen(true); }}>Saisir une mesure</Button></>}
    >
      <p className="muted">Fréquence : {FREQUENCY_LABELS[selected.frequency]} · Responsable : {selected.owner} · {scope(selected)}</p>
      {measuresError && <MessageBanner tone="danger" title="Historique indisponible">{measuresError}</MessageBanner>}
      {chronological.length > 1 && <LineChart
        labels={chronological.map((m) => dateOnly(m.period))}
        series={[
          { label: `Mesure (${selected.unit})`, data: chronological.map((m) => m.value) },
          { label: "Cible", data: chronological.map(() => selected.targetValue) },
        ]}
        height={220}
      />}
      <Table columns={measureColumns} rows={measures} rowKey={(m) => m.id} loading={measuresLoading} emptyMessage="Aucune mesure enregistrée pour ce KPI." />
    </Card>}
    {selected && <ResourceVisibilityCard token={token} resourceId={selected.id} idPrefix="kpi-visibility" perimeterHelp={PERIMETER_HELP.KPI}
      load={kpiVisibilityApi.get} save={kpiVisibilityApi.set} />}

    <FormModal open={formOpen !== null} onClose={() => setFormOpen(null)} title={formOpen === "edit" ? "Modifier le KPI" : "Nouveau KPI"} formId="kpi-form" saving={saving} submitLabel={formOpen === "edit" ? "Enregistrer" : "Créer"}>
      <form id="kpi-form" onSubmit={submitKpi}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Intitulé *" htmlFor="kpi-label"><input id="kpi-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required /></FormField>
        <FormField label="Valeur cible *" htmlFor="kpi-target"><input id="kpi-target" type="number" step="any" value={form.targetValue} onChange={(e) => setForm({ ...form, targetValue: e.target.value })} required /></FormField>
        <FormField label="Unité *" htmlFor="kpi-unit"><input id="kpi-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required /></FormField>
        <FormField label="Fréquence *" htmlFor="kpi-frequency">
          <select id="kpi-frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as IndicatorFrequency })}>
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FormField>
        <FormField label="Responsable *" htmlFor="kpi-owner"><input id="kpi-owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required /></FormField>
        <FormField label="Département" htmlFor="kpi-dept" help="Département ou processus requis (au moins l'un des deux).">
          <select id="kpi-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">Aucun</option>
            {departments.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>
        <FormField label="Processus" htmlFor="kpi-process">
          <select id="kpi-process" value={form.processId} onChange={(e) => setForm({ ...form, processId: e.target.value })}>
            <option value="">Aucun</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormField>
      </form>
    </FormModal>

    <FormModal open={measureOpen} onClose={() => setMeasureOpen(false)} title="Saisir une mesure" formId="kpi-measure-form" saving={saving} submitLabel="Enregistrer la mesure">
      <form id="kpi-measure-form" onSubmit={submitMeasure}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Période *" htmlFor="kpim-period"><input id="kpim-period" type="date" value={measureForm.period} onChange={(e) => setMeasureForm({ ...measureForm, period: e.target.value })} required /></FormField>
        <FormField label={`Valeur *${selected ? ` (${selected.unit})` : ""}`} htmlFor="kpim-value"><input id="kpim-value" type="number" step="any" value={measureForm.value} onChange={(e) => setMeasureForm({ ...measureForm, value: e.target.value })} required /></FormField>
        <FormField label="Commentaire" htmlFor="kpim-comment"><textarea id="kpim-comment" value={measureForm.comment} onChange={(e) => setMeasureForm({ ...measureForm, comment: e.target.value })} /></FormField>
      </form>
    </FormModal>

  </section>;
}
