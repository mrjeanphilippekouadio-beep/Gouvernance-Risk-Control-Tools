import { useEffect, useState } from "react";
import { Button, Card, MessageBanner, StatusBadge, Table, Tabs, type StatusTone } from "@djamo/design-system";
import type { Risk, RiskStatus, RiskVisibility } from "../../api/risks";
import { RiskVisibilityBadge, RiskVisibilityCard } from "./RiskVisibility";
import { auditLogApi, type AuditEvent } from "../../api/auditLog";
import { ApiError } from "../../api/client";
import { RaciPanel } from "../../design-system";
import { EvaluationPage } from "../evaluations/EvaluationPage";
import "../core/CorePages.css";

export type RiskSheetTab = "identification" | "analysis" | "evaluation" | "history";

export interface RiskSheetShortcuts {
  onOpenFrameworks: () => void;
  onOpenAppetite: () => void;
  onOpenScales: () => void;
  onOpenProcesses: () => void;
}

const STATUS_LABELS: Record<RiskStatus, string> = { DRAFT: "Brouillon", ACTIVE: "Actif", ARCHIVED: "Archivé" };
const STATUS_TONES: Record<RiskStatus, StatusTone> = { DRAFT: "warning", ACTIVE: "success", ARCHIVED: "neutral" };

interface Props {
  token: string;
  risk: Risk;
  tab: RiskSheetTab;
  onTab: (tab: RiskSheetTab) => void;
  onBack: () => void;
  ownerLabel: string;
  superiorOwnerLabel: string | null;
  departmentLabel: string;
  shortcuts: RiskSheetShortcuts;
  /** Lot V1: the registry keeps its badge in step after a change on the sheet. */
  onVisibilityChanged?: (visibility: RiskVisibility) => void;
}

/**
 * Fiche risque (DECISION-062/065): Identification, Analyse, Évaluation, Historique.
 * Presentation only. The Évaluation tab is the existing EvaluationPage (one screen, two
 * entries); shortcuts navigate to Administration and write nothing.
 */
export function RiskSheet({ token, risk, tab, onTab, onBack, ownerLabel, superiorOwnerLabel, departmentLabel, shortcuts, onVisibilityChanged }: Props) {
  return <section className="core-page" aria-label={`Fiche du risque ${risk.description}`}>
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">RISQUES · FICHE RISQUE</p>
        <h1>{risk.description}</h1>
        <p className="core-page__subtitle">Processus {risk.process} · <StatusBadge label={STATUS_LABELS[risk.status]} tone={STATUS_TONES[risk.status]} /> <RiskVisibilityBadge visibility={risk.visibility} /></p>
      </div>
      <Button onClick={onBack}>Retour au registre</Button>
    </div>
    <Tabs
      items={[
        { value: "identification", label: "Identification" },
        { value: "analysis", label: "Analyse" },
        { value: "evaluation", label: "Évaluation" },
        { value: "history", label: "Historique" },
      ]}
      active={tab}
      onChange={onTab}
    />
    {tab === "identification" && <>
      <Card header={<h2>Identification</h2>}>
        <dl className="risk-sheet-facts">
          <div><dt>Processus</dt><dd>{risk.process}</dd></div>
          <div><dt>Département</dt><dd>{departmentLabel}</dd></div>
          <div><dt>Risk Owner</dt><dd>{ownerLabel}</dd></div>
          <div><dt>N+1</dt><dd>{superiorOwnerLabel ?? "Non désigné"}</dd></div>
        </dl>
        <Button variant="secondary" size="sm" onClick={shortcuts.onOpenProcesses}>Voir le Processus</Button>
      </Card>
      <RiskVisibilityCard token={token} riskId={risk.id} onChanged={(v) => onVisibilityChanged?.(v)} />
      <RaciPanel token={token} entityType="RISK" entityId={risk.id} />
    </>}
    {tab === "analysis" && <>
      <MessageBanner tone="info">Cette étape sera renseignée prochainement.</MessageBanner>
      <Card header={<h2>Contexte d'identification (lecture seule)</h2>}>
        <p>{risk.description}</p>
      </Card>
    </>}
    {tab === "evaluation" && <>
      <div className="risk-sheet-shortcuts">
        <Button variant="secondary" size="sm" onClick={shortcuts.onOpenFrameworks}>Voir le Dispositif</Button>
        <Button variant="secondary" size="sm" onClick={shortcuts.onOpenAppetite}>Voir le seuil d'appétence</Button>
        <Button variant="secondary" size="sm" onClick={shortcuts.onOpenScales}>Voir la grille</Button>
      </div>
      <EvaluationPage token={token} initialRiskId={risk.id} />
    </>}
    {tab === "history" && <RiskHistory token={token} riskId={risk.id} />}
  </section>;
}

function RiskHistory({ token, riskId }: { token: string; riskId: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setEvents(null); setError(null);
    auditLogApi.list(token, { entityType: "Risk", entityId: riskId, limit: 100 })
      .then((rows) => { if (live) setEvents(rows); })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof ApiError && err.status === 403
          ? "Vous n'avez pas le droit de consulter l'historique (journal d'audit)."
          : err instanceof Error ? err.message : "Une erreur inattendue est survenue.");
      });
    return () => { live = false; };
  }, [token, riskId]);

  if (error) return <MessageBanner tone="danger">{error}</MessageBanner>;
  return <Table
    loading={events === null}
    emptyMessage="Aucun événement enregistré pour ce risque."
    rows={events ?? []}
    rowKey={(event) => event.id}
    columns={[
      { key: "date", header: "Date", render: (event) => new Date(event.timestamp).toLocaleString("fr-FR") },
      { key: "action", header: "Action", render: (event) => event.action },
      { key: "reason", header: "Motif", render: (event) => event.reason ?? "—" },
    ]}
  />;
}
