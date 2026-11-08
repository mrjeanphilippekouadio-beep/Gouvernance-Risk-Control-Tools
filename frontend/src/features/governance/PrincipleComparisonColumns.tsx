import type { OrganizationSize, PanelPrinciple, RequirementLevel } from "../../api/governanceHealth";
import "./GovernanceHealth.css";

const SIZES: Array<{ size: OrganizationSize; label: string }> = [
  { size: "TPE", label: "TPE" },
  { size: "PME", label: "PME" },
  { size: "GRANDE_ENTREPRISE", label: "Grande entreprise" },
];
const LEVEL: Record<RequirementLevel, string> = { exige: "Exigé", recommande: "Recommandé", informatif: "Informatif" };

/**
 * The A13 indications of a principle for the three sizes. The column of the client's size (`highlighted`, given by the
 * server) is marked by text + icon + aria-current, never by colour alone. Each column folds (useful on a narrow screen).
 */
export function PrincipleComparisonColumns({ principle }: Readonly<{ principle: PanelPrinciple }>) {
  return <div className="gh-columns">
    {SIZES.map(({ size, label }) => {
      const current = principle.highlighted === size;
      const ind = principle.indications[size];
      return <details key={size} open className={`gh-column${current ? " gh-column--current" : ""}`} aria-current={current ? "true" : undefined}>
        <summary>
          <strong>{label}</strong>
          {current && <span className="gh-column__mark"><span aria-hidden="true">★ </span>Votre taille</span>}
        </summary>
        <p className="gh-column__level">{LEVEL[ind.level] ?? ind.level}</p>
        <p>{ind.action}</p>
      </details>;
    })}
  </div>;
}
