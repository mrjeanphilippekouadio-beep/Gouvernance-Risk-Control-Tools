import { useEffect, useState } from "react";
import { risksApi, type Risk, type RiskStatus } from "../../api/risks";
import { ApiError } from "../../api/client";
import { Button, FormField, MessageBanner, StatusBadge, Table, type StatusTone } from "@djamo/design-system";
import { RaciPanel } from "../../design-system";

interface RisksPageProps {
  /** Google ID token — see AuthContext TODO in App.tsx. */
  token: string;
  onEvaluate?: (riskId: string) => void;
}

const STATUS_LABELS: Record<RiskStatus, string> = {
  DRAFT: "Brouillon",
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};

const STATUS_TONES: Record<RiskStatus, StatusTone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  ARCHIVED: "neutral",
};

/**
 * Pure presentation + API calls. No scoring, no transition rules, no
 * permission checks here — the backend owns all of that (ADR-001).
 */
export function RisksPage({ token, onEvaluate }: RisksPageProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [process, setProcess] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState(() => crypto.randomUUID());
  // No detail/edit screen exists yet for a risk — RACI is exposed as a
  // per-row toggle rather than a new route (DESIGN_NOTES.md: don't build
  // a screen ahead of one being needed elsewhere).
  const [raciRiskId, setRaciRiskId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRisks(await risksApi.list(token));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await risksApi.create(token, { process, description }, createIdempotencyKey);
      setCreateIdempotencyKey(crypto.randomUUID());
      setProcess("");
      setDescription("");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section>
      <div className="page-heading-block"><p className="page-eyebrow">RISQUES · REGISTRE</p><h1>Registre des risques</h1><p className="page-subtitle">Identification et description du risque. La cotation inhérente, la maîtrise et le résiduel sont portés par l’évaluation dédiée.</p></div>
      <MessageBanner tone="info">Identification, pas évaluation. Le registre décrit les risques ; la cotation se fait ensuite sur la fiche d’évaluation.</MessageBanner>

      <form onSubmit={handleCreate} className="inline-form">
        <FormField label="Processus" htmlFor="risk-process">
          <input id="risk-process" value={process} onChange={(e) => setProcess(e.target.value)} required />
        </FormField>
        <FormField label="Description" htmlFor="risk-description">
          <input
            id="risk-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </FormField>
        <Button type="submit" variant="primary" disabled={creating} aria-busy={creating}>
          {creating ? "Création…" : "Créer"}
        </Button>
      </form>

      {error && <MessageBanner tone="danger">{error}</MessageBanner>}

      <Table
        loading={loading}
        emptyMessage="Aucun risque enregistré."
        rows={risks}
        rowKey={(risk) => risk.id}
        columns={[
          { key: "process", header: "Processus", render: (risk) => risk.process },
          { key: "description", header: "Description", render: (risk) => <strong>{risk.description}</strong> },
          { key: "department", header: "Département", render: (risk) => risk.ownerDepartmentId ?? <span className="admin-muted">Non assigné</span> },
          {
            key: "status",
            header: "Statut",
            render: (risk) => <StatusBadge label={STATUS_LABELS[risk.status]} tone={STATUS_TONES[risk.status]} />,
          },
          {
            key: "actions",
            header: "Actions",
            render: (risk) => (
              <div className="row-actions">
                <Button variant="primary" onClick={() => onEvaluate?.(risk.id)}>Évaluer</Button>
                <Button onClick={() => setRaciRiskId((current) => (current === risk.id ? null : risk.id))}>{raciRiskId === risk.id ? "Masquer" : "RACI"}</Button>
                {risk.status !== "ARCHIVED" && <Button variant="destructive" onClick={() => void risksApi.updateStatus(token, risk.id, "ARCHIVED").then(refresh).catch((err) => setError(describeError(err)))}>Archiver</Button>}
              </div>
            ),
          },
        ]}
      />

      {raciRiskId && <RaciPanel token={token} entityType="RISK" entityId={raciRiskId} />}
    </section>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}
