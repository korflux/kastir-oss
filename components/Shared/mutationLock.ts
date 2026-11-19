import { useCallback, useRef, useState } from "react";

export type MutationGate = {
  finish: () => void;
  isBusy: () => boolean;
  start: (action: string) => boolean;
};

/** Mantém uma única mutação ativa para evitar efeitos destrutivos concorrentes. */
export function createMutationGate(): MutationGate {
  let busy = false;

  return {
    finish() {
      busy = false;
    },
    isBusy() {
      return busy;
    },
    start() {
      if (busy) return false;
      busy = true;
      return true;
    },
  };
}

/** Expõe o gate imperativo e o estado renderizável para workspaces React. */
export function useMutationLock() {
  const gateRef = useRef<MutationGate | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  if (gateRef.current === null) gateRef.current = createMutationGate();

  const start = useCallback((action: string) => {
    if (!gateRef.current?.start(action)) return false;
    setBusyAction(action);
    return true;
  }, []);

  const finish = useCallback(() => {
    gateRef.current?.finish();
    setBusyAction(null);
  }, []);

  return {
    busyAction,
    finish,
    isBusy: busyAction !== null,
    start,
  };
}
