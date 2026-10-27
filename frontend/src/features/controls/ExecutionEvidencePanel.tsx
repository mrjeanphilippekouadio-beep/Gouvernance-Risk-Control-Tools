import { useCallback, useEffect, useState } from "react";
import { Button, Card, MessageBanner, Table, type TableColumn } from "@djamo/design-system";
import { evidenceApi, XLSX_MIME, type Evidence, type EvidenceAnalysis } from "../../api/evidence";
import { usePermissions } from "../../auth/usePermissions";
import { describeError } from "../indicators/shared";

const sizeLabel = (bytes: number | null | undefined) => (bytes == null ? "—" : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} Ko` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`);

/**
 * Lot F7-S1 (DECISION-090): read the evidences of one control execution — list, open (the server audits each
 * access before releasing the link), and the xlsx analysis of EVD-2. Rights are the server's; buttons only hide.
 */
export function ExecutionEvidencePanel({ token, executionId, label, onClose }: Readonly<{
  token: string;
  executionId: string;
  label: string;
  onClose: () => void;
}>) {
  const { can } = usePermissions(token);
  const [rows, setRows] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EvidenceAnalysis | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setAnalysis(null);
    try { setRows(await evidenceApi.listForExecution(token, executionId)); }
    catch (err) { setError(describeError(err)); }
    finally { setLoading(false); }
  }, [token, executionId]);
  useEffect(() => { void load(); }, [load]);

  async function open(e: Evidence) {
    // Opened synchronously from the click so popup blockers allow it, then sent to the link once the server releases it.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setBusyId(e.id); setError(null);
    try {
      const { url } = await evidenceApi.url(token, e.id);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      tab?.close();
      setError(describeError(err));
    } finally { setBusyId(null); }
  }

  async function analyze(e: Evidence) {
    setBusyId(e.id); setError(null); setAnalysis(null);
    try { setAnalysis(await evidenceApi.analyze(token, e.id)); }
    catch (err) { setError(describeError(err)); }
    finally { setBusyId(null); }
  }

  const columns: TableColumn<Evidence>[] = [
    { key: "file", header: "Fichier", render: (e) => <><strong>{e.fileName}</strong><div className="muted">{e.documentType}</div></> },
    { key: "date", header: "Déposée le", render: (e) => e.uploadedAt.slice(0, 10) },
    { key: "size", header: "Taille", render: (e) => sizeLabel(e.fileSize) },
    { key: "sha", header: "Empreinte", render: (e) => (e.sha256 ? <code title={e.sha256}>{e.sha256.slice(0, 12)}…</code> : "—") },
    { key: "actions", header: "", render: (e) => <>
      {can("evidence.download") && <Button disabled={busyId === e.id} onClick={() => void open(e)}>Ouvrir</Button>}{" "}
      {e.mimeType === XLSX_MIME && can("evidence.import") && <Button disabled={busyId === e.id} onClick={() => void analyze(e)}>Analyser</Button>}
    </> },
  ];

  return <Card header={<div><h2>Preuves de {label}</h2><p>Chaque ouverture est tracée dans le journal d'audit avant que le lien soit délivré.</p></div>} footer={<Button onClick={onClose}>Fermer</Button>}>
    {error && <MessageBanner tone="danger">{error}</MessageBanner>}
    <Table columns={columns} rows={rows} rowKey={(e) => e.id} loading={loading} emptyMessage="Aucune preuve déposée pour cette exécution." />
    {analysis && <div>
      <h3>Analyse de {analysis.fileName}</h3>
      {analysis.sheets.map((sheet) => <div key={sheet.name}>
        <p><strong>Feuille « {sheet.name} »</strong> · {sheet.rowCount} ligne(s) de données · en-tête {sheet.headerRow === null ? "absent" : `ligne ${sheet.headerRow}${sheet.headerDetected ? "" : " (première ligne non vide, en-tête non reconnu)"}`}</p>
        <ul>{sheet.columns.map((c) => <li key={c.index}>{c.name || `Colonne ${c.index}`} : {c.isEmpty ? "vide" : c.inferredType}{c.examples.length > 0 ? ` (ex. ${c.examples.join(", ")})` : ""}</li>)}</ul>
      </div>)}
    </div>}
  </Card>;
}
