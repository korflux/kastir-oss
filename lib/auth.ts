import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";

import { env } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/Modules/Auth/Password";
import {
  getMcpIssuerUrl,
  getMcpResourceUrl,
  MCP_SCOPES,
} from "@/lib/Modules/Mcp/Scopes";
import { prisma } from "@/lib/prisma";

const enumerationLogPatterns = [
  /user not found/i,
  /invalid password/i,
  /invalid email or password/i,
];

function isEnumerationLog(message: string): boolean {
  return enumerationLogPatterns.some((pattern) => pattern.test(message));
}

/** Auth runtime: monta adapters e plugins somente quando algum caller usa a instância. */
function createAuth() {
  return betterAuth({
    appName: "Kastir",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.NEXTAUTH_SECRET,
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: true,
          defaultValue: "ADMIN",
          input: false,
        },
        isMaster: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      customRules: {
        // A rota HTTP já aplica a política central por e-mail e IP confiável;
        // manter o bucket interno por caminho bloquearia usuários distintos.
        "/sign-in/email": false,
      },
    },
    plugins: [
      jwt({
        jwt: { issuer: getMcpIssuerUrl(env.BETTER_AUTH_URL) },
      }),
      oauthProvider({
        loginPage: "/admin/login",
        consentPage: "/admin/mcp/consent",
        scopes: [...MCP_SCOPES, "offline_access"],
        disableJwtPlugin: true,
        storeClientSecret: "encrypted",
        // DCR anônimo fica: Claude/Codex se registram sozinhos (spec fase 23).
        // Identidade do client não é confiável — a tela de consent marca DCR.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [
          {
            identifier: getMcpResourceUrl(env.BETTER_AUTH_URL),
            name: "Kastir MCP",
            allowedScopes: [...MCP_SCOPES, "offline_access"],
          },
        ],
        // Há um único resource MCP e a borda exige esse valor; DCR padrão não
        // envia a extensão proprietária de vínculo cliente-resource do provider.
        enforcePerClientResources: false,
      }),
    ],
    logger: {
      level: "warn",
      log(level, message, ...args) {
        // Avoid logging messages that distinguish missing users from bad passwords.
        const safeMessage = isEnumerationLog(message)
          ? "Authentication attempt failed"
          : message;

        if (level === "error") {
          console.error(`[Better Auth]: ${safeMessage}`, ...args);
          return;
        }

        if (level === "warn") {
          if (isEnumerationLog(message)) {
            return;
          }
          console.warn(`[Better Auth]: ${safeMessage}`, ...args);
          return;
        }

        console.log(`[Better Auth]: ${safeMessage}`, ...args);
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;

/** Auth runtime: mantém um único Better Auth para todos os handlers do processo. */
function getAuth(): Auth {
  return (authInstance ??= createAuth());
}

/**
 * Build hermética: preservar a exportação compartilhada evita migrar callers,
 * enquanto `get`/`has` cobrem `auth.api` e o contrato de `toNextJsHandler`.
 */
export const auth = new Proxy({} as Auth, {
  get(_target, property) {
    const instance = getAuth();
    return Reflect.get(instance, property, instance);
  },
  has(_target, property) {
    return Reflect.has(getAuth(), property);
  },
});
