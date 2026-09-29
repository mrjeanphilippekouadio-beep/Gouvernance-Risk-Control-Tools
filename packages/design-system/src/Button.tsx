import type { ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * DESIGN_NOTES.md section 5.4: primary/secondary/destructive hierarchy so
 * a destructive action (Désactiver, Révoquer) never carries the same
 * visual weight as a primary one (Créer). Defaults to "secondary" since
 * most actions in the app today are not the primary action of their form.
 */
export function Button({ variant = "secondary", className, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
