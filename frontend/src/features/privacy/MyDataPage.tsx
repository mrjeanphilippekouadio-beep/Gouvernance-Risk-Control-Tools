import { useEffect, useState } from "react";
import { Card, MessageBanner } from "@djamo/design-system";
import { ApiError, apiRequest } from "../../api/client";
import { fillPrivacyNotice, PRIVACY_NOTICE_R5 } from "./privacyNotice";

interface PrivacyNoticeFacts {
  lastSeenRetentionDays: number | null;
  dpoContact: string | null;
}

/** R5 (q227): « Vos données » — the information text, with the client's retention (R3) and DPO contact from the server. */
export function MyDataPage({ token }: Readonly<{ token: string }>) {
  const [facts, setFacts] = useState<PrivacyNoticeFacts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiRequest<PrivacyNoticeFacts>("/api/v1/privacy/notice", { token })
      .then((f) => { if (live) setFacts(f); })
      .catch((err: unknown) => { if (live) setError(err instanceof ApiError ? err.message : "Une erreur inattendue est survenue."); });
    return () => { live = false; };
  }, [token]);

  return <section className="core-page">
    <div className="core-page__heading"><div>
      <p className="core-page__eyebrow">CONFIDENTIALITÉ</p>
      <h1>Vos données</h1>
    </div></div>
    {error && <MessageBanner tone="danger">{error}</MessageBanner>}
    <Card header={<strong>{PRIVACY_NOTICE_R5.title}</strong>}>
      {facts ? fillPrivacyNotice(facts.lastSeenRetentionDays, facts.dpoContact).map((p) => <p key={p.slice(0, 24)}>{p}</p>) : !error && <p>Chargement…</p>}
    </Card>
  </section>;
}
