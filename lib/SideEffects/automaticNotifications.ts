import { MAX_NOTIFICATION_MESSAGE_LENGTH } from "@/lib/Modules/Notifications/Types";

export type AutomaticNotificationLanguage = "en" | "pt-BR";

function languageOf(language?: string): AutomaticNotificationLanguage {
  return language === "pt-BR" ? "pt-BR" : "en";
}

function redactLabel(value: string): string {
  return value
    .replace(/<\/?[a-zA-Z][^>]*>?/g, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(/\b(?:token|secret|password)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedMessage(
  template: string,
  values: Record<string, string>,
): string {
  const sanitized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, redactLabel(value)]),
  );
  let rendered = template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => sanitized[key] ?? "",
  );
  let overflow = rendered.length - MAX_NOTIFICATION_MESSAGE_LENGTH;

  for (const key of Object.keys(sanitized)) {
    if (overflow <= 0) break;
    const current = sanitized[key]!;
    const remove = Math.min(overflow, current.length);
    sanitized[key] = current.slice(0, current.length - remove);
    overflow -= remove;
  }

  rendered = template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => sanitized[key] ?? "",
  );
  return rendered.slice(0, MAX_NOTIFICATION_MESSAGE_LENGTH);
}

export function buildSnippetDisabledMessage(
  language: string | undefined,
  snippetId: string,
  snippetName: string,
  pageTitle: string,
): { message: string; link: string } {
  const message =
    languageOf(language) === "pt-BR"
      ? boundedMessage(
          "O script '{snippetName}' foi desativado automaticamente porque a página '{pageTitle}' foi removida do escopo.",
          { snippetName, pageTitle },
        )
      : boundedMessage(
          "The script '{snippetName}' was automatically disabled because page '{pageTitle}' was removed from its scope.",
          { snippetName, pageTitle },
        );

  return {
    message,
    link: `/admin/custom-code/${encodeURIComponent(snippetId)}`,
  };
}

export function buildSnippetOrphanedMessage(
  language: string | undefined,
  snippetId: string,
  snippetName: string,
): { message: string; link: string } {
  const message =
    languageOf(language) === "pt-BR"
      ? boundedMessage(
          "O script '{snippetName}' foi desativado automaticamente porque seu escopo de páginas específicas ficou vazio.",
          { snippetName },
        )
      : boundedMessage(
          "The script '{snippetName}' was automatically disabled because its specific-page scope became empty.",
          { snippetName },
        );

  return {
    message,
    link: `/admin/custom-code/${encodeURIComponent(snippetId)}`,
  };
}

export function buildHomePageRemovedMessage(
  language: string | undefined,
  pageTitle: string,
): { message: string; link: string } {
  const message =
    languageOf(language) === "pt-BR"
      ? boundedMessage(
          "A página inicial '{pageTitle}' foi removida. O site agora está sem página inicial.",
          { pageTitle },
        )
      : boundedMessage(
          "The home page '{pageTitle}' was removed. The site now has no home page.",
          { pageTitle },
        );

  return { message, link: "/admin/settings" };
}
