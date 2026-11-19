/**
 * Testes da classificação de bump de versão (scripts/auto-bump-version.mjs).
 *
 * Duas camadas:
 * - unidade: `classifyCommitMessages` sobre mensagens completas (título + corpo);
 * - integração: o CLI com `--dry-run` em repositório Git temporário, provando que
 *   a leitura de `git log --format=%B%x1e` entrega título e corpo à classificação.
 *
 * Regra provada (AGENTS.md, seção Versão): major com `!:` no título ou linha
 * `BREAKING CHANGE:` no corpo; minor com `feat:` no título ou no início de uma
 * linha do corpo; patch no resto.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { classifyCommitMessages } from "../scripts/auto-bump-version.mjs";

describe("classifyCommitMessages", () => {
  it("título task com linha feat: no corpo resulta em minor", () => {
    const message =
      "task(T1,T2,T3): switch No ar/Fora do ar\n\nSwitch publica e reativa.\n\nfeat: publicação pelo switch e histórico de versões no editor\n";
    expect(classifyCommitMessages([message])).toBe("minor");
  });

  it("linha feat(scope): no corpo resulta em minor", () => {
    expect(
      classifyCommitMessages(["task(T1): x\n\nfeat(pages): novo botão\n"]),
    ).toBe("minor");
  });

  it("título feat: e feat(scope): resultam em minor", () => {
    expect(classifyCommitMessages(["feat: algo novo"])).toBe("minor");
    expect(classifyCommitMessages(["feat(mcp): algo novo"])).toBe("minor");
  });

  it("linha BREAKING CHANGE: no corpo resulta em major", () => {
    const message =
      "task(T1): x\n\nDetalhes.\n\nBREAKING CHANGE: remove o campo legado\n";
    expect(classifyCommitMessages([message])).toBe("major");
  });

  it("linha BREAKING-CHANGE: no corpo resulta em major", () => {
    expect(
      classifyCommitMessages(["fix: x\n\nBREAKING-CHANGE: muda o contrato\n"]),
    ).toBe("major");
  });

  it("título com ! no tipo resulta em major", () => {
    expect(classifyCommitMessages(["feat!: muda a API"])).toBe("major");
    expect(classifyCommitMessages(["fix!: muda o schema"])).toBe("major");
    expect(classifyCommitMessages(["refactor(core)!: troca o contrato"])).toBe(
      "major",
    );
  });

  it("major vence minor mesmo em commits diferentes", () => {
    expect(
      classifyCommitMessages(["feat: a", "chore: b\n\nBREAKING CHANGE: c\n"]),
    ).toBe("major");
  });

  it("minor vence patch em qualquer posição do range", () => {
    expect(classifyCommitMessages(["fix: a", "feat: b", "fix: c"])).toBe(
      "minor",
    );
  });

  it("feature no meio de frase do corpo continua patch", () => {
    const message =
      "fix: ajusta o painel\n\nEsta feature já existia; não é feat: nova nem BREAKING CHANGE: real.\n";
    expect(classifyCommitMessages([message])).toBe("patch");
  });

  it("!: no corpo não promove major (só o título conta)", () => {
    expect(classifyCommitMessages(["fix: a\n\nfix!: citado no corpo\n"])).toBe(
      "patch",
    );
  });

  it("somente fix e chore resultam em patch", () => {
    expect(classifyCommitMessages(["fix: a", "chore: b", "docs: c"])).toBe(
      "patch",
    );
  });

  it("aceita mensagens com CRLF", () => {
    expect(classifyCommitMessages(["task(T1): x\r\n\r\nfeat: y\r\n"])).toBe(
      "minor",
    );
  });
});

describe("auto-bump-version --dry-run (git log real)", () => {
  const scriptPath = fileURLToPath(
    new URL("../scripts/auto-bump-version.mjs", import.meta.url),
  );
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Cria um repositório sem remote/upstream (o range cobre todo o histórico),
   * grava um commit por item (título + corpo opcional) e devolve o stdout do
   * CLI em `--dry-run`. Nada é commitado nem empurrado no repo do projeto.
   */
  function dryRun(commits: Array<{ title: string; body?: string }>): string {
    const dir = mkdtempSync(join(tmpdir(), "kastir-bump-"));
    tempDirs.push(dir);
    const run = (args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@test.local",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    run(["init", "-q", "-b", "main"]);
    for (const { title, body } of commits) {
      const message = body ? ["-m", title, "-m", body] : ["-m", title];
      run(["commit", "-q", "--allow-empty", "--no-verify", ...message]);
    }
    return execFileSync(process.execPath, [scriptPath, "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  it("commit task com feat: no corpo pede minor", () => {
    expect(
      dryRun([
        {
          title: "task(T1,T7): switch No ar/Fora do ar",
          body: "Switch publica e reativa.\n\nfeat: publicação pelo switch",
        },
      ]),
    ).toBe("need minor");
  });

  it("commit com BREAKING CHANGE: no corpo pede major", () => {
    expect(
      dryRun([
        {
          title: "task(T1): muda contrato",
          body: "BREAKING CHANGE: remove o campo legado",
        },
      ]),
    ).toBe("need major");
  });

  it("commit com feature em frase livre e só fix pede patch", () => {
    expect(
      dryRun([
        { title: "fix: a" },
        { title: "fix: b", body: "Esta feature já existia." },
      ]),
    ).toBe("need patch");
  });
});
