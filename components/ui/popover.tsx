"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  sideOffset = 8,
  align = "start",
  // O padrão cobre os quick edits: entrada no primeiro campo e retorno ao
  // trigger ao fechar; consumidores ainda podem desabilitar explicitamente.
  initialFocus = true,
  finalFocus = true,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        className="isolate z-50 outline-none"
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "border-border bg-popover text-popover-foreground data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 max-h-[calc(100svh-1rem)] w-[min(20rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border p-4 shadow-lg outline-none",
            className,
          )}
          finalFocus={finalFocus}
          initialFocus={initialFocus}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger };
