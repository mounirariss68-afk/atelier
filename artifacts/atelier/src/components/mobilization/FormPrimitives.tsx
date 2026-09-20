/**
 * Shared form primitive components used across mobilization forms.
 */
import * as React from "react";

export function FormField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-[11px] font-mono uppercase tracking-widest text-text-mute block">
        {label}
      </label>
      {children}
    </div>
  );
}

export function EmptySlot({
  message,
  icon,
}: {
  message: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center border border-dashed border-border-soft rounded-md bg-bg-deep/50">
      {icon && <div className="text-text-faint">{icon}</div>}
      <p className="text-sm text-text-mute">{message}</p>
    </div>
  );
}
