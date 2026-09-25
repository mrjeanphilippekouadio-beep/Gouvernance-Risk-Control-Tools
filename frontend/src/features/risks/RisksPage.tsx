import { useEffect, useState } from "react";
import { risksApi, type Risk } from "../../api/risks";
import { ApiError } from "../../api/client";

interface RisksPageProps {
  /** Google ID token — see AuthContext TODO in App.tsx. */
  token: string;
}

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

      <form onSubmit={handleCreate}>
        <input
          placeholder="Processus"
          value={process}
          onChange={(e) => setProcess(e.target.value)}
          required
        />
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <button type="submit">Créer</button>
      </form>

      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Chargement…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Processus</th>
              <th>Description</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {risks.map((risk) => (
              <tr key={risk.id}>
                <td>{risk.process}</td>
                <td>{risk.description}</td>
                <td>{risk.status}</td>
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
