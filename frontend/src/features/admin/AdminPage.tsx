import { useState } from "react";
import { RolesAdmin } from "./RolesAdmin";
import { FeedbackAdmin } from "./FeedbackAdmin";

interface AdminPageProps {
  token: string;
}

type Tab = "roles" | "feedback";

/**
 * No permission check here — the backend is the real gate (RoleService/
 * FeedbackService requirePermission calls). A user without rights just
 * sees 403s from the tables below, same philosophy as RisksPage.
 */
export function AdminPage({ token }: AdminPageProps) {
  const [tab, setTab] = useState<Tab>("roles");

  return (
    <div>
      <nav className="admin-tabs">
        <button type="button" disabled={tab === "roles"} onClick={() => setTab("roles")}>
          Rôles
        </button>
        <button type="button" disabled={tab === "feedback"} onClick={() => setTab("feedback")}>
          Feedback
        </button>
      </nav>
      {tab === "roles" ? <RolesAdmin token={token} /> : <FeedbackAdmin token={token} />}
    </div>
  );
}
