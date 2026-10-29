import { useState } from "react";

interface UseLocalSignInResult {
  token: string | null;
  error: string | null;
  email: string;
  setEmail: (email: string) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  loading: boolean;
}

const API_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "");

export function useLocalSignIn(defaultEmail: string): UseLocalSignInResult {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(emailInput: string, passwordInput: string): Promise<void> {
    const normalizedEmail = emailInput.trim();
    setEmail(normalizedEmail);
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
        body: JSON.stringify({ email: normalizedEmail, password: passwordInput }),
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
    } catch {
      setError("Service d'authentification indisponible");
    } finally {
      setLoading(false);
    }
  }

  function signOut(): void {
    setToken(null);
  }

  return { token, error, email, setEmail, signIn, signOut, loading };
}
