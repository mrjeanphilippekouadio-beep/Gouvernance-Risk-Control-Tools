import type { KeyboardEvent } from "react";
import { useRef } from "react";
import { AlertTriangle, Check } from "lucide-react";
import "./Stepper.css";

export type StepState = "done" | "current" | "upcoming" | "error";

export interface StepperStep {
  id: string;
  label: string;
  /** Marks the step as in error (overrides done / upcoming). */
  error?: boolean;
  /** The caller decides which steps may be opened. */
  disabled?: boolean;
}

interface StepperProps {
  steps: StepperStep[];
  /** `id` of the current step. */
  current: string;
  /** Makes steps clickable / keyboard-activable. Omit for a read-only display. */
  onStepChange?: (id: string) => void;
  ariaLabel: string;
}

const STATE_TEXT: Record<StepState, string> = {
  done: "fait",
  current: "en cours",
  upcoming: "à venir",
  error: "en erreur",
};

/**
 * Step-by-step wizard header. State is derived from the position of the
 * current step; `error` is supplied by the caller. Arrow keys / Home / End
 * move focus between steps. Shared by the Dispositif wizard and the import.
 */
export function Stepper({ steps, current, onStepChange, ariaLabel }: StepperProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const currentIndex = steps.findIndex((s) => s.id === current);

  const state = (step: StepperStep, index: number): StepState =>
    step.error ? "error" : index === currentIndex ? "current" : index < currentIndex ? "done" : "upcoming";

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? buttons[Math.min(at + 1, buttons.length - 1)]
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? buttons[Math.max(at - 1, 0)]
          : event.key === "Home"
            ? buttons[0]
            : event.key === "End"
              ? buttons[buttons.length - 1]
              : undefined;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  return (
    <nav aria-label={ariaLabel}>
      <ol ref={listRef} className="gs-stepper" onKeyDown={onKeyDown}>
        {steps.map((step, index) => {
          const s = state(step, index);
          const content = (
            <>
              <span className="gs-stepper-marker" aria-hidden="true">
                {s === "done" ? <Check size={14} /> : s === "error" ? <AlertTriangle size={14} /> : index + 1}
              </span>
              <span className="gs-stepper-label">{step.label}</span>
              <span className="gs-visually-hidden"> ({STATE_TEXT[s]})</span>
            </>
          );
          return (
            <li key={step.id} className={`gs-stepper-step gs-stepper-${s}`}>
              {onStepChange ? (
                <button
                  type="button"
                  className="gs-stepper-btn"
                  aria-current={s === "current" ? "step" : undefined}
                  disabled={step.disabled}
                  onClick={() => onStepChange(step.id)}
                >
                  {content}
                </button>
              ) : (
                <span className="gs-stepper-btn" aria-current={s === "current" ? "step" : undefined}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
