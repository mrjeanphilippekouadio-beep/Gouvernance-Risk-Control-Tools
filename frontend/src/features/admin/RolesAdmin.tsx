import { useEffect, useState } from "react";
import { rolesApi, type Role } from "../../api/roles";
import { permissionsApi } from "../../api/permissions";
import { ApiError } from "../../api/client";

interface RolesAdminProps {
  token: string;
}

/**
 * Minimal RBAC console (ACT-110 to ACT-118): create roles, assign/revoke
 * them by user id. No user directory endpoint exists yet, so
 * assign/revoke take a raw user id rather than picking from a list.
 */
export function RolesAdmin({ token }: RolesAdminProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const [assignUserId, setAssignUserId] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [roleList, permissionList] = await Promise.all([rolesApi.list(token), permissionsApi.list(token)]);
      setRoles(roleList);
      setAllPermissions(permissionList);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function togglePermission(permission: string) {
    setSelectedPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rolesApi.create(token, { name, description: description || undefined, permissions: selectedPermissions });
      setName("");
      setDescription("");
      setSelectedPermissions([]);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDisable(id: string) {
    setError(null);
    try {
      await rolesApi.disable(token, id);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleAssign(id: string) {
    const userId = assignUserId[id]?.trim();
    if (!userId) return;
    setError(null);
    try {
      await rolesApi.assign(token, id, userId);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRevoke(id: string) {
    const userId = assignUserId[id]?.trim();
    if (!userId) return;
    setError(null);
    try {
      await rolesApi.revoke(token, id, userId);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <section>
      <h2>Rôles (RBAC)</h2>

      <form onSubmit={handleCreate} className="admin-form">
        <input placeholder="Nom du rôle" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          placeholder="Description (optionnel)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <fieldset className="admin-permissions">
          <legend>Permissions</legend>
          {allPermissions.map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={selectedPermissions.includes(p)}
                onChange={() => togglePermission(p)}
              />
              {p}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={!name.trim() || selectedPermissions.length === 0}>
          Créer le rôle
        </button>
      </form>

      {error && <p role="alert">{error}</p>}

      {loading ? (
        <p>Chargement…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Permissions</th>
              <th>Statut</th>
              <th>Assigner / révoquer (user id)</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>
                  {role.name}
                  {role.description && <div className="admin-muted">{role.description}</div>}
                </td>
                <td>{role.permissions.join(", ")}</td>
                <td>
                  {role.deletedAt ? "Désactivé" : "Actif"}
                  {!role.deletedAt && (
                    <button type="button" onClick={() => handleDisable(role.id)}>
                      Désactiver
                    </button>
                  )}
                </td>
                <td>
                  <input
                    placeholder="user id"
                    value={assignUserId[role.id] ?? ""}
                    onChange={(e) => setAssignUserId((prev) => ({ ...prev, [role.id]: e.target.value }))}
                  />
                  <button type="button" onClick={() => handleAssign(role.id)}>
                    Assigner
                  </button>
                  <button type="button" onClick={() => handleRevoke(role.id)}>
                    Révoquer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}
