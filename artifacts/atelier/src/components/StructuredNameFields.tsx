import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/**
 * Task #538 — shared structured-name input group (honorific, first,
 * middle, last, preferred). First + last are required; the server
 * recomputes displayName/fullName from these fields.
 */
export interface StructuredNameValue {
  honorific: string;
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
}

export const EMPTY_NAME: StructuredNameValue = {
  honorific: "",
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
};

/** Best-effort split of a legacy full name for prefill when structured fields are absent. */
export function splitLegacyFullName(fullName: string | null | undefined): StructuredNameValue {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { ...EMPTY_NAME };
  if (parts.length === 1) return { ...EMPTY_NAME, firstName: parts[0] };
  return {
    ...EMPTY_NAME,
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

/** Compose a display preview from structured parts (mirror of server logic). */
export function composeDisplayName(v: StructuredNameValue): string {
  return [v.honorific, v.firstName, v.middleName, v.lastName]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

export function StructuredNameFields({
  value,
  onChange,
  idPrefix,
  showPreferred = true,
  autoFocus = false,
  labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint",
  fieldCls = "bg-bg-deep border-border-soft",
}: {
  value: StructuredNameValue;
  onChange: (next: StructuredNameValue) => void;
  idPrefix: string;
  showPreferred?: boolean;
  autoFocus?: boolean;
  labelCls?: string;
  fieldCls?: string;
}) {
  const set = (k: keyof StructuredNameValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[100px_1fr_1fr] gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-honorific`} className={labelCls}>Honorific</Label>
          <Input
            id={`${idPrefix}-honorific`}
            value={value.honorific}
            onChange={set("honorific")}
            className={fieldCls}
            placeholder="Dr."
            data-testid={`input-${idPrefix}-honorific`}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-first`} className={labelCls}>First name *</Label>
          <Input
            id={`${idPrefix}-first`}
            value={value.firstName}
            onChange={set("firstName")}
            className={fieldCls}
            autoFocus={autoFocus}
            required
            data-testid={`input-${idPrefix}-first-name`}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-middle`} className={labelCls}>Middle name</Label>
          <Input
            id={`${idPrefix}-middle`}
            value={value.middleName}
            onChange={set("middleName")}
            className={fieldCls}
            data-testid={`input-${idPrefix}-middle-name`}
          />
        </div>
      </div>
      <div className={showPreferred ? "grid grid-cols-2 gap-3" : "grid gap-2"}>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-last`} className={labelCls}>Last name *</Label>
          <Input
            id={`${idPrefix}-last`}
            value={value.lastName}
            onChange={set("lastName")}
            className={fieldCls}
            required
            data-testid={`input-${idPrefix}-last-name`}
          />
        </div>
        {showPreferred && (
          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}-preferred`} className={labelCls}>Preferred name</Label>
            <Input
              id={`${idPrefix}-preferred`}
              value={value.preferredName}
              onChange={set("preferredName")}
              className={fieldCls}
              placeholder="Goes by…"
              data-testid={`input-${idPrefix}-preferred-name`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
