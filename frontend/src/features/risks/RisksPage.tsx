import { useEffect, useState } from "react";
import { risksApi, type Risk, type RiskStatus } from "../../api/risks";
import { ApiError } from "../../api/client";
import { Button, FormField, RaciPanel, StatusBadge, Table, type StatusTone } from "../../design-system";

interface RisksPageProps {
  /** Google ID token — see AuthContext TODO in App.tsx. */
  token: string;
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
export function RisksPage({ token }: RisksPageProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [process, setProcess] = useState("");
  const [description, setDescription] = useState("");
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
    setError(null);
    try {
      await risksApi.create(token, { process, description });
      setProcess("");
      setDescription("");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <section>
      <h1>Risques</h1>

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
        <Button type="submit" variant="primary">
          Créer
        </Button>
      </form>

      {error && <p role="alert">{error}</p>}

      <Table
        loading={loading}
        emptyMessage="Aucun risque enregistré."
        rows={risks}
        rowKey={(risk) => risk.id}
        columns={[
          { key: "process", header: "Processus", render: (risk) => risk.process },
          { key: "description", header: "Description", render: (risk) => risk.description },
          {
            key: "status",
            header: "Statut",
            render: (risk) => <StatusBadge label={STATUS_LABELS[risk.status]} tone={STATUS_TONES[risk.status]} />,
          },
          {
            key: "raci",
            header: "RACI",
            render: (risk) => (
              <Button onClick={() => setRaciRiskId((current) => (current === risk.id ? null : risk.id))}>
                {raciRiskId === risk.id ? "Masquer" : "RACI"}
              </Button>
            ),
          },
        ]}
      />

      {raciRiskId && <RaciPanel token={token} entityType="Risk" entityId={raciRiskId} />}
    </section>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}
