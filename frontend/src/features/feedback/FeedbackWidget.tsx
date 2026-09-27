import { useState } from "react";
import { feedbackApi, type FeedbackCategory } from "../../api/feedback";
import { ApiError } from "../../api/client";

interface FeedbackWidgetProps {
  /** Google ID token — see AuthContext TODO in App.tsx. */
  token: string;
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  BUG: "Bug",
  IDEA: "Idée",
  RECOMMENDATION: "Recommandation",
  OTHER: "Autre",
};

/**
 * Rendered once at the app shell level (not per-page) so every
 * authenticated page gets it for free — see App.tsx.
 */
export function FeedbackWidget({ token }: FeedbackWidgetProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("RECOMMENDATION");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function reset() {
    setCategory("RECOMMENDATION");
    setMessage("");
    setError(null);
    setSent(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await feedbackApi.create(token, { category, message, page: window.location.pathname });
      setSent(true);
      setMessage("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible, réessayez plus tard.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="feedback-widget">
      <button type="button" className="feedback-widget__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Fermer" : "Feedback"}
      </button>

      {open && (
        <div className="feedback-widget__panel">
          {sent ? (
            <>
              <p>Merci, c'est transmis.</p>
              <button type="button" onClick={reset}>
                Envoyer autre chose
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <label>
                Catégorie
                <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}>
                  {(Object.keys(CATEGORY_LABELS) as FeedbackCategory[]).map((key) => (
                    <option key={key} value={key}>
                      {CATEGORY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Message
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  required
                  placeholder="Un bug, une idée, une recommandation…"
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <button type="submit" disabled={sending || !message.trim()}>
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
