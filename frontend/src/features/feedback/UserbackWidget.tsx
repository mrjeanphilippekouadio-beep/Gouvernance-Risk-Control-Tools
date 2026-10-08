import { useEffect } from "react";

interface UserbackWidgetProps {
  userId?: string;
  userName?: string;
}

interface UserbackGlobal {
  access_token?: string;
  user_data?: {
    id: string;
    info?: {
      name?: string;
      email?: string;
    };
  };
  destroy?: () => void;
}

declare global {
  interface Window {
    Userback?: UserbackGlobal;
  }
}

const USERBACK_ENABLED = (import.meta.env["VITE_USERBACK_ENABLED"] as string | undefined) === "true";
const USERBACK_ACCESS_TOKEN = (import.meta.env["VITE_USERBACK_ACCESS_TOKEN"] as string | undefined) ?? "";
const USERBACK_SCRIPT_ID = "userback-widget-script";

export function UserbackWidget({ userId, userName }: UserbackWidgetProps) {
  useEffect(() => {
    if (!USERBACK_ENABLED || !USERBACK_ACCESS_TOKEN) return;

    const userData = userId
      ? {
          id: userId,
          info: {
            name: userName || undefined,
            email: userId.includes("@") ? userId : undefined,
          },
        }
      : undefined;

    window.Userback = window.Userback || {};
    window.Userback.access_token = USERBACK_ACCESS_TOKEN;
    if (userData) window.Userback.user_data = userData;

    if (document.getElementById(USERBACK_SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = USERBACK_SCRIPT_ID;
    script.async = true;
    script.src = "https://static.userback.io/widget/v1.js";
    (document.head || document.body).appendChild(script);
  }, [userId, userName]);

  return null;
}
