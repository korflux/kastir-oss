#!/usr/bin/env node
/**
 * Push com bump de versão antes — exit code limpo (sem o falso
 * "failed to push some refs" do pre-push antigo).
 *
 * Uso: pnpm push
 *      pnpm push -- origin homolog
 *      node scripts/git-push.mjs origin HEAD:homolog
 */
import { spawnSync } from "node:child_process";

const pushArgs = process.argv.slice(2);

const bump = spawnSync(process.execPath, ["scripts/auto-bump-version.mjs"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (bump.status !== 0) process.exit(bump.status ?? 1);

const out = (bump.stdout || "").trim();
if (out.startsWith("bumped ")) {
  console.log(`[push] ${out.replace("bumped ", "version → ")}`);
}

// Bump (se houve) já está no HEAD; o pre-push só valida e deixa o push seguir.
const push = spawnSync("git", ["push", ...pushArgs], {
  stdio: "inherit",
  env: process.env,
});
process.exit(push.status ?? 1);
