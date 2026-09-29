import { useEffect, useState } from "react";
import { feedbackApi, type Feedback, type FeedbackStatus } from "../../api/feedback";
import { ApiError } from "../../api/client";
import { FormField, MessageBanner, StatusBadge, Table, type StatusTone } from "@djamo/design-system";

interface FeedbackAdminProps {
  token: string;
}

const STATUSES: FeedbackStatus[] = ["NEW", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DECLINED"];

const STATUS_TONES: Record<FeedbackStatus, StatusTone> = {
  NEW: "info",
  ACKNOWLEDGED: "neutral",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  DECLINED: "danger",
};

// Fixed locale/format regardless of the viewer's browser settings — two
// Risk Managers in different locales must see the same audit timestamp
// format (DESIGN_NOTES.md section 3).
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

/** Triage view for what users submit through the FeedbackWidget. */
export function FeedbackAdmin({ token }: FeedbackAdminProps) {
  const [entries, setEntries] = useState<Feedback[]>([]);
  const [filter, setFilter] = useState<FeedbackStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await feedbackApi.list(token, filter || undefined));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);

  async function handleStatusChange(id: string, status: FeedbackStatus) {
    setError(null);
    try {
      await feedbackApi.updateStatus(token, id, status);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <section>
      <h2>Feedback</h2>

      <FormField label="Filtrer par statut" htmlFor="feedback-filter">
        <select
          id="feedback-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FeedbackStatus | "")}
        >
          <option value="">Tous</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FormField>

      {error && <MessageBanner tone="danger">{error}</MessageBanner>}

      <Table
        loading={loading}
        emptyMessage="Aucun feedback pour ce filtre."
        rows={entries}
        rowKey={(entry) => entry.id}
        columns={[
          { key: "category", header: "Catégorie", render: (entry) => entry.category },
          { key: "message", header: "Message", render: (entry) => entry.message },
          { key: "page", header: "Page", render: (entry) => entry.page ?? "—" },
          { key: "createdAt", header: "Reçu le", render: (entry) => DATE_FORMAT.format(new Date(entry.createdAt)) },
          {
            key: "status",
            header: "Statut",
            render: (entry) => (
              <div className="row-actions">
                <StatusBadge label={entry.status} tone={STATUS_TONES[entry.status]} />
                <select
                  aria-label={`Changer le statut du feedback ${entry.id}`}
                  value={entry.status}
                  onChange={(e) => handleStatusChange(entry.id, e.target.value as FeedbackStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}
