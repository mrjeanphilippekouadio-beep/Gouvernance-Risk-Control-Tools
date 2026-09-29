import type { ReactNode } from "react";
import "./FormField.css";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string;
  children: ReactNode;
}

/**
 * Single form-field pattern for the whole app: Label + Control + optional
 * help text + optional inline error — see DESIGN_NOTES.md section 5.2.
 * Replaces the two conventions that coexisted before (visible <label> in
 * FeedbackWidget vs. placeholder-only in RisksPage/RolesAdmin); resolves
 * in favor of the explicit <label>, the only accessible option and the
 * only one that stays legible once the field is filled in.
 */
export function FormField({ label, htmlFor, help, error, children }: FormFieldProps) {
  return (
    <div className="form-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && !error && <p className="form-field__help">{help}</p>}
      {error && (
        <p className="form-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
