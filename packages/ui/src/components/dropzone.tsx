// Dropzone — design from docs/sketches/csv-upload-wizard.html:170-176

"use client";

import * as React from "react";
import { cn } from "../lib/cn.js";

export interface DropzoneProps {
  onFileSelected: (file: File) => void;
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
  className?: string;
  /** Optional render-prop for showing the currently selected file. */
  current?: React.ReactNode;
}

export function Dropzone({
  onFileSelected,
  accept = ".csv,text/csv",
  maxBytes,
  disabled = false,
  className,
  current,
}: DropzoneProps): React.JSX.Element {
  const [isDragging, setIsDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function validateAndEmit(file: File) {
    if (maxBytes && file.size > maxBytes) {
      setError(
        `FILE_TOO_LARGE — ${(file.size / 1024 / 1024).toFixed(1)}MB > ${(maxBytes / 1024 / 1024).toFixed(0)}MB`,
      );
      return;
    }
    setError(null);
    onFileSelected(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndEmit(file);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) validateAndEmit(file);
  }

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "border-2 border-dashed rounded-lg px-6 py-10 text-center cursor-pointer transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-input",
          disabled
            ? "opacity-50 pointer-events-none"
            : "hover:border-primary/50",
        )}
      >
        <div className="text-foreground font-medium">Arrastra el CSV aquí</div>
        <div className="text-xs text-muted-foreground mt-1">
          o haz clic para seleccionar — máx{" "}
          {maxBytes ? `${(maxBytes / 1024 / 1024).toFixed(0)}MB` : "sin tope"},
          UTF-8
        </div>
        {current && <div className="mt-3 text-xs">{current}</div>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onChange}
          className="hidden"
          disabled={disabled}
        />
      </div>
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
}
