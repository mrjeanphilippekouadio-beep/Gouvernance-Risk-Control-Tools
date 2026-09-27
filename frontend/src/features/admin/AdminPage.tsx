import { useState } from "react";
import { RolesAdmin } from "./RolesAdmin";
import { FeedbackAdmin } from "./FeedbackAdmin";
import { Tabs } from "../../design-system";

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
      <Tabs
        items={[
          { value: "roles", label: "Rôles" },
          { value: "feedback", label: "Feedback" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "roles" ? <RolesAdmin token={token} /> : <FeedbackAdmin token={token} />}
    </div>
  );
}
