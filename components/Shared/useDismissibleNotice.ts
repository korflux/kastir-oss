"use client";

/**
 * Aviso de resultado que some sozinho (faixa abaixo do cabeçalho dos editores, listas etc.).
 *
 * Seções deste arquivo:
 *   1. `createDismissibleNoticeController`: núcleo do auto-dismiss, testável sem React.
 *   2. `useDismissibleNotice`: o hook que os componentes usam.
 *
 * Contrato aditivo: `show(mensagem)` continua sendo tudo que a maioria dos consumidores
 * (Users, Media, Split tests, editores) chama; `notice` segue sendo uma string. Um aviso
 * pode ainda carregar UMA ação opcional (ex.: "Desfazer") e uma duração própria; a ação sai
 * no campo separado `action`, para quem não a usa nada mudar.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Ação opcional exibida junto do aviso (o componente renderiza o botão e chama `onAction`). */
export type NoticeAction = {
  label: string;
  onAction: () => void;
};

/** Opções por chamada de `show`. */
export type NoticeOptions = {
  action?: NoticeAction;
  /** Duração desta chamada; sem ela vale a do hook (ou `ACTION_NOTICE_MS` quando há ação). */
  durationMs?: number;
};

/**
 * Duração padrão de um aviso com ação: dá tempo de ler e decidir (um aviso de 1,8 s
 * some antes de o usuário alcançar o "Desfazer").
 */
export const ACTION_NOTICE_MS = 10_000;

/* -------------------------------------------------------------------------- */
/* 1. Núcleo do auto-dismiss                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `onChange(mensagem)` quando o aviso não tem ação; `onChange(mensagem, ação)` quando tem;
 * `onChange(null)` quando some. A forma de um argumento para aviso simples é deliberada: é
 * o contrato original, e os testes e consumidores dele seguem valendo.
 */
export function createDismissibleNoticeController(
  onChange: (message: string | null, action?: NoticeAction) => void,
  timeoutMs: number,
  timers: {
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  } = {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  },
) {
  let timerId: number | null = null;

  function clearTimer() {
    if (timerId != null) {
      timers.clearTimeout(timerId);
      timerId = null;
    }
  }

  return {
    /** Mostra o aviso e (re)arma o timer; nova chamada substitui o aviso e a ação anteriores. */
    show(message: string, options: NoticeOptions = {}) {
      clearTimer();
      if (options.action) onChange(message, options.action);
      else onChange(message);
      const duration =
        options.durationMs ?? (options.action ? ACTION_NOTICE_MS : timeoutMs);
      timerId = timers.setTimeout(() => {
        onChange(null);
        timerId = null;
      }, duration);
    },
    clear() {
      clearTimer();
      onChange(null);
    },
    dispose() {
      clearTimer();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Hook                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Banner de sucesso que some sozinho — generaliza setTimeout(1800) do Users.
 * Nova chamada reseta o timer (não empilha, não some cedo demais).
 *
 * Retorna `{ notice, action, show, clear }`: `notice` é o texto (ou null) e `action` a ação
 * do aviso atual (ou null; sempre null para quem chama `show` só com a mensagem).
 * O hook não mexe no foco: o aviso é uma região `role="status"` e quem renderiza a ação
 * decide o resto.
 */
export function useDismissibleNotice(timeoutMs = 1800) {
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<NoticeAction | null>(null);
  const controllerRef = useRef<ReturnType<
    typeof createDismissibleNoticeController
  > | null>(null);

  useEffect(() => {
    const controller = createDismissibleNoticeController(
      (message, nextAction) => {
        setNotice(message);
        setAction(message === null ? null : (nextAction ?? null));
      },
      timeoutMs,
    );
    controllerRef.current = controller;
    return () => controller.dispose();
  }, [timeoutMs]);

  const show = useCallback((message: string, options?: NoticeOptions) => {
    controllerRef.current?.show(message, options);
  }, []);

  const clear = useCallback(() => {
    controllerRef.current?.clear();
  }, []);

  return { notice, action, show, clear };
}
