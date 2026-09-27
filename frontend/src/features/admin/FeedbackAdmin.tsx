import { useEffect, useState } from "react";
import { feedbackApi, type Feedback, type FeedbackStatus } from "../../api/feedback";
import { ApiError } from "../../api/client";

interface FeedbackAdminProps {
  token: string;
}

const STATUSES: FeedbackStatus[] = ["NEW", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DECLINED"];

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

      <label>
        Filtrer par statut
        <select value={filter} onChange={(e) => setFilter(e.target.value as FeedbackStatus | "")}>
          <option value="">Tous</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {error && <p role="alert">{error}</p>}

      {loading ? (
        <p>Chargement…</p>
      ) : entries.length === 0 ? (
        <p>Aucun feedback pour ce filtre.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Message</th>
              <th>Page</th>
              <th>Reçu le</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.category}</td>
                <td>{entry.message}</td>
                <td>{entry.page ?? "—"}</td>
                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td>
                  <select
                    value={entry.status}
                    onChange={(e) => handleStatusChange(entry.id, e.target.value as FeedbackStatus)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}
