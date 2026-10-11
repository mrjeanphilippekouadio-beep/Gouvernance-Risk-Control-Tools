import type { ReactElement, ReactNode } from "react";
import { Children, cloneElement, Fragment, isValidElement } from "react";
import "./FormField.css";

interface FormFieldProps {
  label: string;
  /** `id` of the control — also the base of the help/error element ids. */
  htmlFor: string;
  help?: string;
  error?: string;
  /** Marks the field as required (visible marker + `required` on the control). */
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  children: ReactNode;
}

/**
 * Single form-field pattern for the whole app: Label + Control + optional
 * help text + optional inline error — see DESIGN_NOTES.md section 5.2.
 *
 * The help and error texts are linked to the control (`aria-describedby`,
 * `aria-invalid`) by cloning the single element child, so native controls
 * and Input/Select/Textarea get them with no extra wiring. Wrapped or
 * multiple children are left untouched (backward compatible).
 */
export function FormField({ label, htmlFor, help, error, required, disabled, readOnly, children }: FormFieldProps) {
  const helpId = `${htmlFor}-help`;
  const errorId = `${htmlFor}-error`;
  const messageId = error ? errorId : help ? helpId : undefined;

  let control = children;
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  if (isValidElement(only) && only.type !== Fragment) {
    const element = only as ReactElement<Record<string, unknown>>;
    const existing = element.props["aria-describedby"] as string | undefined;
    control = cloneElement(element, {
      "aria-describedby": [existing, messageId].filter(Boolean).join(" ") || undefined,
      "aria-invalid": error ? true : undefined,
      ...(required ? { required: true } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(readOnly ? { readOnly: true } : {}),
    });
  }

  return (
    <div className="form-field">
      <label htmlFor={htmlFor}>
        {label}
        {required && (
          <>
            <span className="form-field__required" aria-hidden="true">
              {" *"}
            </span>
            <span className="gs-visually-hidden"> (obligatoire)</span>
          </>
        )}
      </label>
      {control}
      {help && !error && (
        <p id={helpId} className="form-field__help">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="form-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
