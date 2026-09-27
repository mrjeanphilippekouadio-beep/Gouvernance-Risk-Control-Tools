import { useState } from "react";
import { RisksPage } from "./features/risks/RisksPage";
import { AdminPage } from "./features/admin/AdminPage";
import { FeedbackWidget } from "./features/feedback/FeedbackWidget";
import { useGoogleSignIn } from "./auth/useGoogleSignIn";
import { Button, FormField, Tabs } from "./design-system";
import "./App.css";

const GOOGLE_CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;

type View = "risks" | "admin";

function App() {
  const { idToken, error, buttonRef, signOut } = useGoogleSignIn(GOOGLE_CLIENT_ID);
  const [devToken, setDevToken] = useState("");
  const [view, setView] = useState<View>("risks");

  const token = idToken ?? devToken;

  if (token) {
    return (
      <>
        <main>
          <h1>GRC Tools</h1>
          <div className="app-nav-bar">
            <Tabs
              items={[
                { value: "risks", label: "Risques" },
                { value: "admin", label: "Admin" },
              ]}
              active={view}
              onChange={setView}
            />
            <Button onClick={idToken ? signOut : () => setDevToken("")}>Déconnexion</Button>
          </div>
          {view === "risks" ? <RisksPage token={token} /> : <AdminPage token={token} />}
        </main>
        {/* Rendered at the shell level, not per-page, so every
            authenticated page gets the feedback button for free. */}
        <FeedbackWidget token={token} />
      </>
    );
  }

  return (
    <main>
      <h1>GRC Tools</h1>

      {error ? (
        <div>
          <p role="alert">
            Connexion Google indisponible ({error}). Configurer
            VITE_GOOGLE_CLIENT_ID dans .env.local pour l'activer.
          </p>
          <FormField
            label="ID token Google (développement uniquement)"
            htmlFor="dev-token"
            help="Collez un ID token Google valide — jamais à exposer ainsi en dehors du développement."
          >
            <input id="dev-token" onChange={(e) => setDevToken(e.target.value)} />
          </FormField>
        </div>
      ) : (
        <div ref={buttonRef} />
      )}
    </main>
  );
}

export default App;
