import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import "./FormField.css";
import "./Fields.css";

const cx = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" ");

/** Text-like input. Pair with `FormField` for label / help / error wiring. */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("gs-control", className)} {...rest} />;
}

export function Textarea({ className, rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("gs-control", className)} rows={rows} {...rest} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  /** Optional empty first option (value ""), e.g. "Choisir…". */
  placeholder?: string;
  /**
   * A native select cannot be read-only: in that mode the selected label is
   * shown in a read-only text input instead (no option list, not submitted).
   */
  readOnly?: boolean;
}

export function Select({ options, placeholder, readOnly, className, ...rest }: SelectProps) {
  if (readOnly) {
    const { value, defaultValue, id, "aria-describedby": describedBy, "aria-invalid": invalid, "aria-label": ariaLabel } = rest;
    const current = String(value ?? defaultValue ?? "");
    const label = options.find((o) => o.value === current)?.label ?? "";
    return (
      <input
        id={id}
        className={cx("gs-control", className)}
        readOnly
        value={label}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label={ariaLabel}
      />
    );
  }
  return (
    <select className={cx("gs-control", className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: string;
}

export function Checkbox({ label, hint, className, id, disabled, ...rest }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className={cx("gs-choice", className)} htmlFor={inputId} data-disabled={disabled || undefined}>
      <input type="checkbox" id={inputId} disabled={disabled} {...rest} />
      <span>
        {label}
        {hint && <span className="gs-choice-hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface RadioGroupProps {
  legend: string;
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  help?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Keeps the selection visible but ignores changes. */
  readOnly?: boolean;
}

/** Radios inside a `<fieldset>`: arrow keys move the choice natively. */
export function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
  help,
  error,
  required,
  disabled,
  readOnly,
}: RadioGroupProps) {
  const id = useId();
  const messageId = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <fieldset className="gs-fieldset" aria-describedby={messageId} disabled={disabled}>
      <legend>
        {legend}
        {required && (
          <>
            <span className="form-field__required" aria-hidden="true">
              {" *"}
            </span>
            <span className="gs-visually-hidden"> (obligatoire)</span>
          </>
        )}
      </legend>
      {options.map((o) => (
        <label key={o.value} className="gs-choice" data-disabled={o.disabled || undefined}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-readonly={readOnly || undefined}
            onChange={() => {
              if (!readOnly) onChange(o.value);
            }}
          />
          <span>
            {o.label}
            {o.hint && <span className="gs-choice-hint">{o.hint}</span>}
          </span>
        </label>
      ))}
      {help && !error && (
        <p id={`${id}-help`} className="form-field__help">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="form-field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
