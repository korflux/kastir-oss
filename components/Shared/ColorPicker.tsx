"use client";

import { PAGE_FOLDER_PRESET_COLORS } from "@/lib/Modules/Pages/Schema";

export const DEFAULT_FOLDER_COLOR = "#3B82F6";

export function ColorPicker({
  value,
  onChange,
  label = "Folder color",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {PAGE_FOLDER_PRESET_COLORS.map((color) => (
          <button
            aria-label={`Use color ${color}`}
            aria-pressed={value.toUpperCase() === color}
            className="border-background ring-border focus-visible:ring-ring size-7 rounded-full border-2 ring-1 focus-visible:ring-3"
            key={color}
            style={{ backgroundColor: color }}
            type="button"
            onClick={() => onChange(color)}
          />
        ))}
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          Custom
          <input
            aria-label="Custom folder color"
            className="border-border size-8 cursor-pointer rounded border bg-transparent p-0"
            type="color"
            value={value || "#3B82F6"}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
          />
        </label>
      </div>
    </fieldset>
  );
}
