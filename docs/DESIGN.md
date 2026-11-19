# Ui — Style Reference
> clinical blueprint on frosted paper (light) — the same blueprint under blackout glass (dark)

**Theme:** light + dark. O tema inicial segue a preferência do sistema/navegador do usuário (`prefers-color-scheme`); um ícone de alternância (sol/lua) na Barra Superior do painel (ver [`features/PANEL.md`](./features/PANEL.md)) permite sobrepor essa escolha manualmente, persistindo a preferência entre sessões. Implementação sugerida: [`next-themes`](https://github.com/pacocoursey/next-themes) com `attribute="class"` e `defaultTheme="system"` (ver [`STACK.md`](./STACK.md)).

shadcn/ui é um workshop de design system quase monocromático: fundo branco puro (ou preto puro no escuro), superfícies em cinza morno suave, e cards de raio grande flutuando sobre bordas hairline. A interface é quase inteiramente acromática — texto preto, superfícies claras, tons secundários em cinza — com um único vermelho destrutivo reservado exclusivamente para estados de erro/exclusão, nunca para decoração. A tipografia se apoia na neutralidade geométrica do Geist, com tracking apertado nos tamanhos de destaque, criando uma sensação discreta, próxima de "infraestrutura de desenvolvedor" — não de produto de consumo. O tema escuro segue exatamente a mesma lógica estrutural, apenas invertendo a relação de luminância entre camadas (Canvas/Paper trocam de posição na escala clara↔escura), sem introduzir nenhuma cor nova.

## Theming — Claro/Escuro

- **Origem da preferência:** no primeiro acesso, o tema é definido pela media query `prefers-color-scheme` do navegador/SO do usuário — sem pergunta, sem tela de configuração.
- **Alternância manual:** um ícone de sol/lua (componente **Theme Toggle**, ver Componentes abaixo) sobrepõe essa detecção automática. A escolha manual é persistida (ex: `localStorage`/cookie via `next-themes`) e prevalece sobre `prefers-color-scheme` até que o usuário limpe a preferência ou troque de dispositivo.
- **Escopo:** o tema afeta o **painel administrativo** e a **Barra Superior** sobreposta ao site publicado (ver `PANEL.md`) — nunca o conteúdo da página publicada em si, que é HTML solto do usuário, fora do controle de tema do Kastir.
- **Implementação técnica:** todos os tokens abaixo são variáveis CSS que resolvem para um valor **Light** ou **Dark** dependendo da classe `.dark` na raiz do documento (convenção `next-themes` + Tailwind v4, ver "Quick Start" no fim deste documento). Nenhum componente deve referenciar hex fixo diretamente no código — sempre o token semântico, para que o tema resolva sozinho.

## Tokens — Colors

| Name | Token | Light | Dark | Role |
|------|-------|-------|------|------|
| Canvas | `--color-canvas` | `#f5f5f5` | `#0a0a0a` | Page background, muted surface fills, secondary buttons — a camada mais externa |
| Paper | `--color-paper` | `#ffffff` | `#171717` | Card surfaces, popover backgrounds — a camada elevada, sempre um passo mais "clara" que o Canvas na direção do tema ativo |
| Surface Alt | `--color-surface-alt` | `#fafafa` | `#111111` | Sidebar background, variante sutil de card, estado de repouso de input — fica entre Canvas e Paper |
| Ink | `--color-ink` | `#0a0a0a` | `#fafafa` | Texto primário, headings, labels de botão, traço de ícone |
| Ink Soft | `--color-ink-soft` | `#171717` | `#e5e5e5` | Fundo de badge sólido (Badge — Solid), texto secundário sobre superfícies invertidas |
| Mid Gray | `--color-mid-gray` | `#737373` | `#a1a1a1` | Texto muted, placeholder, helper labels, ícones em repouso |
| Hairline | `--color-hairline` | `#e5e5e5` | `#262626` | Bordas, contorno de input, borda de card, borda de badge |
| Ember | `--color-ember` | `#e7000b` | `#ff6166` | Acento destrutivo/erro — texto ou ícone de excluir/remover/revogar. **Único hue cromático do sistema; nunca decorativo** (ver Componentes → Destructive Action) |

> **Correção de revisão:** a versão anterior deste documento descrevia Paper como usado em "primary button fills" e Ink Soft como "filled button backgrounds" — nenhum dos dois é verdade: o Primary Filled Button usa `--color-ink`, e o único uso real de Ink Soft é o fundo do Badge — Solid. A tabela acima já reflete o uso real, conferido componente a componente. Também havia uma contradição entre a linha do Ember (que dizia "decorative accent... not a status color") e a seção Destructive Action/Do's-Don'ts (que dizem o oposto, três vezes: "exclusively in destructive or error contexts... never decorates"). Resolvido a favor da regra destrutiva-only, que é a mais repetida e a mais restritiva — mais fácil de relaxar depois do que corrigir um vazamento de cor pelo sistema todo.

## Tokens — Typography

### Geist — All interface text — body at 14px/400, headings ranging 24–48px/600, buttons at 13–14px/500. Geist's geometric letterforms and uniform stroke width create a developer-tool neutrality; weight 600 at 48px with -0.05em tracking produces tight, confident display headlines that feel engineered rather than editorial. · `--font-geist`
- **Substitute:** Inter
- **Weights:** 400, 500, 600
- **Sizes:** 12, 13, 14, 16, 18, 24, 30, 36, 48
- **Line height:** 1.10, 1.11, 1.20, 1.33, 1.43, 1.50, 1.56, 1.63, 2.00
- **Letter spacing:** -0.0500em at display (48px), -0.0250em at subheading (24–30px), 0.0500em at caption (12px uppercase). Tracking tightens aggressively at large sizes and loosens slightly at small uppercase labels.
- **OpenType features:** `"ss01" on, "cv11" on`
- **Role:** All interface text — body at 14px/400, headings ranging 24–48px/600, buttons at 13–14px/500. Tipografia idêntica em ambos os temas — só a cor do texto (`--color-ink`) muda.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 12px | 1.33 | 0.6px | `--text-caption` |
| body | 14px | 1.43 | — | `--text-body` |
| body-lg | 16px | 1.5 | — | `--text-body-lg` |
| subheading | 18px | 1.56 | — | `--text-subheading` |
| heading-sm | 24px | 1.33 | -0.6px | `--text-heading-sm` |
| heading | 30px | 1.2 | -0.75px | `--text-heading` |
| heading-lg | 36px | 1.11 | -0.9px | `--text-heading-lg` |
| display | 48px | 1.1 | -2.4px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** compact

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 48 | 48px | `--spacing-48` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 24px |
| small | 6px |
| badges | 18px |
| inputs | 18px |
| nested | 10px |
| buttons | 18px |

### Shadows

| Name | Light | Dark | Token |
|------|-------|------|-------|
| subtle | `oklab(0.145 -0.00000143796 0.00000340492 / 0.05) 0px 0px 0px 1px, rgba(0,0,0,0.1) 0px 1px 3px, rgba(0,0,0,0.1) 0px 1px 2px -1px` | mesma fórmula, mas quase invisível sobre fundo escuro — ver nota abaixo | `--shadow-subtle` |
| subtle-2 | `lab(2.75381 0 0) 0px 0px 0px 0px` (efetivamente nulo — variante "sem sombra") | idem | `--shadow-subtle-2` |

> **Nota — sombra em dark mode:** sombras baseadas em preto (`rgba(0,0,0,...)`) praticamente somem sobre um Canvas já escuro (`#0a0a0a`). No tema escuro, a elevação deve depender majoritariamente do **contraste Paper/Canvas** (`#171717` sobre `#0a0a0a`) e da borda **Hairline**, não da sombra. Não é necessário duplicar os tokens de shadow por tema — apenas não contar com eles para comunicar elevação no escuro.

### Layout

- **Page max-width:** 1280px
- **Section gap:** 48-80px
- **Card padding:** 20px
- **Element gap:** 8px

## Components

### Primary Filled Button
**Role:** High-emphasis action (Submit, Save, Create)

- **Light:** background `--color-ink` (`#0a0a0a`), text `#fafafa`.
- **Dark:** background `--color-ink` (`#fafafa`), text `#0a0a0a` — inversão total, mesma lógica de "tom mais forte contra o Canvas".

Border none, radius 18px, padding 0px 12px (compact) ou 8px 16px (comfortable), font 14px Geist weight 500. Altura ≈ 36–40px. A inversão claro-sobre-escuro (ou escuro-sobre-claro) é a única interação cromática do sistema em qualquer tema; o raio totalmente arredondado (18px numa altura de ~36px) produz uma geometria de pílula perfeita.

### Secondary Ghost Button
**Role:** Low-emphasis action (Cancel, Back)

- **Light:** background `--color-canvas` (`#f5f5f5`), texto `--color-ink` (`#0a0a0a`).
- **Dark:** background `--color-canvas` (`#0a0a0a`)... na prática precisa de um passo a mais que o Canvas para não se confundir com o fundo — usar `--color-surface-alt` (`#111111`), texto `--color-ink` (`#fafafa`).

Sem borda, radius 18px, padding 0px 12px ou 8px 16px, font 14px weight 500.

### Outline Button
**Role:** Tertiary action with visible boundary

- **Light:** fundo transparente, texto `--color-ink` (`#0a0a0a`), borda 1px `--color-hairline` (`#e5e5e5`).
- **Dark:** fundo transparente, texto `--color-ink` (`#fafafa`), borda 1px `--color-hairline` (`#262626`).

Radius 18px, padding 0px 12px ou 8px 10px. A borda hairline define o formato sem peso — preferida quando o botão está dentro de um card ou ao lado de controles preenchidos.

### Card
**Role:** Content container for blocks, previews, dashboard panels

- **Light:** fundo `--color-paper` (`#ffffff`), borda 1px `--color-hairline` (`#e5e5e5`), sombra `oklab(0.145/.05) 0 0 0 1px + rgba(0,0,0,0.1) 0 1px 3px + rgba(0,0,0,0.1) 0 1px 2px -1px`.
- **Dark:** fundo `--color-paper` (`#171717`), borda 1px `--color-hairline` (`#262626`), sombra praticamente imperceptível (ver nota de Shadows) — a separação visual vem quase inteiramente do par borda + contraste com o Canvas escuro.

Radius 24px, padding 20px.

### Nested Card Header/Footer
**Role:** Header or footer strip inside a card

Raio assimétrico — cantos superiores 24px no header, cantos inferiores 24px no footer. Padding 20px horizontal, fundo transparente (herda o Paper do card em ambos os temas). Sem mudança entre temas além do fundo herdado.

### Input Field
**Role:** Text entry, search, form controls

- **Light:** fundo `--color-canvas` (`#f5f5f5`) em repouso ou transparente (inline), texto `--color-ink` (`#0a0a0a`), sem borda em repouso, 1px `--color-hairline` (`#e5e5e5`) no foco.
- **Dark:** fundo `--color-surface-alt` (`#111111`) em repouso, texto `--color-ink` (`#fafafa`), 1px `--color-hairline` (`#262626`) no foco.

Radius 18px, padding 8px 10px, font 14px weight 400.

### Badge — Solid
**Role:** Tag, status pill, counter

- **Light:** fundo `--color-ink-soft` (`#171717`), texto `#fafafa`.
- **Dark:** fundo `--color-ink-soft` (`#e5e5e5`), texto `#0a0a0a` — o badge sólido continua sendo o par mais escuro-contra-claro (ou claro-contra-escuro) disponível, só troca de lado.

Radius 18px, padding 2px 8px, font 12px weight 500.

### Badge — Soft
**Role:** Neutral label, category tag

- **Light:** fundo `--color-canvas` (`#f5f5f5`), texto `--color-ink-soft` (`#171717`).
- **Dark:** fundo `--color-surface-alt` (`#111111`), texto `--color-ink-soft` (`#e5e5e5`).

Radius 18px, padding 2px 8px, font 12px weight 500.

### Badge — Outline
**Role:** Subtle tag with no fill

- **Light:** transparente, texto `--color-ink` (`#0a0a0a`).
- **Dark:** transparente, texto `--color-ink` (`#fafafa`).

Radius 18px, padding 2px 8px. A tag de peso mais leve — usada quando o rótulo é informativo, não categórico.

### Sidebar Surface
**Role:** Left navigation panel

- **Light:** fundo `--color-surface-alt` (`#fafafa`) — um passo tonal acima do Canvas (`#f5f5f5`).
- **Dark:** fundo `--color-surface-alt` (`#111111`) — um passo tonal acima do Canvas (`#0a0a0a`).

Altura total, largura contida, sem linha divisória — a diferenciação é só tonal em ambos os temas.

### Breadcrumb Trail
**Role:** Hierarchical path indicator

Texto inline com separadores em chevron, font 14px weight 400. Cor `--color-mid-gray` (`#737373` claro / `#a1a1a1` escuro) para separadores, `--color-ink` (`#0a0a0a` claro / `#fafafa` escuro) para o segmento atual. Sem fundo, sem bordas.

### Stat Block
**Role:** Large numeric metric display

Label em 12–14px uppercase `--color-mid-gray`, valor em 30–48px weight 600 `--color-ink` com tracking apertado. Texto de progresso/comparação em 14px `--color-mid-gray`. O bloco depende só da escala tipográfica — sem chrome de card — para estabelecer a métrica, em qualquer tema.

### Search Trigger
**Role:** Command palette / search input

- **Light:** fundo `--color-canvas` (`#f5f5f5`), texto `--color-mid-gray` (`#737373`).
- **Dark:** fundo `--color-surface-alt` (`#111111`), texto `--color-mid-gray` (`#a1a1a1`).

Radius 18px, padding 8px 10px, com indicador de atalho de teclado (ex: ⌘K) alinhado à direita.

### Destructive Action
**Role:** Delete, remove, revoke — error-adjacent interactions

Texto ou ícone em `--color-ember` (`#e7000b` claro / `#ff6166` escuro — mais claro no escuro para manter contraste sobre `#0a0a0a`). O vermelho é o único hue cromático do sistema e aparece **exclusivamente** em contextos destrutivos ou de erro — nunca decora, em nenhum dos dois temas.

### Theme Toggle
**Role:** Alterna entre tema claro e escuro

Ícone-botão (sol para "mudar para escuro", lua para "mudar para claro" — mostra o estado *alvo*, não o atual, seguindo a convenção mais comum). Mesmas dimensões de um ícone de ação na Barra Superior (~32–36px de área de toque), sem borda, sem fundo em repouso; hover usa `--color-canvas`/`--color-surface-alt` conforme o tema ativo. Um terceiro estado "Sistema" (segue `prefers-color-scheme`) pode existir como opção adicional além de Claro/Escuro explícitos, mas o ícone único sol/lua já cobre o caso de uso principal: alternância manual direta. Vive na Barra Superior do painel (ver `features/PANEL.md`).

## Do's and Don'ts

### Do
- Use #0a0a0a sobre #ffffff (claro) / #fafafa sobre #0a0a0a (escuro) para botões preenchidos — a inversão tonal é o único tratamento de ação primária, em qualquer tema.
- Mantenha radius 18px em botões, inputs e badges; 24px só em cards — vale para os dois temas, o raio nunca muda entre eles.
- Sempre referencie o **token semântico** (`--color-ink`, `--color-canvas` etc.), nunca hex fixo, para que um componente resolva sozinho em ambos os temas.
- Reserve `--color-ember` exclusivamente para estados destrutivos; nunca para decoração, marca, ou ênfase não-relacionada a erro — em claro ou escuro.
- No tema escuro, dependa da borda Hairline + contraste Paper/Canvas para comunicar elevação — sombras pretas quase não aparecem sobre fundo escuro.
- Teste toda tela nova nos dois temas antes de considerar pronta — um componente com hex fixo "vaza" no tema escuro de forma silenciosa (sem erro, só ilegível).
- Use #f5f5f5/#fafafa (claro) ou #0a0a0a/#111111 (escuro) para superfícies secundárias e inputs — a pilha de três tons (Canvas → Alt → Paper) cria camadas sem bordas, nos dois sentidos.

### Don't
- Não introduza cores de marca cromáticas além de `--color-ember` — a paleta acromática é o sistema, em claro e escuro.
- Não use valores de border-radius fora de 18px (interativo) ou 24px (containers); evite cantos quadrados em qualquer elemento.
- Não pule a borda hairline de 1px nos cards — a sombra sozinha não define a borda do card neste sistema, e no escuro a sombra sozinha não define nada.
- Não deixe texto do corpo abaixo de 14px ou mais claro que `--color-mid-gray` — a escala tipográfica é deliberadamente compacta.
- Não aplique gradientes, sombras coloridas, ou preenchimentos de acento — toda superfície é um tom sólido, nos dois temas.
- Não use letter-spacing mais largo que 0.05em nem mais apertado que -0.05em.
- Não misture botões preenchidos e outline do mesmo tamanho numa única linha sem ritmo visual — alterne variantes ghost ou secondary.
- Não hardcode um hex "que funciona no claro" dentro de um componente — é a causa mais comum de bug visual quando o usuário troca de tema.

## Surfaces

| Level | Name | Light | Dark | Purpose |
|-------|------|-------|------|---------|
| 0 | Canvas | `#f5f5f5` | `#0a0a0a` | Page background, camada mais ampla |
| 1 | Sidebar | `#fafafa` | `#111111` | Superfície de navegação, um passo além do Canvas |
| 2 | Card | `#ffffff` | `#171717` | Container de conteúdo primário, a superfície mais "elevada" |
| 3 | Input Fill | `#f5f5f5` | `#111111` | Input em repouso — combina com o Canvas/Surface Alt do tema ativo |

## Elevation

- **Card:** `0 0 0 1px rgba(23,23,23,0.05), 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` — no escuro, essa sombra é quase invisível; a elevação real vem do contraste Paper/Canvas + Hairline (ver nota em Shadows).
- **Button (filled):** `none — relies on tonal contrast, not shadow` — vale para os dois temas.
- **Input (focus):** `1px solid var(--color-hairline), no offset shadow` — resolve para `#e5e5e5` (claro) ou `#262626` (escuro).

## Imagery

Imagética mínima — o sistema é quase inteiramente UI. Sem fotografia hero, sem ilustrações, sem gráficos decorativos. Ícones são traços geométricos finos (linhagem Lucide) em 1.5–2px de stroke, na cor `--color-ink` ou `--color-mid-gray` — resolvendo para `#0a0a0a`/`#737373` no claro e `#fafafa`/`#a1a1a1` no escuro. A linguagem visual É os próprios componentes de UI — a página funciona como um guia de estilo vivo, em qualquer um dos dois temas.

## Agent Prompt Guide

**Quick Color Reference**

| Papel | Light | Dark |
|---|---|---|
| Canvas/background | `#f5f5f5` | `#0a0a0a` |
| Card/surface | `#ffffff` | `#171717` |
| Primary text | `#0a0a0a` | `#fafafa` |
| Muted text | `#737373` | `#a1a1a1` |
| Border | `#e5e5e5` | `#262626` |
| Primary action (fill) | `#0a0a0a` | `#fafafa` |
| Destructive | `#e7000b` | `#ff6166` |

**Example Component Prompts**

1. Create a dashboard stat card: light — white (#ffffff) background, 24px radius, 1px solid #e5e5e5 border, 20px padding, label 12px uppercase #737373, value 36px Geist weight 600 #0a0a0a. Dark — mesma estrutura com fundo #171717, borda #262626, label #a1a1a1, valor #fafafa.

2. Create a filled primary button: light — background #0a0a0a, text #fafafa. Dark — background #fafafa, text #0a0a0a. Ambos: sem borda, 18px radius, padding 0px 12px, font 14px Geist weight 500, altura 36px, sem sombra.

3. Create a ghost secondary button: light — background #f5f5f5, text #0a0a0a. Dark — background #111111, text #fafafa. Mesmas dimensões do botão preenchido para paridade visual.

4. Create an input field: light — background #f5f5f5, text #0a0a0a, placeholder #737373. Dark — background #111111, text #fafafa, placeholder #a1a1a1. Sem borda em repouso, 18px radius, padding 8px 10px, foco com anel 1px na cor de Hairline do tema ativo.

5. Create a destructive icon button (delete/remove): light — ícone #e7000b. Dark — ícone #ff6166. Nunca use essa cor fora de contexto destrutivo/erro.

## Design Philosophy

shadcn/ui é construído sobre três princípios visíveis em cada token, preservados nos dois temas: (1) acromático por padrão — cor é ausência, não expressão, com uma única exceção destrutiva; (2) raio define hierarquia — 18px para elementos interativos, 24px para containers, nunca algo intermediário; (3) elevação é sussurrada — no claro, a sombra do card é quase imperceptível; no escuro, ela desaparece quase por completo e a hierarquia passa a depender do par borda+contraste tonal. O sistema é desenhado para ser copiado, modificado e possuído — todo valor é explícito, todo token é simples, e a troca de tema é uma resolução de variável, não uma reesquematização visual.

## Similar Brands

- **Vercel** — Mesma paleta monocromática, mesmo pareamento Geist/sans geométrico, mesmos botões em formato de pílula com tracking apertado no texto de destaque; mesmo padrão de dark mode via `prefers-color-scheme` + toggle manual
- **Linear** — Abordagem idêntica de UI monocromática com acento único para estados destrutivos, tracking tipográfico apertado, cards com borda hairline — em ambos os temas
- **Radix UI** — Mesma linguagem visual "developer tool" — superfícies neutras, tipografia geométrica, layout de documentação component-first
- **Tailwind UI** — Paleta restrita equivalente, mesma escala de border-radius (raios grandes em containers), chrome mínimo
- **Cal.com** — Mesma densidade compacta, mesmo sistema de pill-badge, mesma abordagem acromática-primeiro com vermelho reservado a erros

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors — Light (default) */
  --color-canvas: #f5f5f5;
  --color-paper: #ffffff;
  --color-surface-alt: #fafafa;
  --color-ink: #0a0a0a;
  --color-ink-soft: #171717;
  --color-mid-gray: #737373;
  --color-hairline: #e5e5e5;
  --color-ember: #e7000b;

  /* Typography — Font Families */
  --font-geist: 'Geist', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.33;
  --tracking-caption: 0.6px;
  --text-body: 14px;
  --leading-body: 1.43;
  --text-body-lg: 16px;
  --leading-body-lg: 1.5;
  --text-subheading: 18px;
  --leading-subheading: 1.56;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.33;
  --tracking-heading-sm: -0.6px;
  --text-heading: 30px;
  --leading-heading: 1.2;
  --tracking-heading: -0.75px;
  --text-heading-lg: 36px;
  --leading-heading-lg: 1.11;
  --tracking-heading-lg: -0.9px;
  --text-display: 48px;
  --leading-display: 1.1;
  --tracking-display: -2.4px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-48: 48px;

  /* Layout */
  --page-max-width: 1280px;
  --section-gap: 48-80px;
  --card-padding: 20px;
  --element-gap: 8px;

  /* Border Radius */
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 14px;
  --radius-2xl: 18px;
  --radius-3xl: 24px;

  /* Named Radii */
  --radius-cards: 24px;
  --radius-small: 6px;
  --radius-badges: 18px;
  --radius-inputs: 18px;
  --radius-nested: 10px;
  --radius-buttons: 18px;

  /* Shadows */
  --shadow-subtle: oklab(0.145 -0.00000143796 0.00000340492 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px;
  --shadow-subtle-2: lab(2.75381 0 0) 0px 0px 0px 0px;

  /* Surfaces */
  --surface-canvas: #f5f5f5;
  --surface-sidebar: #fafafa;
  --surface-card: #ffffff;
  --surface-input-fill: #f5f5f5;
}

/* Colors — Dark (aplicado via next-themes: <html class="dark">) */
.dark {
  --color-canvas: #0a0a0a;
  --color-paper: #171717;
  --color-surface-alt: #111111;
  --color-ink: #fafafa;
  --color-ink-soft: #e5e5e5;
  --color-mid-gray: #a1a1a1;
  --color-hairline: #262626;
  --color-ember: #ff6166;

  --surface-canvas: #0a0a0a;
  --surface-sidebar: #111111;
  --surface-card: #171717;
  --surface-input-fill: #111111;
}
```

### Tailwind v4

```css
/* Registra a variante `dark:` para responder à classe .dark (next-themes),
   em vez do padrão media-query-only do Tailwind v4 */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* Colors — valores base (light); overrides de .dark ficam no bloco :root/.dark acima,
     já que @theme não suporta seletores condicionais diretamente */
  --color-canvas: #f5f5f5;
  --color-paper: #ffffff;
  --color-surface-alt: #fafafa;
  --color-ink: #0a0a0a;
  --color-ink-soft: #171717;
  --color-mid-gray: #737373;
  --color-hairline: #e5e5e5;
  --color-ember: #e7000b;

  /* Typography */
  --font-geist: 'Geist', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.33;
  --tracking-caption: 0.6px;
  --text-body: 14px;
  --leading-body: 1.43;
  --text-body-lg: 16px;
  --leading-body-lg: 1.5;
  --text-subheading: 18px;
  --leading-subheading: 1.56;
  --text-heading-sm: 24px;
  --leading-heading-sm: 1.33;
  --tracking-heading-sm: -0.6px;
  --text-heading: 30px;
  --leading-heading: 1.2;
  --tracking-heading: -0.75px;
  --text-heading-lg: 36px;
  --leading-heading-lg: 1.11;
  --tracking-heading-lg: -0.9px;
  --text-display: 48px;
  --leading-display: 1.1;
  --tracking-display: -2.4px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-48: 48px;

  /* Border Radius */
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 14px;
  --radius-2xl: 18px;
  --radius-3xl: 24px;

  /* Shadows */
  --shadow-subtle: oklab(0.145 -0.00000143796 0.00000340492 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px;
  --shadow-subtle-2: lab(2.75381 0 0) 0px 0px 0px 0px;
}

/* Overrides de tema escuro — mesmos nomes de variável, valores trocados.
   Combinado com o @custom-variant acima, `dark:bg-canvas` etc. funcionam normalmente. */
.dark {
  --color-canvas: #0a0a0a;
  --color-paper: #171717;
  --color-surface-alt: #111111;
  --color-ink: #fafafa;
  --color-ink-soft: #e5e5e5;
  --color-mid-gray: #a1a1a1;
  --color-hairline: #262626;
  --color-ember: #ff6166;
}
```
