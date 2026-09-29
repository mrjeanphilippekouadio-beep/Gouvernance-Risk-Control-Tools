import { useId, useState } from "react";
import { FileText } from "lucide-react";
import "./FileUpload.css";

interface FileUploadProps {
  onSelect?: (file: File | null) => void;
  /** Text of the trigger. */
  buttonLabel?: string;
  /** Controlled file name. When omitted the component shows the last pick itself. */
  fileName?: string;
  /** Forwarded to the native input, e.g. ".pdf,image/*". */
  accept?: string;
  disabled?: boolean;
}

/**
 * File picker (design system section "File upload"): the native input is
 * hidden and driven by a `<label>` styled as a secondary button — the one
 * way to restyle a file input without losing its keyboard behaviour.
 */
export function FileUpload({
  onSelect,
  buttonLabel = "Choisir un fichier",
  fileName,
  accept,
  disabled = false,
}: FileUploadProps) {
  const id = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const shown = fileName ?? picked;

  return (
    <div className="gs-file-upload">
      {/* Input before the label so `:focus-visible + label` can mirror the
          keyboard focus ring onto the visible trigger. */}
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setPicked(file?.name ?? null);
          onSelect?.(file);
        }}
      />
      <label className={disabled ? "btn btn-secondary gs-file-upload-disabled" : "btn btn-secondary"} htmlFor={id}>
        {buttonLabel}
      </label>
      {shown && (
        <span className="gs-file-upload-name">
          <FileText aria-hidden="true" />
          {shown}
        </span>
      )}
    </div>
  );
}
