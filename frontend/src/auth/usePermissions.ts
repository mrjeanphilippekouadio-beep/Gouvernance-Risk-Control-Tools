import { useEffect, useState } from "react";
import { usersApi } from "../api/users";

/**
 * Lot F4: the caller's own permissions, from GET /users/me/permissions. `can(p)` only hides an action; the server
 * still decides every request. While loading or if the call fails, `can` answers true: the screen then falls back
 * to the server's 403 (PermissionDeniedDialog), as before this endpoint existed.
 */
export function usePermissions(token: string): { can: (permission: string) => boolean; loaded: boolean } {
  const [permissions, setPermissions] = useState<Set<string> | null>(null);

  useEffect(() => {
    let live = true;
    usersApi.myPermissions(token)
      .then((list) => { if (live) setPermissions(new Set(list)); })
      .catch(() => { if (live) setPermissions(null); });
    return () => { live = false; };
  }, [token]);

  return { can: (permission) => permissions === null || permissions.has(permission), loaded: permissions !== null };
}
