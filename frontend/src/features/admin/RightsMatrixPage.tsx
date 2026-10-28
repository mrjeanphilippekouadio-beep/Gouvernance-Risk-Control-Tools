import { useEffect, useMemo, useState } from "react";
import { Card, MessageBanner, SegmentedControl, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { permissionsApi } from "../../api/permissions";
import rightLabels from "../../api/rightLabels.json";
import { FIXED_GROUP_LABELS, rolesApi, type EffectivePermission, type PermissionSource, type Role } from "../../api/roles";
import { usersApi, type DirectoryEntry } from "../../api/users";
import { usePermissions } from "../../auth/usePermissions";
import { AccountPicker } from "../../design-system";
import { describeError } from "../indicators/shared";
import "../core/CorePages.css";

type Tab = "matrix" | "user";
/** Display grouping only: the part of the identifier before the first dot. */
const domainOf = (permission: string) => permission.split(".")[0] ?? permission;
/** Label from the PO-validated rights catalogue (DECISION-072); the identifier alone when the catalogue lacks it. */
const LABELS: Record<string, string> = rightLabels;
function RightName({ code }: Readonly<{ code: string }>) {
  const label = LABELS[code];
  return label ? <>{label}<br /><small><code>{code}</code></small></> : <code>{code}</code>;
}
const roleLabel = (r: Role) => (r.systemGroup ? `${r.name} (groupe fixe ${FIXED_GROUP_LABELS[r.systemGroup]})` : r.name);

function sourceLabel(s: PermissionSource): string {
  if (s.kind === "BASE") return "Socle de tout compte";
  if (s.kind === "DIRECT") return "Attribution directe (ancienne)";
  return s.systemGroup ? `Groupe fixe ${FIXED_GROUP_LABELS[s.systemGroup]}` : `Rôle ${s.roleName}`;
}

/**
 * Lot F7-S3: read-only rights matrix (roles × permissions) and one account's effective permissions with their origin,
 * as the server returns them. Changing a right stays in « IAM · Rôles » and in the governance settings.
 */
export function RightsMatrixPage({ token }: Readonly<{ token: string }>) {
  const { can, loaded } = usePermissions(token);
  const [tab, setTab] = useState<Tab>("matrix");
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [decisionRights, setDecisionRights] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([rolesApi.list(token), permissionsApi.list(token), rolesApi.governanceRights(token)])
      .then(([r, p, g]) => {
        if (!live) return;
        setRoles(r); setCatalog(p); setDecisionRights(new Set(g.map((x) => x.permission)));
      })
      .catch((err) => { if (live) setError(describeError(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  const domains = useMemo(() => [...new Set(catalog.map(domainOf))].sort((a, b) => a.localeCompare(b)), [catalog]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((p) => (!domain || domainOf(p) === domain) && (!q || p.toLowerCase().includes(q) || (LABELS[p] ?? "").toLowerCase().includes(q)))
      .sort((a, b) => a.localeCompare(b));
  }, [catalog, domain, search]);

  const columns: TableColumn<string>[] = [
    {
      key: "permission", header: "Droit", render: (p) => <>
        <RightName code={p} />{decisionRights.has(p) && <> <StatusBadge label="Droit de décision" tone="warning" /></>}
      </>,
    },
    ...roles.map((r): TableColumn<string> => ({
      key: r.id, header: roleLabel(r),
      render: (p) => (r.permissions.includes(p) ? <span aria-label="accordé">✓</span> : <span aria-label="non accordé">·</span>),
    })),
  ];

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION</p>
        <h1>Matrice des droits</h1>
        <p className="core-page__subtitle">Lecture seule. Les groupes fixes et les quatre droits de décision de gouvernance sont signalés ; pour modifier un rôle, utiliser « IAM · Rôles » ou les réglages de gouvernance.</p>
      </div>
    </div>
    <SegmentedControl<Tab> ariaLabel="Vue" value={tab} onChange={setTab}
      options={[{ value: "matrix", label: "Matrice des rôles" }, { value: "user", label: "Droits d'un compte" }]} />
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {tab === "matrix" && <Card>
      <p>
        <label className="core-filter">Domaine{" "}
          <select value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">Tous</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>{" "}
        <label className="core-filter">Rechercher un droit{" "}
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </p>
      <Table columns={columns} rows={rows} rowKey={(p) => p} loading={loading} density="compact" striped
        caption="Matrice des droits par rôle" emptyMessage="Aucun droit ne correspond." />
    </Card>}
    {tab === "user" && loaded && <UserRights token={token} canDirectory={can("user.read") || can("process.responsibility.assign") || can("designation.manage") || can("audit.mission.create")} decisionRights={decisionRights} />}
  </section>;
}

function UserRights({ token, canDirectory, decisionRights }: Readonly<{ token: string; canDirectory: boolean; decisionRights: Set<string> }>) {
  const [accounts, setAccounts] = useState<DirectoryEntry[]>([]);
  const [userId, setUserId] = useState("");
  const [held, setHeld] = useState<Role[]>([]);
  const [effective, setEffective] = useState<EffectivePermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canDirectory) return;
    let live = true;
    usersApi.directory(token).then((list) => { if (live) setAccounts(list); }).catch((err) => { if (live) setError(describeError(err)); });
    return () => { live = false; };
  }, [token, canDirectory]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    Promise.all([rolesApi.forUser(token, userId), rolesApi.permissionSources(token, userId)])
      .then(([r, e]) => { if (live) { setHeld(r); setEffective([...e].sort((a, b) => a.permission.localeCompare(b.permission))); } })
      .catch((err) => { if (live) setError(describeError(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, userId]);

  const columns: TableColumn<EffectivePermission>[] = [
    { key: "permission", header: "Droit", render: (e) => <>
      <RightName code={e.permission} />{decisionRights.has(e.permission) && <> <StatusBadge label="Droit de décision" tone="warning" /></>}
    </> },
    { key: "sources", header: "Origine", render: (e) => e.sources.map(sourceLabel).join(" · ") },
  ];

  return <Card>
    {!canDirectory && <MessageBanner tone="info">Votre compte ne peut pas consulter l'annuaire des comptes : la liste des comptes n'est pas disponible.</MessageBanner>}
    {canDirectory && <AccountPicker id="rights-user" label="Compte" value={userId} onChange={(id) => { setHeld([]); setEffective([]); setError(null); setLoading(Boolean(id)); setUserId(id); }} accounts={accounts} allowEmpty={false} />}
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {userId && !error && <>
      <p><strong>Rôles détenus :</strong> {held.length ? held.map(roleLabel).join(", ") : "aucun"}</p>
      <Table columns={columns} rows={effective} rowKey={(e) => e.permission} loading={loading} density="compact" striped
        caption="Droits effectifs du compte et leur origine" emptyMessage="Aucun droit effectif." />
    </>}
  </Card>;
}
