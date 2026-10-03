import { useState, type ReactNode } from "react";
import { MessageBanner } from "@djamo/design-system";
import "./ContextRail.css";

type View = "cartography" | "evaluation" | "risks" | "roles" | "feedback" | "placeholder" | "appetite" | "scales" | "controls" | "monitoring" | "findings" | "actions";
type RailTab = "comments" | "raci" | "evidence" | "occurrence";

const LABELS: Record<RailTab, string> = { comments: "Commentaires", raci: "RACI", evidence: "Preuves", occurrence: "Occurrence" };
const ICONS: Record<RailTab, ReactNode> = {
  comments: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.8L3 20l1-4.5a8.4 8.4 0 0 1-.9-3.9A8.4 8.4 0 0 1 11.9 3a8.5 8.5 0 0 1 9.1 8.5z"/></svg>,
  raci: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>,
  evidence: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v13H6z"/></svg>,
  occurrence: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="9"/><path d="M12 8v5l4 2"/></svg>,
};

interface ContextRailProps { view: View; }

export function ContextRail({ view }: ContextRailProps) {
  const objectView = view === "risks" || view === "evaluation";
  const tabs: RailTab[] = objectView ? ["comments", "raci", "evidence", "occurrence"] : ["comments", "raci"];
  const [railOpen, setRailOpen] = useState(false);
  const [active, setActive] = useState<RailTab | null>(null);
  const currentActive = active && tabs.includes(active) ? active : null;

  return (
    <aside className={["context-rail", railOpen ? "open" : "", currentActive ? "has-panel" : ""].filter(Boolean).join(" ")}>
      <div className="context-rail__tabs">
        <button className="context-rail__collapse" type="button" title={railOpen ? "Replier le panneau" : "Afficher les panneaux"} aria-expanded={railOpen} onClick={() => { setRailOpen((value) => !value); setActive(null); }}><span aria-hidden="true">‹</span></button>
        {railOpen && tabs.map((tab) => (
          <button type="button" key={tab} className={currentActive === tab ? "context-rail__tab on" : "context-rail__tab"} title={LABELS[tab]} aria-expanded={currentActive === tab} onClick={() => setActive((value) => value === tab ? null : tab)}>
            {ICONS[tab]}
            <span className="context-rail__label">{tab === "comments" ? "Comment." : LABELS[tab]}</span>
          </button>
        ))}
      </div>
      {currentActive && <div className="context-rail__panel">
        {currentActive === "comments" && <EmptyContextPanel title="Commentaires" message="Les commentaires ne sont pas encore reliés à cette vue. Aucun commentaire n'est affiché tant que la source métier n'est pas connectée." />}
        {currentActive === "raci" && <EmptyContextPanel title="RACI" message="Aucune attribution RACI n'est chargée pour cette vue. Les responsabilités seront affichées une fois la liaison avec les données métier activée." />}
        {currentActive === "evidence" && <EmptyContextPanel title="Preuves" message="Aucune preuve n'est chargée pour l'objet sélectionné dans cette vue." />}
        {currentActive === "occurrence" && <EmptyContextPanel title="Occurrence" message="Aucun incident, anomalie ou constat lié n'est chargé pour l'objet sélectionné." />}
      </div>}
    </aside>
  );
}

function EmptyContextPanel({ title, message }: { title: string; message: string }) {
  return <div className="rail-panel-content">
    <div className="rail-panel-head"><h3>{title}</h3></div>
    <div className="rail-panel-body"><MessageBanner tone="info">{message}</MessageBanner></div>
  </div>;
}
