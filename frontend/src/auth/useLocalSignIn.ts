import { useState } from "react";

interface UseLocalSignInResult {
  token: string | null;
  error: string | null;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  signIn: () => Promise<void>;
  signOut: () => void;
  loading: boolean;
}

const API_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "");

export function useLocalSignIn(defaultEmail: string): UseLocalSignInResult {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(): Promise<void> {
    if (!API_BASE_URL) {
      setError("VITE_API_BASE_URL is not configured");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError("Identifiants invalides");
        return;
      }
      const data = (await response.json()) as { accessToken?: string };
      if (!data.accessToken) {
        setError("Réponse d'authentification invalide");
        return;
      }
      setToken(data.accessToken);
      setPassword("");
    } catch {
      setError("Service d'authentification indisponible");
    } finally {
      setLoading(false);
    }
  }

  function signOut(): void {
    setToken(null);
    setPassword("");
  }

  return { token, error, email, setEmail, password, setPassword, signIn, signOut, loading };
}
