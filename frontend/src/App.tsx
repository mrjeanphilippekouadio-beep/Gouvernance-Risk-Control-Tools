import { useState } from "react";
import { RisksPage } from "./features/risks/RisksPage";
import "./App.css";

/**
 * TODO(auth): replace this dev-only token box with real Google Identity
 * Services sign-in (see backend GoogleIdentityProvider). Until then, paste
 * a valid Google ID token here to exercise the API against a local
 * backend — never ship this input as-is.
 */
function App() {
  const [token, setToken] = useState("");

  return (
    <main>
      <h1>GRC Tools</h1>

      {!token ? (
        <div>
          <p>
            Dev only — collez un ID token Google valide pour tester l'API
            (l'écran de connexion réel n'est pas encore branché).
          </p>
          <input
            placeholder="Google ID token"
            onChange={(e) => setToken(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
      ) : (
        <RisksPage token={token} />
      )}
    </main>
  );
}

export default App;
