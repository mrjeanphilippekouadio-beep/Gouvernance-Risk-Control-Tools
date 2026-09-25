import { useState } from "react";
import { RisksPage } from "./features/risks/RisksPage";
import { useGoogleSignIn } from "./auth/useGoogleSignIn";
import "./App.css";

const GOOGLE_CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;

function App() {
  const { idToken, error, buttonRef, signOut } = useGoogleSignIn(GOOGLE_CLIENT_ID);
  const [devToken, setDevToken] = useState("");

  const token = idToken ?? devToken;

  if (token) {
    return (
      <main>
        <h1>GRC Tools</h1>
        <button type="button" onClick={idToken ? signOut : () => setDevToken("")}>
          Déconnexion
        </button>
        <RisksPage token={token} />
      </main>
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
          <p>
            En attendant, pour tester en local, collez un ID token Google
            valide (jamais à exposer ainsi en dehors du développement) :
          </p>
          <input
            placeholder="Google ID token"
            onChange={(e) => setDevToken(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
      ) : (
        <div ref={buttonRef} />
      )}
    </main>
  );
}

export default App;
