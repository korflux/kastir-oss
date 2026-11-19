"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Pure: botão confirmar habilitado? (extraído pra teste sem portal/SSR). */
export function isConfirmEnabled({
  busy = false,
  expectedText,
  typed = "",
}: {
  busy?: boolean;
  expectedText?: string;
  typed?: string;
}): boolean {
  if (busy) return false;
  if (!expectedText) return true;
  return typed === expectedText;
}

/**
 * Diálogo de confirmação padrão do painel: título, frase (`description`, sempre texto),
 * corpo opcional (`children`) e as ações cancelar / confirmar.
 *
 * Corpo rico (lista de campos, aviso em caixa): passe-o em `children`, que entra entre a
 * frase e as ações. `description` continua uma string porque vira o `<p>` descritivo do
 * diálogo; blocos (listas, caixas) dentro dele seriam HTML inválido. Para o corpo ter mais
 * folga que o padrão (`sm:max-w-sm`), use `contentClassName` (ex.: `sm:max-w-[460px]`).
 * Ambos são aditivos: quem passa só texto não muda em nada.
 *
 * Rótulos: `cancelLabel` nomeia o botão do rodapé; `closeLabel` nomeia o X do canto (texto só
 * para leitor de tela) e é obrigatório. O X anuncia "Fechar"/"Close" do dicionário do painel, não
 * o texto de cancelar (fase 4, A3 e design › Diálogos): o componente é client e não conhece o
 * idioma, então quem o usa passa a chave `close` do próprio módulo, e o tipo impede esquecer.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  closeLabel,
  busyLabel = "Working…",
  destructive = false,
  busy = false,
  expectedText,
  expectedTextLabel,
  expectedTextPlaceholder,
  contentClassName,
  children,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Nome acessível do X do diálogo, vindo da chave `close` do dicionário do módulo. */
  closeLabel: string;
  busyLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Quando setado, o confirmar só habilita se o input bater exatamente. */
  expectedText?: string;
  expectedTextLabel?: string;
  expectedTextPlaceholder?: string;
  /** Classes extras do conteúdo do diálogo (largura de corpos ricos). */
  contentClassName?: string;
  /** Conteúdo extra (ex.: seletor de pasta destino no delete, lista de campos no restaurar). */
  children?: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const confirmDisabled = !isConfirmEnabled({ busy, expectedText, typed });
  const requiresText = Boolean(expectedText);

  function handleOpenChange(next: boolean) {
    // Limpa o texto ao fechar — sem useEffect/setState-in-effect.
    if (!next) setTyped("");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={contentClassName} closeLabel={closeLabel}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {requiresText ? (
          <label className="grid gap-1.5 text-sm font-medium">
            {expectedTextLabel ?? `Type ${expectedText} to confirm`}
            <Input
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={expectedTextPlaceholder ?? expectedText}
              value={typed}
            />
          </label>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            {cancelLabel}
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={confirmDisabled}
            onClick={() => void onConfirm()}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
