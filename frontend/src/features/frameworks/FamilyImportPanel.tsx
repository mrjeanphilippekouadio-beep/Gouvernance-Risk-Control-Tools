import { useState } from "react";
import { Button, Card, FileUpload, MessageBanner, Table, type TableColumn } from "@djamo/design-system";
import { riskFrameworksApi, type FamilyImportLine, type FamilyImportReport } from "../../api/riskFrameworks";
import { describeError, isPermissionDenied } from "../indicators/shared";

const VERDICT_LABELS: Record<FamilyImportLine["verdict"], string> = {
  ACCEPTED: "Acceptée", WARNING: "Avertissement", ERROR: "Erreur", KEPT: "Conservée",
};

interface Props {
  token: string;
  frameworkId: string;
  versionId: string;
  onImported: () => Promise<void>;
}

/**
 * DECISION-133: import of the "families and sub-categories" text file into a DRAFT. Preview first (nothing written), then a
 * confirmation that sends the same file with the preview's fingerprint; the server re-checks everything. The screen shows
 * the server's verdicts and invents none.
 */
export function FamilyImportPanel({ token, frameworkId, versionId, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<FamilyImportReport | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  function pick(next: File | null) { setFile(next); setReport(null); setDone(false); setError(null); }

  async function preview() {
    if (!file) return;
    setBusy(true); setError(null); setDone(false);
    try { setReport(await riskFrameworksApi.importFamiliesPreview(token, frameworkId, versionId, file)); }
    catch (err) { setReport(null); if (!isPermissionDenied(err)) setError(describeError(err)); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!file || !report) return;
    setBusy(true); setError(null);
    try {
      setReport(await riskFrameworksApi.importFamiliesCommit(token, frameworkId, versionId, file, report.fingerprint));
      setDone(true);
      await onImported();
    } catch (err) { if (!isPermissionDenied(err)) setError(describeError(err)); }
    finally { setBusy(false); }
  }

  const columns: TableColumn<FamilyImportLine>[] = [
    { key: "line", header: "Ligne", render: (l) => (l.line === 0 ? "Fichier" : l.line) },
    { key: "family", header: "Famille", render: (l) => l.family ?? "—" },
    { key: "sub", header: "Sous-catégorie", render: (l) => l.subCategory ?? "—" },
    { key: "verdict", header: "Verdict du serveur", render: (l) => `${VERDICT_LABELS[l.verdict]}${l.messages.length ? ` : ${l.messages.join(" ; ")}` : ""}` },
  ];

  return <Card header={<strong>Importer les familles et sous-catégories</strong>}>
    <p>Fichier texte .txt en UTF-8 (64 Ko et 200 lignes au plus), une ligne par rattachement : <code>famille;sous-catégorie[;catégorie parente]</code>. Les lignes commençant par # sont ignorées. Les sous-catégories doivent déjà exister dans le référentiel. Le fichier ne contient aucun seuil ni donnée personnelle : les seuils viennent de l'échelle de ce brouillon. Les valeurs déjà saisies ne sont jamais remplacées. Enregistrez vos modifications en cours avant d'importer : l'écran est rechargé après l'import.</p>
    {error && <div role="alert"><MessageBanner tone="danger" title="Import impossible">{error}</MessageBanner></div>}
    <FileUpload key={pickerKey} accept=".txt,text/plain" buttonLabel="Choisir un fichier .txt" onSelect={pick} disabled={busy || done} />
    <div>
      <Button onClick={() => void preview()} disabled={!file || busy || done}>{busy && !report ? "Analyse…" : "Aperçu (sans écriture)"}</Button>{" "}
      {report && !done && report.errorCount === 0 && report.acceptedCount > 0 &&
        <Button variant="primary" onClick={() => void commit()} disabled={busy}>Confirmer l'import de {report.acceptedCount} entrée{report.acceptedCount > 1 ? "s" : ""}</Button>}
      {done && <Button onClick={() => { setFile(null); setReport(null); setDone(false); setPickerKey((k) => k + 1); }}>Nouvel import</Button>}
    </div>
    {report && <>
      {done
        ? <div role="status"><MessageBanner tone="success" title="Import terminé">{report.createdCount ?? 0} entrée{(report.createdCount ?? 0) > 1 ? "s" : ""} ajoutée{(report.createdCount ?? 0) > 1 ? "s" : ""} au brouillon avec la mention « valeur de départ à confirmer ».</MessageBanner></div>
        : <MessageBanner tone={report.errorCount > 0 ? "danger" : report.warningCount > 0 ? "warning" : "info"} title="Aperçu : rien n'a été écrit">
          {report.dataLines} ligne{report.dataLines > 1 ? "s" : ""} lue{report.dataLines > 1 ? "s" : ""} : {report.acceptedCount} acceptée{report.acceptedCount > 1 ? "s" : ""}, {report.keptCount} conservée{report.keptCount > 1 ? "s" : ""}, {report.warningCount} avertissement{report.warningCount > 1 ? "s" : ""}, {report.errorCount} erreur{report.errorCount > 1 ? "s" : ""}.
          {report.errorCount > 0 ? " Une seule erreur bloque tout l'import : corrigez le fichier et relancez l'aperçu." : ` Seuils appliqués : ${report.thresholds.strict} (familles strictes), ${report.thresholds.moderate} (autres).`}
        </MessageBanner>}
      {report.notices.map((n) => <MessageBanner key={n} tone="warning">{n}</MessageBanner>)}
      {report.withoutFamily.length > 0 && <MessageBanner tone="info" title="Sous-catégories sans famille dans le fichier">{report.withoutFamily.join(", ")} : aucune entrée d'appétence ne sera créée pour elles.</MessageBanner>}
      <Table columns={columns} rows={report.lines} rowKey={(l) => `${l.line}|${l.subCategory ?? ""}|${l.verdict}`} loading={false} emptyMessage="Aucune ligne." />
    </>}
  </Card>;
}
