import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const inheritedProcessEnvironmentKeys = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "windir",
  "TEMP",
  "TMP",
];

/** Cria o ambiente mínimo do build sem carregar proxy, segredo ou token externo. */
export function createBuildEnvironment(
  source = /** @type {Record<string, string | undefined>} */ (process.env),
) {
  /** @type {Record<string, string>} */
  const environment = {
    AUTH_TRUST_PROXY: "false",
    BETTER_AUTH_URL: "http://127.0.0.1:3000",
    DATABASE_URL:
      "postgresql://build-placeholder:build-placeholder@127.0.0.1:1/kastir",
    MASTER_EMAIL: "build@example.invalid",
    MASTER_FORCE_RESET: "false",
    MASTER_PASSWORD: "build-placeholder",
    MCP_INTROSPECTION_CLIENT_ID: "",
    MCP_INTROSPECTION_CLIENT_SECRET: "",
    NEXTAUTH_SECRET: "build-only-placeholder-with-at-least-32-characters",
    // O marcador faz o loader do Next preservar este ambiente e não injetar .env.
    __NEXT_PROCESSED_ENV: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    REDIS_URL: "redis://:build-placeholder@127.0.0.1:1",
  };

  for (const key of inheritedProcessEnvironmentKeys) {
    if (source[key] !== undefined) environment[key] = source[key];
  }

  return environment;
}

const buildSteps = [
  [
    process.execPath,
    [resolve(projectRoot, "scripts/build-public-scripts.mjs")],
  ],
  [
    process.execPath,
    [resolve(projectRoot, "node_modules/next/dist/bin/next"), "build"],
  ],
];

/** Build hermética: reconhece somente as assinaturas do I/O absorvido de auth. */
export function hasKnownAuthBuildError(output) {
  if (/PrismaClientKnownRequestError|OauthResource/i.test(output)) return true;

  return /(?:Better Auth|better-auth)[\s\S]{0,2048}ECONNREFUSED|ECONNREFUSED[\s\S]{0,2048}(?:Better Auth|better-auth)/i.test(
    output,
  );
}

/** Gate de build: converte exit, signal e erro absorvido num resultado propagável. */
export function validateBuildResult(result) {
  if (result.signal) return { exitCode: 1, signal: result.signal };
  if (result.error) return { exitCode: 1, signal: null };
  if (result.status !== 0)
    return { exitCode: result.status ?? 1, signal: null };

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return hasKnownAuthBuildError(output)
    ? { exitCode: 1, signal: null }
    : { exitCode: 0, signal: null };
}

/** Build de produção: executa scripts públicos e Next sem shell ou infraestrutura. */
export function runProductionBuild(spawn = spawnSync) {
  const buildEnvironment = createBuildEnvironment();

  for (const [command, args] of buildSteps) {
    const result = spawn(command, args, {
      cwd: projectRoot,
      encoding: "utf8",
      env: buildEnvironment,
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) process.stderr.write(`${result.error.message}\n`);

    const outcome = validateBuildResult(result);
    if (outcome.exitCode !== 0 || outcome.signal) return outcome;
  }

  return { exitCode: 0, signal: null };
}

/** CLI do gate: mantém o processo chamador como dono do exit code ou signal. */
function finishBuild(outcome) {
  if (outcome.signal) {
    process.kill(process.pid, outcome.signal);
    return;
  }

  process.exitCode = outcome.exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  finishBuild(runProductionBuild());
}
