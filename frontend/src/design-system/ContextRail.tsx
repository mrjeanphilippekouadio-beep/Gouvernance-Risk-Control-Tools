import { useState, type ReactNode } from "react";
import { Card, StatusBadge, Timeline } from "@djamo/design-system";
import "./ContextRail.css";

type View = "cartography" | "evaluation" | "risks" | "roles" | "feedback" | "placeholder" | "appetite" | "scales" | "controls" | "monitoring" | "findings";
type RailTab = "comments" | "raci" | "evidence" | "occurrence";

const LABELS: Record<RailTab, string> = {
  comments: "Commentaires",
  raci: "RACI",
  evidence: "Evidence",
  occurrence: "Occurrence",
};

const ICONS: Record<RailTab, ReactNode> = {
  comments: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.8L3 20l1-4.5a8.4 8.4 0 0 1-.9-3.9A8.4 8.4 0 0 1 11.9 3a8.5 8.5 0 0 1 9.1 8.5z"/></svg>,
  raci: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>,
  evidence: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v13H6z"/></svg>,
  occurrence: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="9"/><path d="M12 8v5l4 2"/></svg>,
};

interface ContextRailProps {
  view: View;
}

export function ContextRail({ view }: ContextRailProps) {
  const objectView = view === "risks" || view === "evaluation";
  const tabs: RailTab[] = objectView ? ["comments", "raci", "evidence", "occurrence"] : ["comments", "raci"];
  const [collapsed, setCollapsed] = useState(false);
  const [active, setActive] = useState<RailTab>("comments");

  const currentActive = tabs.includes(active) ? active : tabs[0];

  return (
    <aside className={collapsed ? "context-rail collapsed" : "context-rail"}>
      <div className="context-rail__tabs">
        <button className="context-rail__collapse" type="button" title={collapsed ? "Déployer le panneau" : "Replier le panneau"} onClick={() => setCollapsed((v) => !v)}>
          <span>‹</span>
        </button>
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            className={currentActive === tab ? "context-rail__tab on" : "context-rail__tab"}
            title={LABELS[tab]}
            onClick={() => setActive(tab)}
          >
            {ICONS[tab]}
            <span className="context-rail__label">{LABELS[tab] === "Commentaires" ? "Comment." : LABELS[tab]}</span>
            <span className="context-rail__count">{tab === "comments" ? 2 : tab === "raci" ? 3 : tab === "evidence" ? 1 : 2}</span>
          </button>
        ))}
      </div>

      {!collapsed && (
        <div className="context-rail__panel">
          {currentActive === "comments" && <CommentsPanel objectView={objectView} />}
          {currentActive === "raci" && <RaciPanelPreview objectView={objectView} />}
          {currentActive === "evidence" && <EvidencePanel />}
          {currentActive === "occurrence" && <OccurrencePanel />}
        </div>
      )}
    </aside>
  );
}

function CommentsPanel({ objectView }: { objectView: boolean }) {
  return (
    <div className="rail-panel-content">
      <div className="rail-panel-head"><h3>Commentaires</h3><span>page entière</span></div>
      <div className="rail-panel-body">
        <div className="rail-comment"><span className="rail-avatar">KN</span><div><strong>Kouadio N'Guessan</strong><small>28/09 · 09:12</small><p>Score proche du seuil — je propose d'escalader au Comité.</p></div></div>
        <div className="rail-comment"><span className="rail-avatar">AD</span><div><strong>Aïssatou Diallo</strong><small>28/09 · 11:40</small><p>D'accord, je transmets avec la justification.</p></div></div>
        {!objectView && <div className="rail-hint">Les commentaires peuvent être rattachés à une zone précise de la page via le bouton Feedback.</div>}
      </div>
    </div>
  );
}

function RaciPanelPreview({ objectView }: { objectView: boolean }) {
  return (
    <div className="rail-panel-content">
      <div className="rail-panel-head"><h3>RACI</h3><span>3 personnes</span></div>
      <div className="rail-panel-body">
        <table className="rail-raci">
          <thead><tr><th>Personne</th><th>R</th><th>A</th><th>C</th><th>I</th></tr></thead>
          <tbody>
            <tr><td>Aïssatou Diallo<small>Trésorière</small></td><td className="r">R</td><td>–</td><td>–</td><td>–</td></tr>
            <tr><td>Kouadio N'Guessan<small>Risk Manager</small></td><td>–</td><td className="a">A</td><td>–</td><td>–</td></tr>
            <tr><td>Comité des risques<small>Gouvernance</small></td><td>–</td><td>–</td><td>–</td><td className="i">I</td></tr>
          </tbody>
        </table>
        {!objectView && <div className="rail-hint">Vue agrégée : le panneau reste disponible, mais les actions métier sont portées par les fiches d'objet.</div>}
      </div>
    </div>
  );
}

function EvidencePanel() {
  return (
    <div className="rail-panel-content">
      <div className="rail-panel-head"><h3>Evidence</h3><span>1 preuve</span></div>
      <div className="rail-panel-body">
        <Card className="rail-evidence-card">
          <div className="rail-file-icon">PDF</div>
          <div><strong>rapprochement_sept2026.pdf</strong><small>Document · 428 Ko</small></div>
          <StatusBadge label="Vérifiée" tone="success" />
        </Card>
      </div>
    </div>
  );
}

function OccurrencePanel() {
  return (
    <div className="rail-panel-content">
      <div className="rail-panel-head"><h3>Occurrence</h3><span>2 faits</span></div>
      <div className="rail-panel-body">
        <Timeline items={[
          { label: "Incident déclaré", detail: "14/09/2026 · Opérations", state: "done" },
          { label: "Constat sectoriel référencé", detail: "22/09/2026 · Veille réglementaire", state: "done" },
        ]} />
      </div>
    </div>
  );
}
