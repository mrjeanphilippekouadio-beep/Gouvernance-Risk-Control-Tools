import { useState } from "react";
import { feedbackApi, type FeedbackCategory } from "../../api/feedback";
import { ApiError } from "../../api/client";
import { Button, FormField } from "../../design-system";

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
      <Button variant="primary" className="feedback-widget__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Fermer" : "Feedback"}
      </Button>

      {open && (
        <div className="feedback-widget__panel">
          {sent ? (
            <>
              <p>Merci, c'est transmis.</p>
              <Button onClick={reset}>Envoyer autre chose</Button>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <FormField label="Catégorie" htmlFor="feedback-category">
                <select
                  id="feedback-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                >
                  {(Object.keys(CATEGORY_LABELS) as FeedbackCategory[]).map((key) => (
                    <option key={key} value={key}>
                      {CATEGORY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Message" htmlFor="feedback-message">
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  required
                  placeholder="Un bug, une idée, une recommandation…"
                />
              </FormField>
              {error && <p role="alert">{error}</p>}
              <Button type="submit" variant="primary" disabled={sending || !message.trim()}>
                {sending ? "Envoi…" : "Envoyer"}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
