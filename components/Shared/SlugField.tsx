"use client";

import { useEffect, useState } from "react";

import { RequiredMark } from "@/components/Shared/RequiredMark";
import { Input } from "@/components/ui/input";

export function SlugField({
  value,
  autoValue,
  error,
  required = false,
  hideHint = false,
  inputId = "page-slug",
  disabled = false,
  onChange,
}: {
  value: string;
  autoValue: string;
  error?: string;
  required?: boolean;
  hideHint?: boolean;
  inputId?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [manual, setManual] = useState(Boolean(value));

  useEffect(() => {
    if (!manual && value !== autoValue) onChange(autoValue);
  }, [autoValue, manual, onChange, value]);

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={inputId}>
        Slug
        {required ? <RequiredMark /> : null}
      </label>
      <Input
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={Boolean(error)}
        className="h-9 rounded-lg"
        disabled={disabled}
        id={inputId}
        placeholder="my-page"
        required={required}
        value={value}
        onChange={(event) => {
          setManual(true);
          onChange(event.target.value);
        }}
      />
      {error ? (
        <p
          className="text-destructive text-xs"
          id={`${inputId}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : !hideHint ? (
        <p className="text-muted-foreground text-xs">
          Leave blank to derive it from the title.
        </p>
      ) : null}
    </div>
  );
}
