import { z } from "zod";

export const FOLDER_PRESET_COLORS = [
  "#3B82F6",
  "#22C55E",
  "#EAB308",
  "#A855F7",
  "#F97316",
  "#EC4899",
] as const;

export const folderColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i, "Invalid folder color")
  .transform((value) => {
    const hex = value.slice(1).toUpperCase();
    return `#${
      hex.length === 3
        ? hex
            .split("")
            .map((char) => char + char)
            .join("")
        : hex
    }`;
  });
