import { useState } from "react";
import { RisksPage } from "./features/risks/RisksPage";
import { EvaluationPage } from "./features/evaluations/EvaluationPage";
import { AdminPage } from "./features/admin/AdminPage";
import { FeedbackWidget } from "./features/feedback/FeedbackWidget";
import { useGoogleSignIn } from "./auth/useGoogleSignIn";
import { Button, FormField } from "@djamo/design-system";
import "./App.css";

const GOOGLE_CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;

type View = "evaluation" | "risks" | "admin" | "placeholder";
type NavItem = { id: View; label: string; glyph: string; available?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Vue d'ensemble", items: [{ id: "placeholder", label: "Tableau de bord", glyph: "▦" }] },
  { label: "Gestion des risques", items: [
    { id: "placeholder", label: "Cartographie", glyph: "▧" },
    { id: "evaluation", label: "Évaluation des risques", glyph: "◉", available: true },
    { id: "risks", label: "Registre des risques", glyph: "☷", available: true },
    { id: "placeholder", label: "Appétence au risque", glyph: "⌁" },
    { id: "placeholder", label: "Grilles de cotation", glyph: "▦" },
  ] },
  { label: "Contrôle interne", items: [
    { id: "placeholder", label: "Contrôles", glyph: "✓" },
    { id: "placeholder", label: "Plan de contrôle", glyph: "▤" },
    { id: "placeholder", label: "Exécution des contrôles", glyph: "▷" },
  ] },
  { label: "Indicateurs & suivi", items: [
    { id: "placeholder", label: "KRI & KPI", glyph: "⌁" },
    { id: "placeholder", label: "Plans d'action", glyph: "↗" },
    { id: "placeholder", label: "Cycle de revue", glyph: "◷" },
  ] },
  { label: "Audit & administration", items: [
    { id: "placeholder", label: "Audit", glyph: "⌕" },
    { id: "admin", label: "Administration", glyph: "⚙", available: true },
  ] },
];

function App() {
  const { idToken, error, buttonRef, signOut } = useGoogleSignIn(GOOGLE_CLIENT_ID);
  const [devToken, setDevToken] = useState("");
  const [view, setView] = useState<View>("evaluation");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const token = idToken ?? devToken;

  if (!token) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand-mark">G</div>
          <p className="auth-eyebrow">GOUVERNANCE · RISQUES · CONTRÔLE</p>
          <h1>GRC Tools</h1>
          <p className="auth-description">Le dispositif de maîtrise des risques, au même endroit.</p>
          {error ? (
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

  if (view === "placeholder") {
    return (
      <div className="app-shell">
        <Sidebar view={view} setView={setView} mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen} />
        <div className="app-main">
          <header className="app-topbar"><button type="button" className="mobile-menu-toggle" aria-label={mobileNavOpen ? "Fermer la navigation" : "Ouvrir la navigation"} onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? "×" : "☰"}</button><div className="topbar-title"><span className="topbar-kicker">GRC TOOLS</span><strong>Module en préparation</strong></div><Button onClick={idToken ? signOut : () => setDevToken("")}>Déconnexion</Button></header>
          <main className="app-content"><div className="coming-soon"><span className="coming-soon-icon">✳</span><p className="auth-eyebrow">FEUILLE DE ROUTE PRODUIT</p><h1>Ce module sera construit dans la prochaine étape.</h1><p>La navigation est déjà structurée. Les écrans seront activés au fur et à mesure du portage des maquettes et de la disponibilité des API métier.</p><Button variant="primary" onClick={() => setView("evaluation")}>Revenir à l'évaluation</Button></div></main>
        </div>
        <FeedbackWidget token={token} />
      </div>
    );
  }

  const pageTitle = view === "evaluation" ? "Évaluation des risques" : view === "risks" ? "Registre des risques" : "Administration";
  return (
    <div className="app-shell">
      <Sidebar view={view} setView={setView} mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen} />
      <div className="app-main">
        <header className="app-topbar">
          <button type="button" className="mobile-menu-toggle" aria-label={mobileNavOpen ? "Fermer la navigation" : "Ouvrir la navigation"} onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? "×" : "☰"}</button>
          <div className="topbar-title"><span className="topbar-kicker">ESPACE DE TRAVAIL / GRC</span><strong>{pageTitle}</strong></div>
          <div className="topbar-actions"><span className="topbar-status"><span />Connecté</span><Button onClick={idToken ? signOut : () => setDevToken("")}>Déconnexion</Button></div>
        </header>
        <main className="app-content">
          {view === "evaluation" ? <EvaluationPage token={token} /> : view === "risks" ? <RisksPage token={token} /> : <AdminPage token={token} />}
        </main>
      </div>
      {mobileNavOpen && <button type="button" aria-label="Fermer la navigation" className="nav-scrim" onClick={() => setMobileNavOpen(false)} />}
      <FeedbackWidget token={token} />
    </div>
  );
}

function Sidebar({ view, setView, mobileNavOpen, setMobileNavOpen }: {
  view: View; setView: (view: View) => void; mobileNavOpen: boolean; setMobileNavOpen: (open: boolean) => void;
}) {
  return (
    <aside className={mobileNavOpen ? "app-sidebar open" : "app-sidebar"}>
      <div className="sidebar-brand"><div className="sidebar-logo">G</div><div><strong>GRC Tools</strong><span>Risk & Control</span></div></div>
      <div className="sidebar-tenant"><span className="tenant-avatar">D</span><div><strong>Workspace</strong><small>Dispositif de gouvernance</small></div><span className="tenant-chevron">⌄</span></div>
      <nav className="sidebar-nav" aria-label="Navigation principale">
        {NAV_GROUPS.map((group) => <div className="sidebar-group" key={group.label}><p>{group.label}</p>
          {group.items.map((item, index) => {
            const active = item.available && item.id === view;
            return <button type="button" key={`${group.label}-${item.label}-${index}`} className={active ? "sidebar-link active" : "sidebar-link"} aria-current={active ? "page" : undefined} aria-disabled={!item.available} title={!item.available ? "Module en préparation" : item.label} onClick={() => { if (item.available) { setView(item.id); setMobileNavOpen(false); } }}>
              <span className="sidebar-glyph" aria-hidden="true">{item.glyph}</span><span>{item.label}</span>{!item.available && <span className="sidebar-soon">À venir</span>}
            </button>;
          })}
        </div>)}
      </nav>
      <div className="sidebar-footer"><span className="sidebar-avatar">JP</span><div><strong>Session active</strong><small>Accès authentifié</small></div><span className="sidebar-footer-dot" /></div>
    </aside>
  );
}

export default App;
