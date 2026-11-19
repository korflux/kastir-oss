"use client";

import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";

import { cn } from "@/lib/utils";

function Combobox<ItemValue>({
  ...props
}: ComboboxPrimitive.Root.Props<ItemValue>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxTrigger({ ...props }: ComboboxPrimitive.Trigger.Props) {
  return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" {...props} />;
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner className="isolate z-50 outline-none">
        <ComboboxPrimitive.Popup
          data-slot="combobox-popup"
          className={cn(
            "border-border bg-popover text-popover-foreground max-h-72 min-w-(--anchor-width) overflow-auto rounded-xl border p-1 shadow-lg outline-none",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ ...props }: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot="combobox-list" {...props} />;
}

function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "data-highlighted:bg-muted flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm outline-none",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxEmpty({ ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className="text-muted-foreground px-2.5 py-3 text-sm"
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
};
