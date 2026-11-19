import { ChevronDown } from "lucide-react";

/** Seta do select nativo (appearance-none esconde a do browser). */
export function SelectChevron() {
  return (
    <ChevronDown
      aria-hidden
      className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 opacity-80"
    />
  );
}
