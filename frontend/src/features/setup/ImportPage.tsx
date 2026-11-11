import { useState, type FormEvent } from "react";
import { Button, Card, FileUpload, FormField, MessageBanner, Table, type TableColumn } from "@djamo/design-system";
import { setupApi, type ImportReport, type ImportRowOutcome } from "../../api/setup";
import { ApiError } from "../../api/client";
import { FormModal, describeError } from "../indicators/shared";
import "../core/CorePages.css";

const XLSX = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * F8 R1 (q165) : import Excel. Aujourd'hui le serveur n'importe que des risques (colonnes « process » et « description »).
 * Aperçu sans écriture, puis validation séparée : le serveur relit et revalide le fichier, l'écran n'invente aucun verdict.
 */
export function ImportPage({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  // q263: the server said this exact file was already imported; the user must confirm with a reason.
  const [confirming, setConfirming] = useState(false);
  const [reimportReason, setReimportReason] = useState("");

  function pick(next: File | null) { setFile(next); setReport(null); setCommitted(false); setError(null); }

  async function run(commit: boolean, reason?: string) {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      setReport(commit ? await setupApi.importCommit(token, file, reason) : await setupApi.importPreview(token, file));
      setCommitted(commit);
      setConfirming(false); setReimportReason("");
    } catch (err) {
      if (commit && !reason && err instanceof ApiError && err.status === 409 && err.code === "ALREADY_IMPORTED") setConfirming(true);
      else { setError(describeError(err)); if (reason) setConfirming(false); }
    } finally { setBusy(false); }
  }

  function confirmReimport(event: FormEvent) {
    event.preventDefault();
    if (reimportReason.trim()) void run(true, reimportReason.trim());
  }

  const columns: TableColumn<ImportRowOutcome>[] = [
    { key: "row", header: "Ligne", render: (r) => r.row },
    { key: "process", header: "Processus", render: (r) => r.process ?? "—" },
    { key: "description", header: "Description", render: (r) => r.description ?? "—" },
    { key: "result", header: "Résultat", render: (r) => (r.errors.length === 0 ? "Valide" : `Refusée : ${r.errors.join(" ; ")}`) },
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · MISE EN SERVICE</p>
        <h1>Import Excel</h1>
        <p className="core-page__subtitle">Import de risques depuis un classeur .xlsx (10 Mo au plus) : une ligne par risque, colonnes « process » et « description ». Vérifiez d'abord l'aperçu, rien n'est créé avant la validation.</p>
      </div>
    </div>
    {error && <MessageBanner tone="danger" title="Import impossible">{error}</MessageBanner>}
    <Card header={<strong>Fichier</strong>}>
      <FileUpload key={pickerKey} accept={XLSX} buttonLabel="Choisir un classeur .xlsx" onSelect={pick} disabled={busy || committed} />
      <div>
        <Button onClick={() => void run(false)} disabled={!file || busy || committed}>{busy ? "Analyse…" : "Aperçu (sans écriture)"}</Button>{" "}
        {report && !committed && report.validCount > 0 && <Button variant="primary" onClick={() => void run(true)} disabled={busy}>Importer {report.validCount} ligne{report.validCount > 1 ? "s" : ""} valide{report.validCount > 1 ? "s" : ""}</Button>}
        {committed && <Button onClick={() => { setFile(null); setReport(null); setCommitted(false); setPickerKey((k) => k + 1); }}>Nouvel import</Button>}
      </div>
    </Card>
    {report?.alreadyImported && !committed && <MessageBanner tone="warning" title="Fichier déjà importé">Ce fichier a déjà été importé. Pour l'importer de nouveau, il faudra confirmer avec un motif.</MessageBanner>}
    <FormModal open={confirming} onClose={() => { if (!busy) setConfirming(false); }} title="Fichier déjà importé" formId="reimport-form" saving={busy} submitLabel="Importer de nouveau">
      <form id="reimport-form" onSubmit={confirmReimport}>
        <MessageBanner tone="warning">Ce fichier a déjà été importé : un nouvel import recrée les risques. Indiquez le motif, il sera tracé.</MessageBanner>
        <FormField label="Motif (obligatoire)" htmlFor="reimport-reason">
          <textarea id="reimport-reason" value={reimportReason} onChange={(e) => setReimportReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>
    </FormModal>
    {report && <>
      {committed
        ? <MessageBanner tone={report.createdCount === report.validCount ? "success" : "warning"} title="Import terminé">{report.createdCount ?? 0} risque{(report.createdCount ?? 0) > 1 ? "s" : ""} créé{(report.createdCount ?? 0) > 1 ? "s" : ""} sur {report.totalRows} ligne{report.totalRows > 1 ? "s" : ""}. Les lignes refusées figurent ci-dessous avec leur raison.</MessageBanner>
        : <MessageBanner tone={report.invalidCount > 0 ? "warning" : "info"} title="Aperçu : rien n'a été créé">{report.totalRows} ligne{report.totalRows > 1 ? "s" : ""} lue{report.totalRows > 1 ? "s" : ""} : {report.validCount} valide{report.validCount > 1 ? "s" : ""}, {report.invalidCount} refusée{report.invalidCount > 1 ? "s" : ""}. Les lignes refusées ne seront pas importées.</MessageBanner>}
      <Card header={<strong>Détail par ligne</strong>}>
        <Table columns={columns} rows={report.rows} rowKey={(r) => String(r.row)} loading={false} emptyMessage="Le classeur ne contient aucune ligne." />
      </Card>
    </>}
  </section>;
}
