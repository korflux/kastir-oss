import type { PublicAuthCopy } from "@/lib/Modules/Users/Components/InviteAcceptForm";

const copies: Record<string, PublicAuthCopy> = {
  en: {
    inviteTitle: "Accept your invitation",
    inviteDescription:
      "Set the email and password for your Kastir panel account.",
    invalidInvite: "This invitation is invalid, expired or already used.",
    name: "Name",
    role: "Role",
    email: "Email",
    password: "Password",
    passwordHint: "Use at least 8 characters.",
    accept: "Accept invitation",
    accepting: "Creating account…",
    failed: "Unable to accept this invitation.",
    sessionBridgeFailed:
      "Your account was created, but automatic sign-in failed. Sign in with your email and password.",
    login: "Go to sign in",
    resetTitle: "Reset your password",
    resetDescription: "Choose a new password for your Kastir panel account.",
    invalidReset: "This reset link is invalid, expired or already used.",
    resetSubmit: "Reset password",
    resetDone: "Your password was reset. Sign in with the new password.",
  },
  "pt-BR": {
    inviteTitle: "Aceite seu convite",
    inviteDescription:
      "Defina o e-mail e a senha da sua conta no painel Kastir.",
    invalidInvite: "Este convite é inválido, expirou ou já foi usado.",
    name: "Nome",
    role: "Papel",
    email: "E-mail",
    password: "Senha",
    passwordHint: "Use pelo menos 8 caracteres.",
    accept: "Aceitar convite",
    accepting: "Criando conta…",
    failed: "Não foi possível aceitar este convite.",
    sessionBridgeFailed:
      "Sua conta foi criada, mas o login automático falhou. Entre com e-mail e senha.",
    login: "Ir para o login",
    resetTitle: "Redefina sua senha",
    resetDescription: "Escolha uma nova senha para sua conta no painel Kastir.",
    invalidReset: "Este link de reset é inválido, expirou ou já foi usado.",
    resetSubmit: "Redefinir senha",
    resetDone: "Sua senha foi redefinida. Entre com a nova senha.",
  },
};

export function getPublicAuthCopy(language: string): PublicAuthCopy {
  return copies[language] ?? copies.en;
}
