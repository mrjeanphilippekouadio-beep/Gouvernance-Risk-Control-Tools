import { useEffect, useState } from "react";
import { raciApi, type RaciAssignment, type RaciEntityType, type RaciRole } from "../api/raci";
import { usersApi, type UserSummary } from "../api/users";
import { ApiError } from "../api/client";
import { Button, Card, FormField, MessageBanner, StatusBadge } from "@djamo/design-system";
import "./RaciPanel.css";

interface RaciPanelProps {
  token: string;
  entityType: RaciEntityType;
  entityId: string;
}

const ROLE_ORDER: RaciRole[] = ["R", "A", "C", "I"];
const ROLE_LABELS: Record<RaciRole, string> = {
  R: "Réalisateur (R)",
  A: "Accountable (A)",
  C: "Consulté (C)",
  I: "Informé (I)",
};
const VISIBLE_MAX = 4;

/**
 * Generic RACI panel for any entity Lot 1 covers (Risk today; Control and
 * ActionPlan reuse it once those screens exist — DESIGN_NOTES.md keeps
 * domain components here when they're meant to be shared). No permission
 * probe up front: the backend is the only source of truth on raci.assign/
 * raci.revoke (ADR-001), so this reacts to a 403 by switching to
 * read-only instead of guessing beforehand.
 */
export function RaciPanel({ token, entityType, entityId }: RaciPanelProps) {
  const [assignments, setAssignments] = useState<RaciAssignment[]>([]);
  // null = no user directory available (no user.read permission, or the
  // call failed) — falls back to a raw user id input below.
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [role, setRole] = useState<RaciRole>("R");
  const [userId, setUserId] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setAssignments(await raciApi.list(token, entityType, entityId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setReadOnly(true);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    usersApi
      .list(token)
      .then(setUsers)
      .catch(() => setUsers(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, entityType, entityId]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setError(null);
    try {
      await raciApi.assign(token, entityType, entityId, userId.trim(), role);
      setUserId("");
      await refresh();
    } catch (err) {
      // Covers SEC-016: backend rejects self R+A with a ForbiddenError
      // (403) whose message is shown verbatim below, never reworded here.
      if (err instanceof ApiError && err.status === 403) setReadOnly(true);
      setError(describeError(err));
    }
  }

  async function handleRevoke(assignmentId: string) {
    setError(null);
    try {
      await raciApi.revoke(token, entityType, entityId, assignmentId);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setReadOnly(true);
      setError(describeError(err));
    }
  }

  return (
    <Card className="raci-panel">
      <h3>RACI</h3>
      {error && <MessageBanner tone="danger">{error}</MessageBanner>}
      {readOnly && (
        <MessageBanner tone="info">Lecture seule — droits insuffisants pour modifier le RACI.</MessageBanner>
      )}

      {loading ? (
        <p>Chargement…</p>
      ) : (
        ROLE_ORDER.map((r) => {
          const people = assignments.filter((a) => a.role === r);
          const visible = people.slice(0, VISIBLE_MAX);
          const overflow = people.length - visible.length;
          return (
            <div key={r} className="raci-group">
              <div className="raci-group-label">{ROLE_LABELS[r]}</div>
              <div className="raci-chips">
                {visible.map((a) => (
                  <span key={a.id} className="raci-chip" title={a.userId}>
                    {r === "A" ? (
                      <StatusBadge label={a.userId} tone="info" />
                    ) : (
                      <span className="raci-chip-plain">{a.userId}</span>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="raci-chip-remove"
                        aria-label={`Retirer ${a.userId} (${ROLE_LABELS[r]})`}
                        onClick={() => handleRevoke(a.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {overflow > 0 && (
                  <span
                    className="raci-chip raci-chip-more"
                    title={people
                      .slice(VISIBLE_MAX)
                      .map((a) => a.userId)
                      .join(", ")}
                  >
                    +{overflow}
                  </span>
                )}
                {people.length === 0 && <span className="raci-empty">Aucune personne assignée.</span>}
              </div>
            </div>
          );
        })
      )}

      {!readOnly && !loading && (
        <form onSubmit={handleAssign} className="raci-add-form">
          <FormField label="Rôle" htmlFor="raci-role">
            <select id="raci-role" value={role} onChange={(e) => setRole(e.target.value as RaciRole)}>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Personne" htmlFor="raci-user">
            {users ? (
              <select id="raci-user" value={userId} onChange={(e) => setUserId(e.target.value)} required>
                <option value="">Sélectionner…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.email})
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="raci-user"
                placeholder="ID utilisateur"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
              />
            )}
          </FormField>
          <Button type="submit" variant="primary">
            Ajouter
          </Button>
        </form>
      )}
    </Card>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}
