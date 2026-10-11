import { useEffect, useState } from "react";
import { Button, Modal } from "@djamo/design-system";
import { onPermissionDenied } from "../../api/client";
import { rolesApi } from "../../api/roles";

type State = { permission: string; names: string[] | null; failed: boolean };

/**
 * F-B8-06 / q48: shown when a write is refused for a missing permission.
 * Lists the people who can give the right back (names only, from the backend).
 * The names exception applies to this window only; the DECISION-011/q02
 * "sensitive permission" masking is not built in the frontend yet.
 */
export function PermissionDeniedDialog({ token }: { token: string }) {
  const [state, setState] = useState<State | null>(null);

  useEffect(
    () =>
      onPermissionDenied((permission) => {
        setState({ permission, names: null, failed: false });
        rolesApi
          .grantors(token, permission)
          .then((res) => setState((s) => (s?.permission === permission ? { ...s, names: res.grantors.map((g) => g.displayName) } : s)))
          .catch(() => setState((s) => (s?.permission === permission ? { ...s, failed: true } : s)));
      }),
    [token],
  );

  return (
    <Modal
      open={state !== null}
      onClose={() => setState(null)}
      title="Vous n’avez pas ce droit"
      busy={state !== null && state.names === null && !state.failed}
      actions={<Button variant="primary" onClick={() => setState(null)}>Fermer</Button>}
    >
      {state && (
        <div role="status">
          {state.failed ? (
            <p>La liste des personnes pouvant vous redonner ce droit n’a pas pu être chargée. Contactez l’administrateur de l’application.</p>
          ) : state.names === null ? (
            <p>Chargement…</p>
          ) : state.names.length === 0 ? (
            <p>Aucune personne ne peut vous redonner ce droit pour le moment. Contactez l’administrateur de l’application.</p>
          ) : (
            <>
              <p>Ces personnes peuvent vous redonner ce droit :</p>
              <ul>
                {state.names.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
