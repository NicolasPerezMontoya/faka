import * as React from "react";
import { cn } from "../lib/cn.js";

export interface ToggleProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label?: string;
}

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  ({ className, label, ...props }, ref) => (
    <label
      className={cn("inline-flex items-center gap-2 cursor-pointer", className)}
    >
      <span className="relative inline-flex h-6 w-11 items-center">
        <input ref={ref} type="checkbox" className="peer sr-only" {...props} />
        <span className="absolute inset-0 rounded-full bg-input transition peer-checked:bg-primary" />
        <span className="absolute h-5 w-5 rounded-full bg-card shadow translate-x-0.5 transition peer-checked:translate-x-[1.4rem]" />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </label>
  ),
);
Toggle.displayName = "Toggle";
