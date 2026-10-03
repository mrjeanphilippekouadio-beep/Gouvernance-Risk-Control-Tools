import { useEffect, useMemo, useState } from "react";
import { Card, FormField, MessageBanner, StatusBadge, type StatusTone } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { risksApi, type Risk } from "../../api/risks";
import { evaluationsApi, type RiskEvaluation, type EvaluationStatus } from "../../api/evaluations";
import "./CartographyPage.css";

interface CartographyPageProps { token: string; }

interface RiskPoint {
  risk: Risk;
  evaluation: RiskEvaluation;
  inherentImpact: number;
  residualImpact: number;
  inherentProbability: number;
  residualProbability: number;
}

const STATUS: Record<EvaluationStatus, { label: string; tone: StatusTone }> = {
  BROUILLON: { label: "Brouillon", tone: "neutral" },
  VALIDATED: { label: "Validé", tone: "success" },
  VALIDE_COMITE: { label: "Validé comité", tone: "success" },
  REJECTED: { label: "Rejetée", tone: "danger" },
};


function latestEvaluation(list: RiskEvaluation[]) {
  return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function impactValue(impacts: { code: string; value: number }[] | null, retained: number | null) {
  if (retained != null) return Math.max(1, Math.min(5, Math.round(retained)));
  return Math.max(1, Math.min(5, Math.round(impacts?.[0]?.value ?? 1)));
}

function statusTone(status: EvaluationStatus) {
  return STATUS[status];
}

export function CartographyPage({ token }: CartographyPageProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [points, setPoints] = useState<RiskPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialErrorCount, setPartialErrorCount] = useState(0);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<EvaluationStatus | "">("");
  const [concentrationDimension, setConcentrationDimension] = useState<"process" | "department">("process");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const riskList = await risksApi.list(token);
        const results = await Promise.all(
          riskList.map(async (risk) => {
            try {
              const evaluations = await evaluationsApi.listForRisk(token, risk.id);
              const evaluation = latestEvaluation(evaluations);
              if (!evaluation) return { point: null, failed: false };
              return {
                point: {
                  risk,
                  evaluation,
                  inherentImpact: impactValue(evaluation.inherentImpacts, evaluation.inherentImpactRetained),
                  residualImpact: impactValue(evaluation.residualImpacts, evaluation.residualImpactRetained),
                  inherentProbability: Math.max(1, Math.min(5, Math.round(evaluation.inherentProbability ?? 1))),
                  residualProbability: Math.max(1, Math.min(5, Math.round(evaluation.residualProbability ?? 1))),
                } satisfies RiskPoint,
                failed: false,
              };
            } catch {
              return { point: null, failed: true };
            }
          }),
        );
        if (!cancelled) {
          setRisks(riskList);
          setPoints(results.flatMap((result) => result.point ? [result.point] : []));
          setPartialErrorCount(results.filter((result) => result.failed).length);
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [token]);

  const departments = useMemo(
    () => Array.from(new Set(risks.map((r) => r.ownerDepartmentId).filter(Boolean) as string[])).sort(),
    [risks],
  );
  const processes = useMemo(
    () => Array.from(new Set(risks.map((r) => r.process))).sort(),
    [risks],
  );

  const filtered = useMemo(() => points.filter((point) => {
    if (departmentFilter && point.risk.ownerDepartmentId !== departmentFilter) return false;
    if (processFilter && point.risk.process !== processFilter) return false;
    if (statusFilter && point.evaluation.status !== statusFilter) return false;
    return true;
  }), [points, departmentFilter, processFilter, statusFilter]);

  const concentration = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((p) => {
      const key = concentrationDimension === "process"
        ? p.risk.process
        : (p.risk.ownerDepartmentId ?? "Non assigné");
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [filtered, concentrationDimension]);

  return (
    <section className="cart-page">
      <div className="cart-pagehead">
        <div>
          <nav className="cart-breadcrumb" aria-label="Fil d'Ariane">
            <span>Risques</span><b>/</b><strong>Cartographie</strong>
          </nav>
          <p className="cart-eyebrow">RISQUES · VUE CONSOLIDÉE</p>
          <h1>Cartographie des risques</h1>
          <p className="cart-subtitle">Deux lectures complémentaires du même portefeuille : le risque inhérent et le risque résiduel après prise en compte du dispositif de maîtrise.</p>
        </div>
        <div className="cart-kpis">
          <div><span>Risques évalués</span><strong>{loading ? "—" : filtered.length}</strong></div>
          <div><span>Points suivis</span><strong>{loading ? "—" : points.length}</strong></div>
        </div>
      </div>

      {error && <MessageBanner tone="danger">{error}</MessageBanner>}
      {partialErrorCount > 0 && (
        <MessageBanner tone="warning">
          Impossible de charger les évaluations de {partialErrorCount} risque(s). La cartographie peut être incomplète ; les données manquantes ne sont pas assimilées à des risques sans évaluation.
        </MessageBanner>
      )}

      <MessageBanner tone="info">
        <strong>Dépend d'Évaluation, jamais l'inverse.</strong> Chaque point de cette cartographie provient d'une évaluation renvoyée par le backend. La page n'invente aucun score.
      </MessageBanner>

      <div className="cart-filters">
        <FormField label="Département" htmlFor="cart-department">
          <select id="cart-department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">Tous</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </FormField>
        <FormField label="Processus" htmlFor="cart-process">
          <select id="cart-process" value={processFilter} onChange={(e) => setProcessFilter(e.target.value)}>
            <option value="">Tous</option>
            {processes.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Statut de l'évaluation" htmlFor="cart-status">
          <select id="cart-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as EvaluationStatus | "")}>
            <option value="">Tous</option>
            <option value="VALIDATED">Validé</option>
            <option value="VALIDE_COMITE">Validé comité</option>
            <option value="BROUILLON">Brouillon</option>
            <option value="REJECTED">Rejetée</option>
          </select>
        </FormField>
      </div>

      <div className="cart-heatmaps">
        <HeatmapCard title="1 — Risque inhérent" subtitle="Avant l'effet des contrôles." points={filtered.map((p) => ({ id: p.evaluation.id, x: p.inherentImpact, y: p.inherentProbability, label: p.evaluation.id, status: p.evaluation.status }))} />
        <HeatmapCard title="2 — Risque résiduel" subtitle="Après l'effet des contrôles — mêmes risques." points={filtered.map((p) => ({ id: p.evaluation.id, x: p.residualImpact, y: p.residualProbability, label: p.evaluation.id, status: p.evaluation.status, residual: true }))} />
      </div>

      <div className="cart-concentration-grid">
        <Card header={<div className="cart-card-title"><div><h2>3 — Concentration</h2><p>Nombre de risques évalués selon l'axe sélectionné.</p></div><label className="cart-inline-select" htmlFor="cart-concentration-dimension"><span>Axe</span><select id="cart-concentration-dimension" value={concentrationDimension} onChange={(e) => setConcentrationDimension(e.target.value as "process" | "department")}><option value="process">Processus</option><option value="department">Département</option></select></label></div>}>
          <div className="concentration-grid">
            {concentration.length === 0 && <div className="cart-empty">Aucune donnée de concentration pour les filtres sélectionnés.</div>}
            {concentration.map(([name, count]) => <div className="concentration-cell" key={name}><span>{name}</span><strong>{count}</strong></div>)}
          </div>
        </Card>

        <Card header={<div className="cart-card-title"><div><h2>4 — Répartition</h2><p>Lecture synthétique des points visibles.</p></div></div>}>
          <div className="cart-status-summary">
            {(Object.keys(STATUS) as EvaluationStatus[]).map((status) => (
              <div key={status}><StatusBadge label={STATUS[status].label} tone={STATUS[status].tone} /><strong>{filtered.filter((p) => p.evaluation.status === status).length}</strong></div>
            ))}
          </div>
          <div className="cart-note">La cartographie respecte le périmètre de visibilité de l'utilisateur et n'affiche pas de score lorsqu'aucune évaluation n'est disponible.</div>
        </Card>
      </div>

      <Card header={<div className="cart-card-title"><div><h2>Risques sur les deux cartes</h2><p>Portefeuille filtré · {filtered.length} évaluation(s) représentée(s)</p></div></div>}>
        <div className="cart-table-wrap">
          <table className="cart-table">
            <thead><tr><th>Évaluation</th><th>Risque</th><th>Processus</th><th>Statut</th><th>Inhérent</th><th>Résiduel</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="cart-loading">Chargement de la cartographie…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="cart-loading">Aucun point à afficher.</td></tr>}
              {filtered.map((point) => (
                <tr key={point.evaluation.id}>
                  <td><code>{point.evaluation.id}</code></td>
                  <td><strong>{point.risk.description}</strong></td>
                  <td>{point.risk.process}</td>
                  <td><StatusBadge label={statusTone(point.evaluation.status).label} tone={statusTone(point.evaluation.status).tone} /></td>
                  <td><span className="cart-score">{point.evaluation.inherentScore ?? (point.inherentProbability + "×" + point.inherentImpact)}</span></td>
                  <td><span className="cart-score">{point.evaluation.residualScore ?? (point.residualProbability + "×" + point.residualImpact)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function HeatmapCard({ title, subtitle, points }: {
  title: string;
  subtitle: string;
  points: Array<{ id: string; x: number; y: number; label: string; status: EvaluationStatus; residual?: boolean }>;
}) {
  return (
    <Card className="cart-heatmap-card" header={<div><h2>{title}</h2><p>{subtitle}</p></div>}>
      <div className="heatmap-wrap">
        <div className="heatmap-ylabel">Probabilité</div>
        <div>
          <div className="heatmap" aria-label={title}>
            {Array.from({ length: 25 }, (_, i) => {
              const x = (i % 5) + 1;
              const y = 5 - Math.floor(i / 5);
              const riskPoints = points.filter((point) => point.x === x && point.y === y);
              const zone = Math.max(1, Math.min(5, Math.ceil((x * y) / 5)));
              return (
                <div className={"heatmap-cell z" + zone} key={i}>
                  {riskPoints.map((point) => (
                    <span className={point.residual ? "risk-dot residual" : "risk-dot"} tabIndex={0} key={point.id}>
                      <span className="risk-tooltip">{point.label} · {STATUS[point.status].label}</span>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="heatmap-xlabels"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
          <div className="heatmap-xaxis-title">Impact</div>
        </div>
      </div>
      <div className="heatmap-legend"><span><i className="legend-dot" /> Évalué</span><span><i className="legend-ring" /> Résiduel</span><span className="legend-text">Faible → Critique</span></div>
    </Card>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message + (err.requestId ? " (réf. " + err.requestId + ")" : "");
  if (err instanceof Error) return err.message;
  return "Une erreur inattendue est survenue.";
}
