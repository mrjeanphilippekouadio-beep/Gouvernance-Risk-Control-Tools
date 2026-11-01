import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, StatusBadge, type StatusTone } from "@djamo/design-system";
import {
  RISK_VISIBILITY_HELP,
  RISK_VISIBILITY_LABELS,
  risksApi,
  type RiskVisibility,
  type RiskVisibilityState,
} from "../../api/risks";
import { usersApi, type DirectoryEntry } from "../../api/users";
import { ApiError } from "../../api/client";

/**
 * Lot V1 (DECISION-102): visibility of a risk on screen. Presentation only: who sees a risk, who may change it, the
 * reason rule and the "not yourself" rule are all decided by the server; its answer is shown as is.
 */
const LEVELS: RiskVisibility[] = ["CLIENT", "PERIMETRE", "NOMINATIF"];
const TONES: Record<RiskVisibility, StatusTone> = { CLIENT: "neutral", PERIMETRE: "info", NOMINATIF: "warning" };

export function RiskVisibilityBadge({ visibility }: Readonly<{ visibility?: RiskVisibility }>) {
  const v = visibility ?? "CLIENT";
  return <StatusBadge label={RISK_VISIBILITY_LABELS[v]} tone={TONES[v]} />;
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  return err instanceof Error ? err.message : "Une erreur inattendue est survenue.";
}

export function VisibilityLevelField({ id, value, onChange }: Readonly<{ id: string; value: RiskVisibility; onChange: (v: RiskVisibility) => void }>) {
  return <FormField label="Visibilité" htmlFor={id} help={RISK_VISIBILITY_HELP[value]}>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as RiskVisibility)}>
      {LEVELS.map((l) => <option key={l} value={l}>{RISK_VISIBILITY_LABELS[l]}</option>)}
    </select>
  </FormField>;
}

/** A person chosen in the search: id and the name the server returned. */
export interface NamedPerson { id: string; displayName: string }

/**
 * People to add, found by a name search on the server (q205: 2 characters minimum, 20 results). Never a typed id: the
 * server validates each person again (active account of the tenant).
 */
export function AccessPeopleField({ id, token, value, onChange, label = "Personnes à ajouter" }: Readonly<{
  id: string;
  token: string;
  value: NamedPerson[];
  onChange: (people: NamedPerson[]) => void;
  label?: string;
}>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryEntry[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      usersApi.searchDirectory(token, q)
        .then((r) => { if (live) { setResults(r); setSearchError(null); } })
        .catch((err: unknown) => { if (live) { setResults([]); setSearchError(describe(err)); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [token, query]);

  const shown = query.trim().length < 2 ? [] : results.filter((r) => !value.some((v) => v.id === r.id));
  return <div>
    <FormField label={label} htmlFor={id} help="Tapez au moins 2 caractères du nom (20 résultats au plus).">
      <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
    </FormField>
    {searchError && <MessageBanner tone="danger">{searchError}</MessageBanner>}
    {shown.length > 0 && <ul className="risk-access-results" aria-label="Résultats de la recherche">
      {shown.map((r) => <li key={r.id}>
        {r.displayName}{" "}
        <Button type="button" size="sm" variant="secondary" onClick={() => { onChange([...value, { id: r.id, displayName: r.displayName }]); setQuery(""); }}>Ajouter</Button>
      </li>)}
    </ul>}
    {query.trim().length >= 2 && shown.length === 0 && !searchError && <p className="risk-access-empty">Aucun compte trouvé.</p>}
    {value.length > 0 && <ul className="risk-access-list">
      {value.map((p) => <li key={p.id}>
        {p.displayName}{" "}
        <Button type="button" size="sm" variant="secondary" onClick={() => onChange(value.filter((x) => x.id !== p.id))}>Retirer</Button>
      </li>)}
    </ul>}
  </div>;
}

/** Fiche risque: current level and list, and the change form (level, people to add or revoke, mandatory reason). */
export function RiskVisibilityCard({ token, riskId, onChanged }: Readonly<{ token: string; riskId: string; onChanged: (v: RiskVisibility) => void }>) {
  const [state, setState] = useState<RiskVisibilityState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<RiskVisibility>("CLIENT");
  const [add, setAdd] = useState<NamedPerson[]>([]);
  const [revoke, setRevoke] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState(null); setLoadError(null);
    risksApi.getVisibility(token, riskId)
      .then((s) => { if (live) setState(s); })
      .catch((err: unknown) => { if (live) setLoadError(describe(err)); });
    return () => { live = false; };
  }, [token, riskId]);

  function startEdit() {
    if (!state) return;
    setLevel(state.visibility); setAdd([]); setRevoke([]); setReason(""); setError(null); setEditing(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const next = await risksApi.setVisibility(token, riskId, {
        visibility: level,
        ...(level === "CLIENT" ? {} : { addUserIds: add.map((p) => p.id), revokeUserIds: revoke }),
        reason: reason.trim(),
      });
      setState(next); setEditing(false); onChanged(next.visibility);
    } catch (err) {
      setError(describe(err));
    } finally {
      setSaving(false);
    }
  }

  const nameOf = (u: string) => state?.accessUsers?.find((a) => a.id === u)?.displayName ?? "Compte non trouvé";
  const names = (ids: string[]) => ids.map(nameOf).join(", ");

  return <Card header={<h2>Visibilité</h2>}>
    {loadError && <MessageBanner tone="danger">{loadError}</MessageBanner>}
    {state && <dl className="risk-sheet-facts">
      <div><dt>Niveau</dt><dd><RiskVisibilityBadge visibility={state.visibility} /></dd></div>
      <div><dt>Personnes nommées</dt><dd>{state.accessUserIds.length ? names(state.accessUserIds) : "Aucune"}</dd></div>
    </dl>}
    {state && !editing && <Button variant="secondary" size="sm" onClick={startEdit}>Modifier la visibilité</Button>}
    {state && editing && <form className="core-form" onSubmit={submit}>
      <VisibilityLevelField id="risk-visibility-level" value={level} onChange={setLevel} />
      {level === "CLIENT" && state.accessUserIds.length > 0 && (
        <MessageBanner tone="warning">Revenir à « {RISK_VISIBILITY_LABELS.CLIENT} » retire toute la liste des personnes nommées.</MessageBanner>
      )}
      {level !== "CLIENT" && <>
        <AccessPeopleField id="risk-visibility-add" token={token} value={add} onChange={setAdd} />
        {state.accessUserIds.length > 0 && <fieldset className="risk-access-revoke">
          <legend>Retirer de la liste</legend>
          {state.accessUserIds.map((u) => <label key={u}>
            <input type="checkbox" checked={revoke.includes(u)}
              onChange={(e) => setRevoke(e.target.checked ? [...revoke, u] : revoke.filter((x) => x !== u))} />
            {" "}{nameOf(u)}
          </label>)}
        </fieldset>}
      </>}
      <FormField label="Motif *" htmlFor="risk-visibility-reason">
        <textarea id="risk-visibility-reason" value={reason} maxLength={500} required onChange={(e) => setReason(e.target.value)} />
      </FormField>
      {error && <MessageBanner tone="danger">{error}</MessageBanner>}
      <div className="core-form-actions">
        <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Annuler</Button>
        <Button type="submit" variant="primary" disabled={saving || !reason.trim()} aria-busy={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
      </div>
    </form>}
  </Card>;
}
