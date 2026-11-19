// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPanelDictionary } from "@/lib/i18n/panel";
import { McpWorkspace } from "@/lib/Modules/Mcp/Components/McpWorkspace";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("MCP connections workspace", () => {
  it("renders the public endpoint and loading state", () => {
    const dictionary = getPanelDictionary("en").mcpConnections;
    const html = renderToStaticMarkup(
      React.createElement(McpWorkspace, {
        dictionary,
        endpoint: "https://cms.example.test/api/mcp",
      }),
    );

    expect(html).toContain("https://cms.example.test/api/mcp");
    expect(html).toContain(dictionary.title);
    expect(html).toContain(dictionary.loading);
  });

  // Fase 4, T3 (A3): o cancelar e o X do diálogo de revogação vêm do dicionário, nos dois
  // idiomas; antes o cancelar era o literal "Cancel" e o X, o "Close" do primitivo.
  it.each([
    ["en", "Cancel", "Close"],
    ["pt-BR", "Cancelar", "Fechar"],
  ] as const)(
    "names the revoke dialog cancel and close buttons in %s",
    async (language, expectedCancel, expectedClose) => {
      const dictionary = getPanelDictionary(language).mcpConnections;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => [
            {
              id: "connection-1",
              clientId: "client-1",
              clientName: "Claude",
              clientUri: null,
              user: {
                id: "user-1",
                name: "Marco",
                email: "marco@example.test",
                role: "MASTER",
              },
              scopes: ["pages:read"],
              createdAt: "2026-10-16T12:00:00.000Z",
              updatedAt: "2026-10-16T12:00:00.000Z",
              lastTokenIssuedAt: null,
              active: true,
            },
          ],
        })),
      );
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      act(() =>
        root?.render(
          React.createElement(McpWorkspace, {
            dictionary,
            endpoint: "https://cms.example.test/api/mcp",
          }),
        ),
      );
      // A carga sai num `setTimeout(0)`: espera o timer e a resposta assentarem.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const revoke = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === dictionary.revoke,
      );
      expect(revoke).toBeDefined();
      act(() => revoke?.click());

      const content = document.body.querySelector<HTMLElement>(
        '[data-slot="dialog-content"]',
      );
      expect(content).not.toBeNull();
      const buttons = [...content!.querySelectorAll("button")];
      expect(buttons.map((button) => button.textContent?.trim())).toContain(
        expectedCancel,
      );
      expect(
        buttons.find((button) => button.querySelector("svg"))?.textContent,
      ).toBe(expectedClose);
      if (language === "pt-BR") {
        expect(content!.textContent).not.toMatch(/\b(Close|Cancel)\b/);
      }
    },
  );
});
