/** Saudações por faixa de horário (Figma: Good morning/afternoon/evening). */
export function timeOfDayKey(
  hour = new Date().getHours(),
): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function formatGreeting(template: string, name: string): string {
  return template.replaceAll("{name}", () => name);
}

/** MB arredondado pro subtítulo de Medias ("files 183 MB"). */
export function formatSizeMb(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / (1024 * 1024));
}

export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
