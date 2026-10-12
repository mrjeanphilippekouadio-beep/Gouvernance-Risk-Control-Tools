import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, FormField, LineChart, MessageBanner, StatusBadge, Table, type StatusTone, type TableColumn } from "@djamo/design-system";
import {
  krisApi,
  type IndicatorFrequency,
  type Kri,
  type KriInput,
  type KriMeasure,
  type KriStatus,
} from "../../api/indicators";
import { risksApi, type Risk } from "../../api/risks";
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
  const [rows, setRows] = useState<Kri[]>([]);
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

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await krisApi.list(token)); }
    catch (err) { fail(err, setError); }
    finally { setLoading(false); }
  }, [token, fail]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Risk labels are a convenience: a 403/failure just falls back to the raw id.
  useEffect(() => { risksApi.list(token).then(setRisks).catch(() => setRisks([])); }, [token]);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const riskLabel = (riskId: string) => risks.find((risk) => risk.id === riskId)?.description ?? riskId;

  const loadMeasures = useCallback(async (kriId: string) => {
    setMeasuresLoading(true); setMeasuresError(null);
    try { setMeasures(await krisApi.measures(token, kriId)); }
    catch (err) { setMeasures([]); fail(err, setMeasuresError); }
    finally { setMeasuresLoading(false); }
  }, [token, fail]);

  useEffect(() => { if (selectedId) void loadMeasures(selectedId); else setMeasures([]); }, [selectedId, loadMeasures]);

  function openCreate() { setForm(EMPTY_FORM); setFormError(null); setFormOpen("create"); }
  function openEdit(row: Kri) {
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
      if (formOpen === "edit" && selectedId) await loadMeasures(selectedId);
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

  const columns: TableColumn<Kri>[] = [
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
      <Button variant="primary" onClick={openCreate}>Nouveau KRI</Button>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    <Card header={<strong>Liste des KRI</strong>}>
      <Table columns={columns} rows={rows} rowKey={(row) => row.id} loading={loading} emptyMessage="Aucun KRI défini pour l'instant." />
    </Card>

    {selected && <Card
      header={<><strong>{selected.label}</strong> <StatusBadge label={STATUS[selected.status].label} tone={STATUS[selected.status].tone} /></>}
      footer={<><Button onClick={() => openEdit(selected)}>Modifier</Button><Button variant="primary" onClick={() => { setMeasureForm(EMPTY_MEASURE); setFormError(null); setMeasureOpen(true); }}>Saisir une mesure</Button></>}
    >
      <p className="muted">Formule : {selected.formula}</p>
      {selected.description && <p className="muted">{selected.description}</p>}
      <p className="muted">
        Risque : {riskLabel(selected.riskId)} · Entité : {selected.entity ?? "—"} · Méthodologie : {selected.methodologyVersion ?? "—"}
      </p>
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
