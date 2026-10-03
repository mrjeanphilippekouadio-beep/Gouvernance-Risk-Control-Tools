import { useState } from "react";
import { Button, FormField } from "@djamo/design-system";
import { RisksPage } from "./features/risks/RisksPage";
import { EvaluationPage } from "./features/evaluations/EvaluationPage";
import { RolesAdmin } from "./features/admin/RolesAdmin";
import { FeedbackAdmin } from "./features/admin/FeedbackAdmin";
import { FeedbackWidget } from "./features/feedback/FeedbackWidget";
import { CartographyPage } from "./features/cartography/CartographyPage";
import { AppetitePage } from "./features/appetite/AppetitePage";
import { RatingScalesPage } from "./features/scales/RatingScalesPage";
import { ControlsPage } from "./features/controls/ControlsPage";
import { ControlMonitoringPage } from "./features/controls/ControlMonitoringPage";
import { AuditFindingsPage } from "./features/audit/AuditFindingsPage";
import { ActionPlansPage } from "./features/actions/ActionPlansPage";
import { ContextRail } from "./design-system/ContextRail";
import { useGoogleSignIn } from "./auth/useGoogleSignIn";
import { useLocalSignIn } from "./auth/useLocalSignIn";
import { ErrorPage } from "./features/errors/ErrorPages";
import "./App.css";

const GOOGLE_CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;
const AUTH_PROVIDER = (import.meta.env["VITE_AUTH_PROVIDER"] as string | undefined) ?? "google";
const LOCAL_AUTH_EMAIL = (import.meta.env["VITE_LOCAL_AUTH_EMAIL"] as string | undefined) ?? "";

type View = "cartography" | "evaluation" | "risks" | "roles" | "feedback" | "placeholder" | "appetite" | "scales" | "controls" | "monitoring" | "findings" | "actions";
type NavItem = { id: View; label: string; icon: string; available?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Risques", items: [
    { id: "cartography", label: "Cartographie", icon: "grid", available: true },
    { id: "evaluation", label: "Évaluations", icon: "check", available: true },
    { id: "appetite", label: "Appétence", icon: "scale", available: true },
    { id: "scales", label: "Grilles de cotation", icon: "table", available: true },
    { id: "risks", label: "Registre", icon: "table", available: true },
    { id: "placeholder", label: "Dispositif de risque", icon: "shield" },
  ] },
  { label: "Contrôle interne", items: [
    { id: "controls", label: "Contrôles", icon: "check", available: true },
    { id: "monitoring", label: "Exécutions & efficacité", icon: "play", available: true },
    { id: "placeholder", label: "Plan de contrôle", icon: "panel" },
    { id: "placeholder", label: "Lignes de défense", icon: "shield" },
  ] },
  { label: "Indicateurs", items: [
    { id: "placeholder", label: "KRI", icon: "trend" },
    { id: "placeholder", label: "KPI", icon: "trend" },
    { id: "placeholder", label: "Dashboards", icon: "dashboard" },
  ] },
  { label: "Plans & revues", items: [
    { id: "actions", label: "Plans d'action", icon: "arrow", available: true },
    { id: "placeholder", label: "Cycles de revue", icon: "clock" },
  ] },
  { label: "Audit", items: [
    { id: "placeholder", label: "Missions", icon: "search" },
    { id: "findings", label: "Constats & recommandations", icon: "message", available: true },
  ] },
  { label: "Administration", items: [
    { id: "roles", label: "IAM · Rôles", icon: "user", available: true },
    { id: "feedback", label: "Feedback", icon: "message", available: true },
    { id: "placeholder", label: "Paramètres & référentiels", icon: "settings" },
  ] },
];

const PAGE_TITLES: Record<View, string> = {
  cartography: "Cartographie des risques",
  evaluation: "Évaluation des risques",
  risks: "Registre des risques",
  roles: "Rôles (RBAC)",
  feedback: "Feedback",
  placeholder: "Module en préparation",
  appetite: "Appétence au risque",
  scales: "Grilles de cotation",
  controls: "Contrôles",
  monitoring: "Exécutions & efficacité",
  findings: "Constats & recommandations",
  actions: "Plans d’action",
};

function App() {
  const { idToken, error, buttonRef, signOut } = useGoogleSignIn(AUTH_PROVIDER === "google" ? GOOGLE_CLIENT_ID : undefined);
  const localAuth = useLocalSignIn(LOCAL_AUTH_EMAIL);
  const [devToken, setDevToken] = useState("");
  const [view, setView] = useState<View>("cartography");
  const [evaluationRiskId, setEvaluationRiskId] = useState<string | undefined>();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const token = AUTH_PROVIDER === "local" ? localAuth.token : (idToken ?? devToken);
  const sessionIdentity = AUTH_PROVIDER === "local"
    ? formatIdentity(localAuth.email)
    : getGoogleIdentity(idToken ?? devToken);
  const errorPath = window.location.pathname;

  if (errorPath === "/400" || errorPath === "/error/400") return <ErrorPage code={400} />;
  if (errorPath === "/500" || errorPath === "/error/500") return <ErrorPage code={500} onRetry={() => window.location.reload()} />;

  if (!token) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand-mark">G</div>
          <p className="auth-eyebrow">GOUVERNANCE · RISQUES · CONTRÔLE</p>
          <h1>GRC Tools</h1>
          <p className="auth-description">Le dispositif de maîtrise des risques, au même endroit.</p>
          {AUTH_PROVIDER === "local" ? (
            <form
              className="auth-dev"
              onSubmit={(event) => {
                event.preventDefault();
                void localAuth.signIn();
              }}
            >
              {localAuth.error && <p role="alert">{localAuth.error}</p>}
              <FormField label="Adresse e-mail QA" htmlFor="local-email">
                <input id="local-email" type="email" value={localAuth.email} onChange={(event) => localAuth.setEmail(event.target.value)} autoComplete="username" />
              </FormField>
              <FormField label="Mot de passe QA" htmlFor="local-password">
                <input id="local-password" type="password" value={localAuth.password} onChange={(event) => localAuth.setPassword(event.target.value)} autoComplete="current-password" />
              </FormField>
              <Button type="submit" disabled={localAuth.loading}>
                {localAuth.loading ? "Connexion…" : "Se connecter"}
              </Button>
            </form>
          ) : error ? (
            <div className="auth-dev">
              <p role="alert">Connexion Google indisponible ({error}). Configurer VITE_GOOGLE_CLIENT_ID dans .env.local pour l'activer.</p>
              <FormField label="ID token Google (développement uniquement)" htmlFor="dev-token" help="Colle un ID token Google valide — ne pas exposer cette saisie hors développement.">
                <input id="dev-token" value={devToken} onChange={(event) => setDevToken(event.target.value)} autoComplete="off" />
              </FormField>
            </div>
          ) : <div ref={buttonRef} className="auth-google-button" />}
          <p className="auth-footnote">Accès réservé aux utilisateurs autorisés.</p>
        </div>
      </main>
    );
  }

  const go = (next: View) => {
    setView(next);
    setMobileNavOpen(false);
  };

  return (
    <div className="app-shell">
      <Sidebar view={view} setView={go} mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen} />
      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="mobile-menu-toggle"
            aria-label={mobileNavOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? "×" : "☰"}
          </button>
          <div className="topbar-title">
            <span className="topbar-kicker">ESPACE DE TRAVAIL / GRC</span>
            <strong>{PAGE_TITLES[view]}</strong>
          </div>
          <div className="topbar-actions">
            <button type="button" className="topbar-user" aria-label="Ouvrir les actions de session" aria-expanded={logoutOpen} onClick={() => setLogoutOpen((open) => !open)}>
              <span className="topbar-user-avatar">{getInitials(sessionIdentity)}</span>
              <span className="topbar-user-copy"><strong>{sessionIdentity || "Utilisateur"}</strong><small>Accès authentifié</small></span>
              <span className="topbar-user-chevron" aria-hidden="true">⌄</span>
            </button>
            {logoutOpen && <div className="topbar-session-popover" role="menu">
              <button type="button" className="topbar-session-action" role="menuitem" onClick={() => {
                setLogoutOpen(false);
                if (AUTH_PROVIDER === "local") localAuth.signOut();
                else if (idToken) signOut();
                else setDevToken("");
              }}><span aria-hidden="true">↪</span>Déconnexion</button>
            </div>}
          </div>
        </header>

        <div className="workspace-grid">
          <main className="app-content">
            {view === "cartography" && <CartographyPage token={token} />}
            {view === "appetite" && <AppetitePage token={token} />}
            {view === "scales" && <RatingScalesPage token={token} />}
            {view === "controls" && <ControlsPage token={token} />}
            {view === "monitoring" && <ControlMonitoringPage token={token} />}
            {view === "findings" && <AuditFindingsPage token={token} />}
            {view === "actions" && <ActionPlansPage token={token} />}
            {view === "evaluation" && <EvaluationPage token={token} initialRiskId={evaluationRiskId} />}
            {view === "risks" && <RisksPage token={token} onEvaluate={(riskId) => { setEvaluationRiskId(riskId); setView("evaluation"); }} />}
            {view === "roles" && <RolesAdmin token={token} />}
            {view === "feedback" && <FeedbackAdmin token={token} />}
            {view === "placeholder" && (
              <div className="coming-soon">
                <span className="coming-soon-icon">✳</span>
                <p className="auth-eyebrow">FEUILLE DE ROUTE PRODUIT</p>
                <h1>Ce module sera construit dans la prochaine étape.</h1>
                <p>La navigation est déjà structurée. Les écrans seront activés au fur et à mesure du portage des maquettes et de la disponibilité des API métier.</p>
                <Button variant="primary" onClick={() => go("cartography")}>Revenir à la cartographie</Button>
              </div>
            )}
          </main>
          <ContextRail view={view} />
        </div>
      </div>
      {mobileNavOpen && <button type="button" aria-label="Fermer la navigation" className="nav-scrim" onClick={() => setMobileNavOpen(false)} />}
      <FeedbackWidget token={token} />
    </div>
  );
}

function formatIdentity(identity: string): string {
  const value = identity.trim();
  if (!value) return "Utilisateur";
  if (!value.includes("@")) return value;
  const localPart = value.split("@")[0];
  return localPart
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(identity: string): string {
  const value = identity.trim();
  if (!value) return "U";
  const localPart = value.includes("@") ? value.split("@")[0] : value;
  const parts = localPart
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function getGoogleIdentity(token: string | null): string {
  if (!token) return "";
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")) ) as { name?: string; email?: string };
    return claims.name?.trim() || claims.email?.trim() || "";
  } catch {
    return "";
  }
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, import("react").ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    check: <><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10"/></>,
    scale: <><path d="M12 21a9 9 0 1 0 0-18"/><path d="M12 21a9 9 0 1 1 0-18"/><path d="M12 3v18"/></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M9 10v10"/></>,
    shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>,
    play: <path d="m8 5 11 7-11 7z"/>,
    panel: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16"/></>,
    trend: <><path d="M4 17l5-5 4 3 7-8"/><path d="M17 7h3v3"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    arrow: <><path d="M5 12h13"/><path d="m13 6 6 6-6 6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    message: <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.8L3 20l1-4.5a8.4 8.4 0 0 1-.9-3.9A8.4 8.4 0 0 1 11.9 3a8.5 8.5 0 0 1 9.1 8.5z"/>,
    user: <><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1-1.6 2.8-.2-.1-2.1-1.1a7.9 7.9 0 0 1-1.9 1.1L13.4 20h-2.8l-.3-2.2a7.9 7.9 0 0 1-1.9-1.1L6.3 17.8l-1.6-2.7.2-.2 1.6-1.7a7.8 7.8 0 0 1-.1-2.2L4.9 9.3l1.5-2.7 2.1 1A8.6 8.6 0 0 1 10.4 7L10.6 4h2.8l.3 3a8.6 8.6 0 0 1 1.9.7l2.1-1 1.5 2.7-1.4 1.7a7.8 7.8 0 0 1-.1 2.2z"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Sidebar({ view, setView, mobileNavOpen, setMobileNavOpen }: {
  view: View; setView: (view: View) => void; mobileNavOpen: boolean; setMobileNavOpen: (open: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroup, setOpenGroup] = useState("Risques");

  return (
    <aside className={["app-sidebar", mobileNavOpen ? "open" : "", collapsed ? "rail" : ""].filter(Boolean).join(" ")}>
      <div className="sidebar-brand">
        {!collapsed && <div className="sidebar-brand-copy"><strong>GRC Tools</strong><span>Risk &amp; Control</span></div>}
        <button type="button" className="sidebar-collapse" title={collapsed ? "Déployer la navigation" : "Replier la navigation"} onClick={() => setCollapsed((v) => !v)}>
          <span>‹</span>
        </button>
      </div>
      {!collapsed && <div className="sidebar-tenant"><span className="tenant-avatar">D</span><div><strong>Workspace</strong><small>Dispositif de gouvernance</small></div><span className="tenant-chevron">⌄</span></div>}
      <nav className="sidebar-nav" aria-label="Navigation principale">
        {NAV_GROUPS.map((group) => {
          const open = openGroup === group.label;
          return (
            <div className="sidebar-group" key={group.label}>
              <button
                type="button"
                className="sidebar-group-toggle"
                onClick={() => setOpenGroup(open ? "" : group.label)}
                aria-expanded={open}
                title={collapsed ? group.label : undefined}
              >
                {!collapsed && <><span className={open ? "group-chevron open" : "group-chevron"}>›</span><span>{group.label}</span><span className="group-count">{group.items.length}</span></>}
              </button>
              {(open || collapsed) && (
                <div className="sidebar-group-items">
                  {group.items.map((item, index) => {
                    const active = item.available && item.id === view;
                    return (
                      <button
                        type="button"
                        key={group.label + item.label + index}
                        className={active ? "sidebar-link active" : "sidebar-link"}
                        aria-current={active ? "page" : undefined}
                        aria-disabled={!item.available}
                        title={collapsed || !item.available ? (item.available ? item.label : "Module en préparation") : undefined}
                        onClick={() => {
                          if (item.available) {
                            setView(item.id);
                            setMobileNavOpen(false);
                            if (item.id !== group.items[0]?.id) setOpenGroup(group.label);
                          }
                        }}
                      >
                        <span className="sidebar-glyph"><Icon name={item.icon} /></span>
                        {!collapsed && <><span className="sidebar-label">{item.label}</span>{!item.available && <span className="sidebar-soon">À venir</span>}</>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {!collapsed && <div className="sidebar-footer">
        <button type="button" className="sidebar-avatar-button" aria-label="Ouvrir les actions de session" aria-expanded={logoutOpen} onClick={() => setLogoutOpen((open) => !open)}>
          <span className="sidebar-avatar">{getInitials(sessionIdentity)}</span>
        </button>
        <div><strong>{sessionIdentity || "Utilisateur"}</strong><small>Accès authentifié</small></div>
        <span className="sidebar-footer-dot" />
        {logoutOpen && <div className="sidebar-session-popover" role="menu">
          <button type="button" className="sidebar-session-action" role="menuitem" onClick={() => { setLogoutOpen(false); onSignOut(); }}>
            <span aria-hidden="true">↪</span> Déconnexion
          </button>
        </div>}
      </div>}
    </aside>
  );
}

export default App;
