import { FormField } from "@djamo/design-system";
import type { DirectoryEntry } from "../api/users";

/**
 * Account selector of the designation screens: lists only the accounts the server returned (GET /users/directory).
 * A current value missing from the list (suspended, other scope) stays shown as such, never invented.
 */
export function AccountPicker({ id, label, value, onChange, accounts, help, allowEmpty = true }: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  accounts: DirectoryEntry[];
  help?: string;
  allowEmpty?: boolean;
}>) {
  return <FormField label={label} htmlFor={id} help={help}>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowEmpty ? "Aucun" : "Sélectionner…"}</option>
      {value && !accounts.some((a) => a.id === value) && <option value={value}>Compte actuel (non listé : inactif ou hors annuaire)</option>}
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
    </select>
  </FormField>;
}

/** Name of an account id from the directory, or a neutral label: never a guessed name. */
export function accountName(accounts: DirectoryEntry[], id: string | null): string {
  if (!id) return "—";
  return accounts.find((a) => a.id === id)?.displayName ?? "Compte non listé";
}
