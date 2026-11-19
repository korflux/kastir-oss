#!/usr/bin/env node
/**
 * Bump SemVer em package.json conforme commits ainda não enviados.
 * Usado por scripts/git-push.mjs e .githooks/pre-push.
 *
 * Regra de classificação (AGENTS.md, seção Versão): o bump lê TÍTULO e CORPO de
 * cada commit não enviado. Ver `classifyCommitMessages`.
 *
 * stdout: "bumped <version>" | "skip <reason>" | "need <major|minor|patch>" (--dry-run)
 *
 * Importável sem efeito colateral: o fluxo de CLI só roda quando o arquivo é o
 * ponto de entrada (ver guard no fim), o que permite testar a classificação.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ============================================================================
// Classificação de commits (pura, sem Git)
// ============================================================================

/**
 * Separador entre commits no `git log` (`%x1e`, ASCII Record Separator).
 * Mensagens de commit têm quebras de linha, `---` e quase qualquer texto, mas
 * não 0x1e; o próprio git expande `%x1e`, então não há shell nem concatenação.
 */
const RECORD_SEPARATOR = "\x1e";

/** Título com `!` antes dos dois-pontos: `feat!:`, `fix(scope)!:` etc. */
const BREAKING_TITLE = /^[a-z]+(\([^)]*\))?!:/;

/**
 * Rodapé de breaking change (Conventional Commits): linha do corpo começando
 * por `BREAKING CHANGE:` ou `BREAKING-CHANGE:`, em maiúsculas. A âncora no
 * início da linha evita casar a expressão dentro de prosa.
 */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/** `feat:` / `feat(scope):` no início de uma linha (do título ou do corpo). */
const FEAT_LINE = /^feat(\([^)]*\))?:/m;

/**
 * Decide o tipo de bump a partir das mensagens completas (`%B`: título + corpo)
 * dos commits ainda não enviados.
 *
 * - major: algum título com `!:` no tipo, OU alguma linha de corpo `BREAKING CHANGE:`.
 * - minor: algum título `feat…:`, OU alguma linha do corpo começando com `feat…:`.
 * - patch: qualquer outro caso.
 *
 * Por que o corpo conta: commits de tarefa de fase têm título `task(T1..Tn): ...`
 * (sem tipo SemVer) e carregam o tipo real em uma linha do corpo, como
 * `feat: publicação pelo switch...`. Lendo só o título, o bump sairia patch.
 * As âncoras de início de linha impedem que "feature" ou "feat:" no meio de uma
 * frase de texto livre promova o bump.
 *
 * @param {string[]} messages mensagens completas dos commits (título + corpo)
 * @returns {"major" | "minor" | "patch"}
 */
export function classifyCommitMessages(messages) {
  let bump = "patch";
  for (const message of messages) {
    const text = message.trim();
    const title = text.split("\n", 1)[0];
    if (BREAKING_TITLE.test(title) || BREAKING_FOOTER.test(text)) {
      return "major";
    }
    if (FEAT_LINE.test(text)) bump = "minor";
  }
  return bump;
}

// ============================================================================
// Acesso ao Git
// ============================================================================

/**
 * Executa `git <args>` e devolve o stdout sem espaços nas pontas. Falha do git
 * (exit != 0) vira exceção: use onde um erro deve abortar o fluxo.
 *
 * `execFileSync` com `args` em array: sem shell e sem concatenar comando, então
 * ref ou SHA nunca é interpretado como sintaxe de shell. stdin ignorado e
 * stderr capturado (vai na exceção) para não poluir o stdout que o pre-push lê.
 *
 * @param {string[]} args argumentos do git, um por elemento
 * @returns {string}
 */
function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Variante tolerante de `git`: devolve `null` em vez de lançar quando o git
 * falha. Serve às consultas em que a falha é um estado esperado (branch sem
 * upstream, ref inexistente, repositório sem remoto) e o caller decide pelo
 * `null`, em vez de abortar o push.
 *
 * @param {string[]} args argumentos do git, um por elemento
 * @returns {string | null}
 */
function gitOk(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/**
 * Lê `package.json#version` como estava em `ref` (via `git show`, sem tocar a
 * worktree). Alimenta a detecção de bump já feito em `main`: comparar a versão
 * da base com a da ponta mostra se algum commit a serviu antes deste push.
 *
 * Devolve `null` quando o `package.json` não existe naquele ref ou não tem o
 * campo; o caller trata `null` como "não dá para afirmar que já foi bumpado".
 *
 * @param {string} ref commit, branch ou SHA
 * @returns {string | null}
 */
function readVersionAt(ref) {
  try {
    const raw = git(["show", `${ref}:package.json`]);
    const match = raw.match(/"version"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Descobre o commit-base do push: o ponto a partir do qual os commits contam
 * como "ainda não enviados" (o range de classificação é `base..HEAD`).
 *
 * 1. Branch com upstream: o SHA do upstream, que é o que o remoto já tem.
 * 2. Branch nova, sem upstream: entre os remotes `origin/*` (exceto `HEAD`),
 *    o merge-base mais recente por data de commit. Aproxima o ponto em que a
 *    branch nasceu, sem exigir upstream configurado.
 *
 * Devolve `null` quando não há remoto `origin` algum para comparar; então o
 * caller classifica todo o histórico alcançável a partir de `localSha`.
 *
 * @param {string} localSha SHA do HEAD local
 * @returns {string | null}
 */
function resolveBase(localSha) {
  const upstream = gitOk(["rev-parse", "--abbrev-ref", "@{upstream}"]);
  if (upstream) {
    const sha = gitOk(["rev-parse", upstream]);
    if (sha) return sha;
  }

  // Branch nova: ancestral comum mais recente entre remotes origin/*.
  let base = null;
  let baseDate = 0;
  const remotes = gitOk([
    "for-each-ref",
    "--format=%(refname)",
    "refs/remotes/origin",
  ]);
  if (!remotes) return null;
  for (const ref of remotes.split("\n").filter(Boolean)) {
    if (ref.endsWith("/HEAD")) continue;
    const candidate = gitOk(["merge-base", localSha, ref]);
    if (!candidate) continue;
    const date = Number(gitOk(["log", "-1", "--format=%ct", candidate]) || 0);
    if (date > baseDate) {
      baseDate = date;
      base = candidate;
    }
  }
  return base;
}

/**
 * Lê título + corpo (`%B`) de cada commit do range e classifica o bump.
 * Retorna null quando o range não tem commits (o caller emite "skip empty-range").
 */
function classifyBump(range) {
  const raw = gitOk(["log", "--format=%B%x1e", range]) ?? "";
  // Cada commit termina em RS; o último elemento do split é só o resto vazio.
  const messages = raw.split(RECORD_SEPARATOR).slice(0, -1);
  if (messages.length === 0) return null;
  return classifyCommitMessages(messages);
}

// ============================================================================
// Fluxo de CLI
// ============================================================================

/**
 * Fluxo de CLI do auto-bump: decide se este push precisa de bump de versão e,
 * quando precisa, cria o commit `chore: bump version to X` em `package.json`.
 * Chamado pelo `.githooks/pre-push` e por `scripts/git-push.mjs`.
 *
 * Etapas de decisão, na ordem; cada uma pode encerrar com `skip <motivo>`
 * (exit 0, o push segue sem bump):
 * 1. HEAD destacado: sem branch para versionar.
 * 2. Base igual ao HEAD: nada a enviar.
 * 3. Versão da base diferente da ponta: já bumpado, evita bump duplicado
 *    (ex.: `pnpm push` já rodou antes e o hook reexecuta no mesmo range).
 * 4. Range sem commits.
 * Depois, `package.json` com alteração não commitada aborta com exit 1, pois o
 * commit do bump levaria junto uma mudança que não é do bump.
 *
 * `--dry-run` só imprime `need <tipo>`. Sem ele, delega o incremento a
 * `bump-version.mjs`, faz `git add` só de `package.json` e commita com
 * `--no-verify` (commit mecânico, hooks de commit do ambiente não devem
 * interferir). Falha de qualquer subprocesso propaga o status e a mensagem.
 *
 * Contrato de stdout: uma única linha, que o pre-push interpreta (`bumped X`,
 * `skip …` ou `need …`). Diagnósticos vão para stderr.
 */
function main() {
  const dryRun = process.argv.includes("--dry-run");

  const branchRef = gitOk(["symbolic-ref", "-q", "HEAD"]);
  if (!branchRef) {
    console.log("skip detached-HEAD");
    process.exit(0);
  }

  const localSha = git(["rev-parse", "HEAD"]);
  const base = resolveBase(localSha);

  if (base && base === localSha) {
    console.log("skip nothing-to-push");
    process.exit(0);
  }

  if (base) {
    const baseVersion = readVersionAt(base);
    const tipVersion = readVersionAt(localSha);
    if (baseVersion && tipVersion && baseVersion !== tipVersion) {
      console.log("skip already-bumped");
      process.exit(0);
    }
  }

  const range = base ? `${base}..${localSha}` : localSha;
  const bump = classifyBump(range);
  if (!bump) {
    console.log("skip empty-range");
    process.exit(0);
  }

  const dirty = gitOk(["diff", "--name-only", "HEAD", "--", "package.json"]);
  if (dirty) {
    console.error(
      "[auto-bump] package.json has uncommitted changes — commit or stash them first.",
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log(`need ${bump}`);
    process.exit(0);
  }

  const bumped = spawnSync(
    process.execPath,
    ["scripts/bump-version.mjs", bump],
    { encoding: "utf8" },
  );
  if (bumped.status !== 0) {
    process.stderr.write(bumped.stderr || bumped.stdout || "bump failed\n");
    process.exit(bumped.status ?? 1);
  }
  const version = (bumped.stdout || "").trim();

  // stdio silencioso — o pre-push faz `case` em stdout e não pode ver lixo do git.
  const add = spawnSync("git", ["add", "package.json"], {
    encoding: "utf8",
  });
  if (add.status !== 0) {
    process.stderr.write(add.stderr || add.stdout || "git add failed\n");
    process.exit(add.status ?? 1);
  }

  const commit = spawnSync(
    "git",
    ["commit", "-q", "-m", `chore: bump version to ${version}`, "--no-verify"],
    { encoding: "utf8" },
  );
  if (commit.status !== 0) {
    process.stderr.write(
      commit.stderr || commit.stdout || "git commit failed\n",
    );
    process.exit(commit.status ?? 1);
  }

  // Única linha em stdout em caso de sucesso (o hook faz parse disso).
  console.log(`bumped ${version}`);
}

// Só executa o CLI quando este arquivo é o ponto de entrada. `realpathSync`
// nos dois lados evita falso negativo com symlink ou nome curto 8.3 no Windows
// (um guard que falha em silêncio faria o hook pular o bump sem aviso).
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
