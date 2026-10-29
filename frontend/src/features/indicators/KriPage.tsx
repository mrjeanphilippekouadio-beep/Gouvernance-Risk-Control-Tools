import { useCallback, useEffect, useMemo, useState, type FormEvent, useRef } from "react";
import { Button, Card, FormField, LineChart, MessageBanner, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import {
  krisApi,
  type IndicatorFrequency,
  type KriDashboardFilters,
  type KriDashboardRow,
  type KriDetail,
  type KriInput,
  type KriMeasure,
  type KriStatus,
} from "../../api/indicators";
import { risksApi, type Risk } from "../../api/risks";
import { departmentsApi, type DepartmentSummary } from "../../api/departments";
import { usePermissions } from "../../auth/usePermissions";
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
const STATUS: Record<KriStatus, { label: string; tone: StatusTone }> = {
  VERT: { label: "Vert", tone: "success" },
  ORANGE: { label: "Orange", tone: "warning" },
  ROUGE: { label: "Rouge", tone: "danger" },
  NO_MEASURE: { label: "Aucune mesure", tone: "neutral" },
};

interface Form {
  label: string; formula: string; thresholdGreen: string; thresholdOrange: string; thresholdRed: string;
  frequency: IndicatorFrequency; riskId: string; entity: string; methodologyVersion: string; description: string;
}
const EMPTY_FORM: Form = {
  label: "", formula: "", thresholdGreen: "", thresholdOrange: "", thresholdRed: "",
  frequency: "MONTHLY", riskId: "", entity: "", methodologyVersion: "", description: "",
};

interface MeasureForm { measureDate: string; value: string; source: string; comment: string }
const EMPTY_MEASURE: MeasureForm = { measureDate: "", value: "", source: "", comment: "" };

const nullable = (value: string) => value.trim() || null;

export function KriPage({ token }: { token: string }) {
  const { can } = usePermissions(token);
  const [rows, setRows] = useState<KriDashboardRow[]>([]);
  const [filters, setFilters] = useState<KriDashboardFilters>({});
  const [riskFilter, setRiskFilter] = useState("");
  const [departments, setDepartments] = useState<DepartmentSummary[] | null>(null);
  const [detail, setDetail] = useState<KriDetail | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [covered, setCovered] = useState<string[]>([]);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableReason, setDisableReason] = useState("");
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measures, setMeasures] = useState<KriMeasure[]>([]);
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

  // Codex PR #203: a late answer for superseded filters never overwrites the current table.
  const dashboardSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++dashboardSeq.current;
    setLoading(true); setError(null);
    try { const next = await krisApi.dashboard(token, filters); if (seq === dashboardSeq.current) setRows(next); }
    catch (err) { if (seq === dashboardSeq.current) fail(err, setError); }
    finally { if (seq === dashboardSeq.current) setLoading(false); }
  }, [token, fail, filters]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Risk labels are a convenience: a 403/failure just falls back to the raw id.
  useEffect(() => { risksApi.list(token).then(setRisks).catch(() => setRisks([])); }, [token]);
  // Department filter only when the directory is readable (department.read); otherwise it is hidden.
  useEffect(() => { departmentsApi.list(token).then(setDepartments).catch(() => setDepartments(null)); }, [token]);

  // Display filter on the primary risk; status/department/entity/period are filtered by the server.
  const visibleRows = riskFilter ? rows.filter((row) => row.riskId === riskFilter) : rows;

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  // QA-F7S6-03: never a raw id on screen (risk archived, or no risk.read for this account).
  const riskLabel = (riskId: string) => risks.find((risk) => risk.id === riskId)?.description ?? "Risque non consultable";

  const measuresFor = useRef<string | null>(null);
  const loadMeasures = useCallback(async (kriId: string) => {
    measuresFor.current = kriId; // ignore a late answer for a previously selected indicator
    setMeasuresLoading(true); setMeasuresError(null);
    try { const rows = await krisApi.measures(token, kriId); if (measuresFor.current === kriId) setMeasures(rows); }
    catch (err) { if (measuresFor.current === kriId) { setMeasures([]); fail(err, setMeasuresError); } }
    finally { if (measuresFor.current === kriId) setMeasuresLoading(false); }
  }, [token, fail]);

  useEffect(() => { if (selectedId) void loadMeasures(selectedId); else setMeasures([]); }, [selectedId, loadMeasures]);

  // Codex PR #203: late answers are ignored and every use of `detail` checks `detail.id === selected.id`,
  // so the covered-risk editor can never be seeded with another indicator's risks.
  const detailFor = useRef<string | null>(null);
  const loadDetail = useCallback(async (kriId: string) => {
    detailFor.current = kriId;
    try { const next = await krisApi.get(token, kriId); if (detailFor.current === kriId) setDetail(next); }
    catch { if (detailFor.current === kriId) setDetail(null); }
  }, [token]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else { detailFor.current = null; setDetail(null); } }, [selectedId, loadDetail]);

  async function submitCovered(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setFormError(null);
    try {
      await krisApi.setCoveredRisks(token, selected.id, covered);
      setCoverOpen(false);
      await loadDetail(selected.id);
    } catch (err) { fail(err, setFormError); if (isForbidden(err)) setCoverOpen(false); }
    finally { setSaving(false); }
  }

  async function submitDisable(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setFormError(null);
    try {
      await krisApi.disable(token, selected.id, disableReason.trim());
      setDisableOpen(false); setSelectedId(null);
      await refresh();
    } catch (err) { fail(err, setFormError); if (isForbidden(err)) setDisableOpen(false); }
    finally { setSaving(false); }
  }

  function openCreate() { setForm(EMPTY_FORM); setFormError(null); setFormOpen("create"); }
  function openEdit(row: KriDashboardRow) {
    setForm({
      label: row.label, formula: row.formula, thresholdGreen: String(row.thresholdGreen), thresholdOrange: String(row.thresholdOrange),
      thresholdRed: String(row.thresholdRed), frequency: row.frequency, riskId: row.riskId, entity: row.entity ?? "",
      methodologyVersion: row.methodologyVersion ?? "", description: row.description ?? "",
    });
    setFormError(null); setFormOpen("edit");
  }

  async function submitKri(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFormError(null);
    const input: KriInput = {
      label: form.label.trim(), formula: form.formula.trim(), frequency: form.frequency,
      thresholdGreen: Number(form.thresholdGreen), thresholdOrange: Number(form.thresholdOrange), thresholdRed: Number(form.thresholdRed),
      entity: nullable(form.entity), methodologyVersion: nullable(form.methodologyVersion), description: nullable(form.description),
    };
    try {
      if (formOpen === "edit" && selected) await krisApi.update(token, selected.id, input);
      else {
        const created = await krisApi.create(token, { ...input, riskId: form.riskId });
        setSelectedId(created.id);
      }
      setFormOpen(null);
      await refresh();
      if (formOpen === "edit" && selectedId) await Promise.all([loadMeasures(selectedId), loadDetail(selectedId)]);
    } catch (err) { fail(err, setFormError); if (isForbidden(err)) setFormOpen(null); }
    finally { setSaving(false); }
  }

  async function submitMeasure(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setFormError(null);
    try {
      await krisApi.record(token, {
        kriId: selected.id, measureDate: measureForm.measureDate, value: Number(measureForm.value),
        source: measureForm.source.trim(), comment: nullable(measureForm.comment),
      });
      setMeasureOpen(false);
      await Promise.all([refresh(), loadMeasures(selected.id)]);
    } catch (err) { fail(err, setFormError); if (isForbidden(err)) setMeasureOpen(false); }
    finally { setSaving(false); }
  }

  const columns: TableColumn<KriDashboardRow>[] = [
    { key: "label", header: "Indicateur", render: (row) => <><strong>{row.label}</strong>{!row.active && <div className="muted">Inactif</div>}<div className="muted">Risque : {riskLabel(row.riskId)}</div></> },
    { key: "status", header: "Statut", render: (row) => <StatusBadge label={STATUS[row.status].label} tone={STATUS[row.status].tone} /> },
    { key: "latest", header: "Dernière mesure", render: (row) => row.latestMeasureValue === null ? "—" : <><strong>{fmt(row.latestMeasureValue)}</strong><div className="muted">{dateOnly(row.latestMeasureDate)}</div></> },
    { key: "thresholds", header: "Seuils vert / orange / rouge", render: (row) => `${fmt(row.thresholdGreen)} / ${fmt(row.thresholdOrange)} / ${fmt(row.thresholdRed)}` },
    { key: "frequency", header: "Fréquence", render: (row) => FREQUENCY_LABELS[row.frequency] },
    { key: "open", header: "", render: (row) => <Button onClick={() => setSelectedId(row.id)} aria-label={`Voir le détail de ${row.label}`}>Détail</Button> },
  ];

  const measureColumns: TableColumn<KriMeasure>[] = [
    { key: "date", header: "Date", render: (m) => dateOnly(m.measureDate) },
    { key: "value", header: "Valeur", render: (m) => <strong>{fmt(m.value)}</strong> },
    { key: "source", header: "Source", render: (m) => m.source },
    { key: "comment", header: "Commentaire", render: (m) => m.comment ?? "—" },
  ];

  const chronological = [...measures].reverse();

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">INDICATEURS · RISQUE</p>
        <h1>Indicateurs de risque (KRI)</h1>
        <p className="core-page__subtitle">Seuils, dernière mesure et statut tels que calculés par le serveur. Chaque KRI est rattaché à un risque du registre.</p>
      </div>
      {can("kri.create") && <Button variant="primary" onClick={openCreate}>Nouveau KRI</Button>}
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    <Card header={<strong>Tableau de bord des KRI</strong>}>
      <div className="core-form">
        <FormField label="Statut" htmlFor="kri-f-status">
          <select id="kri-f-status" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as KriStatus | undefined })}>
            <option value="">Tous</option>
            {(Object.keys(STATUS) as KriStatus[]).map((key) => <option key={key} value={key}>{STATUS[key].label}</option>)}
          </select>
        </FormField>
        <FormField label="Risque" htmlFor="kri-f-risk">
          <select id="kri-f-risk" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
            <option value="">Tous</option>
            {risks.map((r) => <option key={r.id} value={r.id}>{r.description}</option>)}
          </select>
        </FormField>
        {departments && <FormField label="Département" htmlFor="kri-f-dept">
          <select id="kri-f-dept" value={filters.departmentId ?? ""} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value || undefined })}>
            <option value="">Tous</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>}
        <FormField label="Entité" htmlFor="kri-f-entity"><input id="kri-f-entity" value={filters.entity ?? ""} onChange={(e) => setFilters({ ...filters, entity: e.target.value || undefined })} /></FormField>
        <FormField label="Dernière mesure du" htmlFor="kri-f-from"><input id="kri-f-from" type="date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} /></FormField>
        <FormField label="au" htmlFor="kri-f-to"><input id="kri-f-to" type="date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} /></FormField>
      </div>
      <Table columns={columns} rows={visibleRows} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucun KRI ne correspond aux filtres." />
    </Card>

    {selected && <Card
      header={<><strong>{selected.label}</strong> <StatusBadge label={STATUS[selected.status].label} tone={STATUS[selected.status].tone} /></>}
      footer={<>
        {can("kri.update") && <Button onClick={() => openEdit(selected)}>Modifier</Button>}
        {can("kri.update") && detail && detail.id === selected.id && <Button onClick={() => { setCovered(detail.coveredRiskIds); setFormError(null); setCoverOpen(true); }}>Risques couverts</Button>}
        {can("kri.delete") && <Button variant="destructive" onClick={() => { setDisableReason(""); setFormError(null); setDisableOpen(true); }}>Désactiver</Button>}
        {can("kri.create") && <Button variant="primary" onClick={() => { setMeasureForm(EMPTY_MEASURE); setFormError(null); setMeasureOpen(true); }}>Saisir une mesure</Button>}
      </>}
    >
      <p className="muted">Formule : {selected.formula}</p>
      {selected.description && <p className="muted">{selected.description}</p>}
      <p className="muted">
        Risque : {riskLabel(selected.riskId)} · Entité : {selected.entity ?? "—"} · Méthodologie : {selected.methodologyVersion ?? "—"}
      </p>
      {detail && detail.id === selected.id && <p className="muted">
        Autres risques couverts : {detail.coveredRiskIds.length === 0 ? "aucun" : detail.coveredRiskIds.map(riskLabel).join(" · ")}
      </p>}
      {measuresError && <MessageBanner tone="danger" title="Historique indisponible">{measuresError}</MessageBanner>}
      {chronological.length > 1 && <LineChart
        labels={chronological.map((m) => dateOnly(m.measureDate))}
        series={[
          { label: "Mesure", data: chronological.map((m) => m.value) },
          { label: "Seuil orange", data: chronological.map(() => selected.thresholdOrange) },
          { label: "Seuil rouge", data: chronological.map(() => selected.thresholdRed) },
        ]}
        height={220}
      />}
      <Table columns={measureColumns} rows={measures} rowKey={(m) => m.id} loading={measuresLoading} emptyMessage="Aucune mesure enregistrée pour ce KRI." />
      {measures.length >= 100 && <MessageBanner tone="info">Les 100 mesures les plus récentes sont affichées.</MessageBanner>}
    </Card>}

    <FormModal open={formOpen !== null} onClose={() => setFormOpen(null)} title={formOpen === "edit" ? "Modifier le KRI" : "Nouveau KRI"} formId="kri-form" saving={saving} submitLabel={formOpen === "edit" ? "Enregistrer" : "Créer"}>
      <form id="kri-form" onSubmit={submitKri}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Intitulé *" htmlFor="kri-label"><input id="kri-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required /></FormField>
        {formOpen === "create" && <FormField label="Risque surveillé *" htmlFor="kri-risk" help={risks.length === 0 ? "Aucun risque disponible (registre vide ou droit de lecture manquant)." : undefined}>
          <select id="kri-risk" value={form.riskId} onChange={(e) => setForm({ ...form, riskId: e.target.value })} required>
            <option value="">Sélectionner…</option>
            {risks.filter((r) => r.status !== "ARCHIVED").map((r) => <option key={r.id} value={r.id}>{r.description}</option>)}
          </select>
        </FormField>}
        <FormField label="Formule *" htmlFor="kri-formula"><input id="kri-formula" value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} required /></FormField>
        <FormField label="Seuil vert *" htmlFor="kri-green"><input id="kri-green" type="number" step="any" value={form.thresholdGreen} onChange={(e) => setForm({ ...form, thresholdGreen: e.target.value })} required /></FormField>
        <FormField label="Seuil orange *" htmlFor="kri-orange"><input id="kri-orange" type="number" step="any" value={form.thresholdOrange} onChange={(e) => setForm({ ...form, thresholdOrange: e.target.value })} required /></FormField>
        <FormField label="Seuil rouge *" htmlFor="kri-red" help="Le serveur valide la cohérence des seuils."><input id="kri-red" type="number" step="any" value={form.thresholdRed} onChange={(e) => setForm({ ...form, thresholdRed: e.target.value })} required /></FormField>
        <FormField label="Fréquence *" htmlFor="kri-frequency">
          <select id="kri-frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as IndicatorFrequency })}>
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </FormField>
        <FormField label="Entité" htmlFor="kri-entity"><input id="kri-entity" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} /></FormField>
        <FormField label="Version méthodologique" htmlFor="kri-method"><input id="kri-method" value={form.methodologyVersion} onChange={(e) => setForm({ ...form, methodologyVersion: e.target.value })} /></FormField>
        <FormField label="Description" htmlFor="kri-desc"><textarea id="kri-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
      </form>
    </FormModal>

    <FormModal open={coverOpen} onClose={() => setCoverOpen(false)} title="Risques couverts" formId="kri-cover-form" saving={saving} submitLabel="Enregistrer">
      <form id="kri-cover-form" onSubmit={submitCovered}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <p className="muted">Le risque principal ({selected ? riskLabel(selected.riskId) : "—"}) reste fixé à la création. Cochez les autres risques que ce KRI surveille.</p>
        {risks.filter((r) => r.status !== "ARCHIVED" && r.id !== selected?.riskId).map((r) => <label key={r.id} className="core-filter">
          <input type="checkbox" checked={covered.includes(r.id)} onChange={(e) => setCovered(e.target.checked ? [...covered, r.id] : covered.filter((id) => id !== r.id))} /> {r.description}
        </label>)}
        {risks.length === 0 && <p className="muted">Aucun risque disponible (registre vide ou droit de lecture manquant).</p>}
      </form>
    </FormModal>

    <FormModal open={disableOpen} onClose={() => setDisableOpen(false)} title="Désactiver le KRI" formId="kri-disable-form" saving={saving} submitLabel="Désactiver">
      <form id="kri-disable-form" onSubmit={submitDisable}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <MessageBanner tone="warning">La désactivation est définitive : le KRI et son historique restent tracés, mais il ne reçoit plus de mesure.</MessageBanner>
        <FormField label="Motif *" htmlFor="kri-disable-reason"><textarea id="kri-disable-reason" value={disableReason} onChange={(e) => setDisableReason(e.target.value)} required /></FormField>
      </form>
    </FormModal>

    <FormModal open={measureOpen} onClose={() => setMeasureOpen(false)} title="Saisir une mesure" formId="kri-measure-form" saving={saving} submitLabel="Enregistrer la mesure">
      <form id="kri-measure-form" onSubmit={submitMeasure}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FormField label="Date de mesure *" htmlFor="krim-date"><input id="krim-date" type="date" value={measureForm.measureDate} onChange={(e) => setMeasureForm({ ...measureForm, measureDate: e.target.value })} required /></FormField>
        <FormField label="Valeur *" htmlFor="krim-value"><input id="krim-value" type="number" step="any" value={measureForm.value} onChange={(e) => setMeasureForm({ ...measureForm, value: e.target.value })} required /></FormField>
        <FormField label="Source *" htmlFor="krim-source"><input id="krim-source" placeholder="ex. manuel" value={measureForm.source} onChange={(e) => setMeasureForm({ ...measureForm, source: e.target.value })} required /></FormField>
        <FormField label="Commentaire" htmlFor="krim-comment"><textarea id="krim-comment" value={measureForm.comment} onChange={(e) => setMeasureForm({ ...measureForm, comment: e.target.value })} /></FormField>
      </form>
    </FormModal>

  </section>;
}
