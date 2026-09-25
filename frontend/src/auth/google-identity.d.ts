// Minimal ambient types for the Google Identity Services script
// (https://accounts.google.com/gsi/client), loaded at runtime — there is
// no official npm package for it.
export {};

interface GoogleCredentialResponse {
  credential: string; // the ID token (JWT) — this is what the backend verifies
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
}

interface GoogleButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfiguration) => void;
          renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
          disableAutoSelect: () => void;
          prompt: () => void;
        };
      };
    };
  }
}
