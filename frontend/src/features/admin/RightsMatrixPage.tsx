import { useEffect, useMemo, useState } from "react";
import { Card, MessageBanner, SegmentedControl, StatusBadge, Table, type TableColumn } from "@djamo/design-system";
import { permissionsApi } from "../../api/permissions";
import rightLabels from "../../api/rightLabels.json";
import { DEFENSE_LINE_LABELS, FIXED_GROUP_LABELS, rolesApi, type EffectivePermission, type MatrixAccount, type MatrixRole, type PermissionSource, type Role } from "../../api/roles";
import { usePermissions } from "../../auth/usePermissions";
import { AccountPicker } from "../../design-system";
import { SensitiveViewsCard } from "./SensitiveViewsCard";
import { describeError, isForbidden } from "../indicators/shared";
import "../core/CorePages.css";

type Tab = "matrix" | "user" | "views";
/** Display grouping only: the part of the identifier before the first dot. */
const domainOf = (permission: string) => permission.split(".")[0] ?? permission;
/** Label from the PO-validated rights catalogue (DECISION-072); the identifier alone when the catalogue lacks it. */
const LABELS: Record<string, string> = rightLabels;
function RightName({ code }: Readonly<{ code: string }>) {
  const label = LABELS[code];
  return label ? <>{label}<br /><small><code>{code}</code></small></> : <code>{code}</code>;
}
/** QA-F7S3-02: a refusal in French, never the raw server key. */
const describeLoadError = (err: unknown) =>
  isForbidden(err) ? "Votre compte n'a pas le droit « Voir les rôles » : la matrice des droits ne peut pas s'afficher." : describeError(err);
const roleLabel = (r: Pick<Role, "name" | "systemGroup">) => (r.systemGroup ? `${r.name} (groupe fixe ${FIXED_GROUP_LABELS[r.systemGroup]})` : r.name);
/** q188/q189: the line of defense comes from the server; the column header carries it as text. */
const matrixHeader = (r: MatrixRole) => `${roleLabel(r)} · ${DEFENSE_LINE_LABELS[r.line]}`;

function sourceLabel(s: PermissionSource): string {
  if (s.kind === "BASE") return "Socle de tout compte";
  if (s.kind === "DIRECT") return "Attribution directe (ancienne)";
  if (s.kind === "GRANT") return "Vue élargie confirmée";
  return s.systemGroup ? `Groupe fixe ${FIXED_GROUP_LABELS[s.systemGroup]}` : `Rôle ${s.roleName}`;
}

/**
 * Lot F7-S3: read-only rights matrix (roles × permissions) and one account's effective permissions with their origin,
 * as the server returns them. Changing a right stays in « IAM · Rôles » and in the governance settings.
 */
export function RightsMatrixPage({ token }: Readonly<{ token: string }>) {
  const { can, loaded } = usePermissions(token);
  const canRequestView = can("role.assign");
  const canDecideView = can("rolegroup.audit.validate");
  // QA-RL-03: a confirmer (Committee / Audit) without role.read sees the widened-view requests only.
  const canRead = can("role.read");
  const [chosenTab, setTab] = useState<Tab>("matrix");
  const tab: Tab = canRead ? chosenTab : "views";
  const [roles, setRoles] = useState<MatrixRole[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [decisionRights, setDecisionRights] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loaded || !canRead) return;
    let live = true;
    Promise.all([rolesApi.matrix(token), permissionsApi.list(token), rolesApi.governanceRights(token)])
      .then(([r, p, g]) => {
        if (!live) return;
        setRoles(r); setCatalog(p); setDecisionRights(new Set(g.map((x) => x.permission)));
      })
      .catch((err) => { if (live) setError(describeLoadError(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token, loaded, canRead]);

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
      key: r.id, header: matrixHeader(r),
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
    {canRead && <SegmentedControl<Tab> ariaLabel="Vue" value={tab} onChange={setTab}
      options={[{ value: "matrix", label: "Matrice des rôles" }, { value: "user", label: "Droits d'un compte" },
        ...(canRequestView || canDecideView ? [{ value: "views" as Tab, label: "Vue élargie du Risk Manager" }] : [])]} />}
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
    {tab === "user" && loaded && <UserRights token={token} decisionRights={decisionRights} />}
    {tab === "views" && loaded && (canRequestView || canDecideView) && <SensitiveViewsCard token={token} canRequest={canRequestView} canDecide={canDecideView} />}
  </section>;
}

function UserRights({ token, decisionRights }: Readonly<{ token: string; decisionRights: Set<string> }>) {
  // q188/q189: the accounts this reader may open (role.read), each with its line, cut by the server.
  const [accounts, setAccounts] = useState<MatrixAccount[]>([]);
  const [userId, setUserId] = useState("");
  const [held, setHeld] = useState<Role[]>([]);
  const [effective, setEffective] = useState<EffectivePermission[]>([]);
  const [suspended, setSuspended] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    rolesApi.accounts(token).then((list) => { if (live) setAccounts(list); }).catch((err) => { if (live) setError(describeLoadError(err)); });
    return () => { live = false; };
  }, [token]);
  const line = accounts.find((a) => a.id === userId)?.line;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    Promise.all([rolesApi.forUser(token, userId), rolesApi.permissionSources(token, userId)])
      .then(([r, e]) => { if (live) { setHeld(r); setSuspended(e.suspended); setEffective([...e.permissions].sort((a, b) => a.permission.localeCompare(b.permission))); } })
      .catch((err) => { if (live) setError(describeLoadError(err)); })
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
    <AccountPicker id="rights-user" label="Compte" value={userId} onChange={(id) => { setHeld([]); setEffective([]); setSuspended(false); setError(null); setLoading(Boolean(id)); setUserId(id); }} accounts={accounts} allowEmpty={false} />
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {userId && !error && <>
      {line && <p><StatusBadge label={DEFENSE_LINE_LABELS[line]} tone="info" /></p>}
      {suspended && <MessageBanner tone="warning" title="Compte suspendu">Un compte suspendu ne détient aucun droit tant qu'il n'est pas réactivé.</MessageBanner>}
      <p><strong>Rôles détenus :</strong> {held.length ? held.map(roleLabel).join(", ") : "aucun"}</p>
      <Table columns={columns} rows={effective} rowKey={(e) => e.permission} loading={loading} density="compact" striped
        caption="Droits effectifs du compte et leur origine" emptyMessage="Aucun droit effectif." />
    </>}
  </Card>;
}
