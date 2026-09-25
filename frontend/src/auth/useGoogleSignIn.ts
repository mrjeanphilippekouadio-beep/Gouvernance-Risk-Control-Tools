import { useEffect, useRef, useState } from "react";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity script")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity script"));
    document.head.appendChild(script);
  });
}

interface UseGoogleSignInResult {
  /** The Google ID token (JWT) — send as-is in `Authorization: Bearer`. */
  idToken: string | null;
  error: string | null;
  /** Attach to a container div; the Sign In button renders inside it. */
  buttonRef: React.RefObject<HTMLDivElement | null>;
  signOut: () => void;
}

/**
 * Wraps Google Identity Services. The ID token this produces is exactly
 * what backend's GoogleIdentityProvider.verifyToken expects — no token
 * exchange or session cookie in between (see ADR-001).
 */
export function useGoogleSignIn(clientId: string | undefined): UseGoogleSignInResult {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId) {
      setError("VITE_GOOGLE_CLIENT_ID is not configured");
      return;
    }

    let cancelled = false;

    loadGisScript()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => setIdToken(response.credential),
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  function signOut() {
    window.google?.accounts.id.disableAutoSelect();
    setIdToken(null);
  }

  return { idToken, error, buttonRef, signOut };
}
