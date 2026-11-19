/**
 * Contrato de CSS do destaque do tour guiado (fase 4, T5, spec A6).
 *
 * O `GuidedTour` só aplica o atributo `data-tour-current="true"` no item do passo
 * (`guided-tour-state.test.ts` prova isso); quem torna esse atributo visível é a regra global de
 * `app/globals.css`. Este teste lê o CSS-fonte e trava os pontos que o design exige, sem
 * renderizar: seletor único, anel de 2 px em `--ring` com 2 px de deslocamento em `--background`,
 * raio do `rounded-md`, transição do anel anulada, nenhuma animação e nenhuma declaração que
 * esconda o foco do teclado.
 *
 * Transição do anel anulada: o `Button` traz `transition-all` (camada `utilities`), que vence a
 * camada `components` e fazia o anel do botão "Mais" surgir com fade de 150 ms. A regra declara
 * `transition-property` com `!important`, que em camada inverte a precedência e vence o utilitário.
 * A lista não tem `box-shadow` (o anel), mas mantém cor, fundo e borda, então o fade de hover e de
 * foco do item destacado continua. Só a propriedade é sobrescrita (nunca o atalho `transition` nem
 * duração/curva), para o item manter o tempo que já tem. Ela é a única declaração autorizada a
 * usar `!important`: no `box-shadow` o utilitário de foco precisa vencer. O seletor é exato, então
 * botões fora do tour não são afetados.
 *
 * Limite deste teste: lê o CSS-fonte e não mede a cascata. A anulação efetiva foi conferida num
 * navegador real com o CSS compilado do projeto (ver relatório da correção do R3).
 *
 * A prova visual (claro/escuro, 768 e 1024 px) cobre o que o CSS-fonte não mostra: contraste e
 * o foco real do teclado sobre o item destacado.
 *
 * Mutação: os testes de "contrato quebra" alteram o CSS lido, em memória, e exigem que a mesma
 * checagem reprove. Sem isso, um contrato que sempre passa não seria detectado.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const GLOBALS_CSS_PATH = fileURLToPath(
  new URL("../app/globals.css", import.meta.url),
);
const TOUR_SELECTOR = '[data-tour-current="true"]';

// --- Leitura mínima de CSS -----------------------------------------------------------------
// ponytail: parser por chaves balanceadas, sem at-rules aninhadas dentro de regras nem `{` em
// strings; trocar por postcss se o globals.css passar a usar CSS nesting.

/** Remove comentários para que a documentação do arquivo não conte como regra. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Corpos (texto entre as chaves) de todo bloco cujo cabeçalho é exatamente `header`, ou seja,
 * começa um bloco (início, `{`, `}` ou `;` antes) e termina na `{`. Seletores compostos
 * (`a, [data-tour-current]`) ou com pseudo-classe não casam, de propósito.
 */
function blockBodies(css: string, header: string): string[] {
  const bodies: string[] = [];
  let from = 0;

  for (;;) {
    const at = css.indexOf(header, from);
    if (at === -1) return bodies;

    const open = css.indexOf("{", at + header.length);
    if (open === -1) return bodies;

    const before = css.slice(0, at);
    const previousBoundary = Math.max(
      before.lastIndexOf("{"),
      before.lastIndexOf("}"),
      before.lastIndexOf(";"),
    );
    const startsBlock = before.slice(previousBoundary + 1).trim() === "";
    const endsAtBrace = css.slice(at + header.length, open).trim() === "";

    from = at + header.length;
    if (!startsBlock || !endsAtBrace) continue;

    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      else if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    bodies.push(css.slice(open + 1, cursor - 1));
    from = cursor;
  }
}

/** Declarações `propriedade: valor` de um corpo de regra, com espaços normalizados. */
function declarations(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration
      .slice(separator + 1)
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .trim();
    if (property) result.set(property, value);
  }
  return result;
}

// --- Contrato ------------------------------------------------------------------------------

/**
 * Propriedades que o item destacado precisa continuar transicionando (hover e foco do Button e
 * dos links): cor do texto, fundo e borda.
 */
const TRANSITION_KEEP = ["color", "background-color", "border-color"];

/**
 * Valores que nunca podem aparecer em `transition-property` na regra do tour: `box-shadow` é o
 * próprio anel (precisa surgir sem fade) e `all`/`none` reintroduzem o fade do anel ou matam o
 * fade de cor.
 */
const TRANSITION_FORBIDDEN = ["box-shadow", "all", "none"];

/** Separa `lista de propriedades !important` em lista e marca de `!important`. */
function parseTransitionProperty(value: string): {
  list: string[];
  important: boolean;
} {
  const important = /\s*!important$/i.test(value);
  const list = value
    .replace(/\s*!important$/i, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return { list, important };
}

/** Corpos das regras do tour dentro de `@layer components` (o contrato espera exatamente uma). */
function tourRuleBodies(css: string): string[] {
  return blockBodies(css, "@layer components").flatMap((layer) =>
    blockBodies(layer, TOUR_SELECTOR),
  );
}

/**
 * Violações do contrato do destaque do tour num CSS-fonte. Lista vazia = contrato cumprido.
 * Retorna mensagens em vez de lançar para que os testes de mutação provem que a checagem reprova.
 */
function tourRuleViolations(source: string): string[] {
  const css = stripComments(source);
  const violations: string[] = [];

  const mentions = css.split("data-tour-current").length - 1;
  if (mentions !== 1) {
    violations.push(
      `data-tour-current aparece ${mentions}x no CSS (esperado: uma única regra)`,
    );
  }

  const rules = tourRuleBodies(css);
  if (rules.length !== 1) {
    violations.push(
      `regra ${TOUR_SELECTOR} dentro de @layer components: ${rules.length} (esperado: 1)`,
    );
    return violations;
  }

  const body = rules[0];
  const props = declarations(body);

  if (
    props.get("box-shadow") !==
    "0 0 0 2px var(--background), 0 0 0 4px var(--ring)"
  ) {
    violations.push(
      `box-shadow deve ser anel de 2 px em --ring com deslocamento de 2 px em --background, veio: ${props.get("box-shadow") ?? "ausente"}`,
    );
  }
  if (props.get("border-radius") !== "var(--radius-md)") {
    violations.push(
      `border-radius deve ser var(--radius-md) (rounded-md), veio: ${props.get("border-radius") ?? "ausente"}`,
    );
  }

  // Transição do anel: só `transition-property`, com !important e sem `box-shadow`.
  const transitionProperty = props.get("transition-property");
  if (transitionProperty === undefined) {
    violations.push(
      "transition-property ausente: o transition-all do Button (utilities) faria o anel surgir com fade",
    );
  } else {
    const { list, important } = parseTransitionProperty(transitionProperty);
    if (!important) {
      violations.push(
        "transition-property precisa de !important para vencer o transition-all do Button (utilities)",
      );
    }
    for (const forbidden of TRANSITION_FORBIDDEN) {
      if (list.includes(forbidden)) {
        violations.push(
          `transition-property não pode conter ${forbidden}: o anel precisa surgir sem fade e a cor continua transicionando`,
        );
      }
    }
    for (const kept of TRANSITION_KEEP) {
      if (!list.includes(kept)) {
        violations.push(
          `transition-property precisa manter ${kept} transicionando (fade de hover e de foco do item destacado)`,
        );
      }
    }
  }

  for (const [property, value] of props) {
    if (/^animation/.test(property)) {
      violations.push(`a regra não pode declarar ${property} (sem movimento)`);
    }
    // O atalho `transition` zeraria duração e curva do item; os demais longhands mudariam o tempo.
    if (/^transition/.test(property) && property !== "transition-property") {
      violations.push(
        `a regra não pode declarar ${property}: só transition-property é sobrescrita, o tempo continua o do item`,
      );
    }
    if (/^outline/.test(property)) {
      violations.push(
        `a regra não pode declarar ${property}: esconderia o foco do teclado dos links`,
      );
    }
    if (/!important/i.test(value) && property !== "transition-property") {
      violations.push(
        `${property} não pode usar !important: o foco (utilitário) precisa vencer`,
      );
    }
  }

  return violations;
}

const globalsCss = readFileSync(GLOBALS_CSS_PATH, "utf8");

describe("destaque do passo do tour (app/globals.css)", () => {
  it("cumpre o contrato do design: anel --ring, deslocamento --background, rounded-md, transição anulada, sem animação", () => {
    expect(tourRuleViolations(globalsCss)).toEqual([]);
  });

  it("anula só a transição do anel: transition-property com !important, sem box-shadow, mantendo cor, fundo e borda", () => {
    const rules = tourRuleBodies(stripComments(globalsCss));

    expect(rules).toHaveLength(1);
    const props = declarations(rules[0]);
    const declared = props.get("transition-property");

    expect(declared).toBeDefined();
    const { list, important } = parseTransitionProperty(declared as string);

    // Vence o `transition-all` do Button (utilities) e vale em Topbar, BottomNav e "Mais".
    expect(important).toBe(true);
    // O anel (box-shadow) fica fora da lista, então surge sem fade; `all`/`none` também ficam de fora.
    for (const forbidden of TRANSITION_FORBIDDEN) {
      expect(list).not.toContain(forbidden);
    }
    // Cor, fundo e borda continuam transicionando (fade de hover e de foco do item destacado).
    expect(list).toEqual(expect.arrayContaining(TRANSITION_KEEP));
    // Só a propriedade é sobrescrita: sem atalho `transition` nem duração/curva/atraso.
    expect([...props.keys()].filter((p) => p.startsWith("transition"))).toEqual(
      ["transition-property"],
    );
    // `!important` fica restrito à transição: o box-shadow não pode impedir que o foco prevaleça.
    expect(
      [...props]
        .filter(([, value]) => /!important/i.test(value))
        .map(([p]) => p),
    ).toEqual(["transition-property"]);
  });

  it("usa tokens que existem no tema: --ring e --background no :root e --radius-md no tema", () => {
    const css = stripComments(globalsCss);
    const rootTokens = blockBodies(css, ":root").map(declarations);

    expect(rootTokens.some((tokens) => tokens.has("--ring"))).toBe(true);
    expect(rootTokens.some((tokens) => tokens.has("--background"))).toBe(true);
    expect(
      rootTokens.some((tokens) => tokens.get("--radius-md") === "6px"),
    ).toBe(true);
  });

  describe("mutação: o contrato reprova quando a regra é quebrada", () => {
    const rulePattern = /\[data-tour-current="true"\]\s*\{[^}]*\}/;

    /**
     * Aplica a mutação só no texto da regra do tour (não em ocorrências homônimas de `var(--ring)`
     * em outros pontos do arquivo, como o `--color-ring` do tema) e exige que algo tenha mudado.
     */
    function mutateRule(mutate: (rule: string) => string): string {
      const original = globalsCss.match(rulePattern)?.[0];
      expect(original).toBeDefined();
      const mutatedRule = mutate(original as string);
      expect(mutatedRule).not.toBe(original);
      return globalsCss.replace(original as string, mutatedRule);
    }

    function violationsContaining(css: string, fragment: string): string[] {
      return tourRuleViolations(css).filter((violation) =>
        violation.includes(fragment),
      );
    }

    it("sem a regra", () => {
      const mutated = mutateRule(() => "");
      expect(tourRuleViolations(mutated).length).toBeGreaterThan(0);
    });

    it("com o anel trocado para outra cor", () => {
      const mutated = mutateRule((rule) =>
        rule.replace("var(--ring)", "var(--primary)"),
      );
      expect(violationsContaining(mutated, "box-shadow")).not.toEqual([]);
    });

    it("com o deslocamento removido", () => {
      const mutated = mutateRule((rule) =>
        rule.replace("0 0 0 2px var(--background),", ""),
      );
      expect(violationsContaining(mutated, "box-shadow")).not.toEqual([]);
    });

    it("com outro raio", () => {
      const mutated = mutateRule((rule) =>
        rule.replace("var(--radius-md)", "var(--radius-xl)"),
      );
      expect(violationsContaining(mutated, "border-radius")).not.toEqual([]);
    });

    /** Substitui só a declaração `transition-property` da regra (aceita valor em várias linhas). */
    function replaceTransitionProperty(
      rule: string,
      replacement: (declaration: string) => string,
    ): string {
      return rule.replace(/transition-property:[^;]*;/, replacement);
    }

    it("sem transition-property (o anel voltaria a surgir com fade no Button)", () => {
      const mutated = mutateRule((rule) =>
        replaceTransitionProperty(rule, () => ""),
      );
      expect(
        violationsContaining(mutated, "transition-property ausente"),
      ).not.toEqual([]);
    });

    it("com transition-property sem !important (perderia para o transition-all do utilitário)", () => {
      const mutated = mutateRule((rule) =>
        replaceTransitionProperty(rule, (declaration) =>
          declaration.replace(/\s*!important/, ""),
        ),
      );
      expect(
        violationsContaining(mutated, "precisa de !important"),
      ).not.toEqual([]);
    });

    it("com transition-property: all (o anel voltaria a surgir com fade)", () => {
      const mutated = mutateRule((rule) =>
        replaceTransitionProperty(
          rule,
          () => "transition-property: all !important;",
        ),
      );
      expect(violationsContaining(mutated, "não pode conter all")).not.toEqual(
        [],
      );
    });

    it("com box-shadow na lista (o anel voltaria a transicionar)", () => {
      const mutated = mutateRule((rule) =>
        replaceTransitionProperty(rule, (declaration) =>
          declaration.replace(/\s*!important/, ", box-shadow !important"),
        ),
      );
      expect(
        violationsContaining(mutated, "não pode conter box-shadow"),
      ).not.toEqual([]);
    });

    it.each(TRANSITION_KEEP)(
      "sem %s na lista (o fade de hover e de foco do item destacado sumiria)",
      (kept) => {
        // Casa o item inteiro da lista (sem pegar `background-color` ao remover `color`) e a vírgula.
        const item = new RegExp(String.raw`(?<![-\w])${kept}(?![-\w])\s*,?\s*`);
        const mutated = mutateRule((rule) =>
          replaceTransitionProperty(rule, (declaration) =>
            declaration.replace(item, ""),
          ),
        );
        expect(
          violationsContaining(mutated, `precisa manter ${kept}`),
        ).not.toEqual([]);
      },
    );

    it("com o atalho transition: none (a versão anterior matava também o fade de cor)", () => {
      const mutated = mutateRule((rule) =>
        replaceTransitionProperty(rule, () => "transition: none !important;"),
      );
      expect(violationsContaining(mutated, "declarar transition:")).not.toEqual(
        [],
      );
    });

    it("com transition-duration solta na regra", () => {
      const mutated = mutateRule((rule) =>
        rule.replace("}", "transition-duration: 150ms;\n}"),
      );
      expect(
        violationsContaining(mutated, "declarar transition-duration"),
      ).not.toEqual([]);
    });

    it("com animation na regra", () => {
      const mutated = mutateRule((rule) =>
        rule.replace("}", "animation: pulse 1s infinite;\n}"),
      );
      expect(violationsContaining(mutated, "animation")).not.toEqual([]);
    });

    it("com outline na regra (esconderia o foco do teclado)", () => {
      const mutated = mutateRule((rule) =>
        rule.replace("}", "outline: none;\n}"),
      );
      expect(violationsContaining(mutated, "outline")).not.toEqual([]);
    });

    it("com !important fora da transição (no box-shadow esconderia o foco do Button)", () => {
      const mutated = mutateRule((rule) =>
        rule.replace(/(border-radius:[^;]*);/, "$1 !important;"),
      );
      expect(violationsContaining(mutated, "!important")).not.toEqual([]);

      const shadowMutated = mutateRule((rule) =>
        rule.replace(/(var\(--ring\));/, "$1 !important;"),
      );
      expect(violationsContaining(shadowMutated, "!important")).not.toEqual([]);
    });

    it("com o seletor ampliado a outros elementos (a anulação vazaria para botões fora do tour)", () => {
      const mutated = mutateRule((rule) => `button, ${rule}`);
      expect(violationsContaining(mutated, "@layer components")).not.toEqual(
        [],
      );
    });

    it("fora de @layer components (venceria os utilitários de foco)", () => {
      const mutated = globalsCss.replace(
        /@layer components\s*\{/,
        "@media all {",
      );
      expect(mutated).not.toBe(globalsCss);
      expect(violationsContaining(mutated, "@layer components")).not.toEqual(
        [],
      );
    });

    it("com uma segunda regra para o mesmo atributo", () => {
      const mutated = `${globalsCss}\n[data-tour-current="true"]:focus-visible { box-shadow: none; }\n`;
      expect(violationsContaining(mutated, "única regra")).not.toEqual([]);
    });
  });
});
