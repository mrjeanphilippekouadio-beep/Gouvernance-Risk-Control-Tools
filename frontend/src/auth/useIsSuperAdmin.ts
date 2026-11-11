import { useEffect, useState } from "react";
import { usersApi } from "../api/users";

/**
 * q260: whether the caller is a platform super-administrator, as GET /users/me reports it (decided server-side from a fixed
 * e-mail list). Display only: it shows the Clients entry; the server refuses every /tenants call from anyone else.
 * Unlike `usePermissions`, it fails CLOSED: false while loading or on error.
 */
export function useIsSuperAdmin(token: string): boolean {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    setIsSuperAdmin(false);
    if (token) {
      usersApi.me(token)
        .then((me) => { if (live) setIsSuperAdmin(me.isSuperAdmin === true); })
        .catch(() => { if (live) setIsSuperAdmin(false); });
    }
    return () => { live = false; };
  }, [token]);
  return isSuperAdmin;
}
