import type { ReactNode } from "react";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import "./Collapsible.css";

interface CollapsibleProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode: pass both `open` and `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Heading level of the title (default 3). */
  level?: 2 | 3 | 4;
}

/** Collapsible section: heading + button (`aria-expanded`, `aria-controls`) + region. */
export function Collapsible({ title, children, defaultOpen = false, open, onOpenChange, level = 3 }: CollapsibleProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const panelId = useId();
  const buttonId = useId();
  const Heading = `h${level}` as const;

  const toggle = () => {
    if (open === undefined) setInner(!isOpen);
    onOpenChange?.(!isOpen);
  };

  return (
    <section className="gs-collapsible">
      <Heading className="gs-collapsible-heading">
        <button
          type="button"
          id={buttonId}
          className="gs-collapsible-btn"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={toggle}
        >
          <ChevronDown size={16} aria-hidden="true" className="gs-collapsible-icon" data-open={isOpen || undefined} />
          {title}
        </button>
      </Heading>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen} className="gs-collapsible-panel">
        {children}
      </div>
    </section>
  );
}
