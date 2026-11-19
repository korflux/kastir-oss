// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTION_NOTICE_MS,
  createDismissibleNoticeController,
  useDismissibleNotice,
} from "@/components/Shared/useDismissibleNotice";

// Habilita o flush determinístico dos efeitos React usados pelo teste do hook.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("createDismissibleNoticeController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const timers = {
    setTimeout: (fn: () => void, ms: number) =>
      setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  };

  it("shows a notice and clears it after the timeout", () => {
    const onChange = vi.fn();
    const controller = createDismissibleNoticeController(
      onChange,
      1800,
      timers,
    );

    controller.show("Saved");
    expect(onChange).toHaveBeenLastCalledWith("Saved");

    vi.advanceTimersByTime(1799);
    expect(onChange).toHaveBeenLastCalledWith("Saved");

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(null);

    controller.dispose();
  });

  it("resets the timer when show is called again", () => {
    const onChange = vi.fn();
    const controller = createDismissibleNoticeController(
      onChange,
      1800,
      timers,
    );

    controller.show("First");
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenLastCalledWith("First");

    controller.show("Second");
    expect(onChange).toHaveBeenLastCalledWith("Second");

    vi.advanceTimersByTime(1000);
    // Ainda dentro da janela do segundo show — não some cedo.
    expect(onChange).toHaveBeenLastCalledWith("Second");

    vi.advanceTimersByTime(800);
    expect(onChange).toHaveBeenLastCalledWith(null);

    controller.dispose();
  });
});

describe("createDismissibleNoticeController with an action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const timers = {
    setTimeout: (fn: () => void, ms: number) =>
      setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  };

  it("hands the action to the renderer and lasts 10 s by default", () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    const controller = createDismissibleNoticeController(
      onChange,
      1800,
      timers,
    );

    controller.show("Restored", { action: { label: "Undo", onAction } });
    expect(onChange).toHaveBeenLastCalledWith("Restored", {
      label: "Undo",
      onAction,
    });

    // O renderer chama a ação recebida: o callback do dono dispara.
    onChange.mock.lastCall?.[1]?.onAction();
    expect(onAction).toHaveBeenCalledTimes(1);

    // Com ação, o prazo padrão é maior que o de um aviso simples (1800 ms).
    vi.advanceTimersByTime(1800);
    expect(onChange).toHaveBeenLastCalledWith("Restored", expect.anything());
    vi.advanceTimersByTime(ACTION_NOTICE_MS - 1800 - 1);
    expect(onChange).toHaveBeenLastCalledWith("Restored", expect.anything());
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(null);

    controller.dispose();
  });

  it("honors a duration given per call, with or without an action", () => {
    const onChange = vi.fn();
    const controller = createDismissibleNoticeController(
      onChange,
      1800,
      timers,
    );

    controller.show("Long", { durationMs: 5000 });
    // Sem ação o aviso continua sendo chamado só com a mensagem.
    expect(onChange).toHaveBeenLastCalledWith("Long");
    vi.advanceTimersByTime(4999);
    expect(onChange).toHaveBeenLastCalledWith("Long");
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith(null);

    controller.show("With action", {
      action: { label: "Undo", onAction: () => undefined },
      durationMs: 3000,
    });
    vi.advanceTimersByTime(3000);
    expect(onChange).toHaveBeenLastCalledWith(null);

    controller.dispose();
  });

  it("drops the previous action when a plain notice replaces it", () => {
    const onChange = vi.fn();
    const controller = createDismissibleNoticeController(
      onChange,
      1800,
      timers,
    );

    controller.show("Restored", {
      action: { label: "Undo", onAction: () => undefined },
    });
    controller.show("Restore undone.");
    expect(onChange).toHaveBeenLastCalledWith("Restore undone.");

    // O timer do aviso anterior (10 s) foi cancelado: o novo vale 1800 ms.
    vi.advanceTimersByTime(1800);
    expect(onChange).toHaveBeenLastCalledWith(null);

    controller.dispose();
  });
});

describe("useDismissibleNotice hook", () => {
  let root: Root | undefined;
  let latest: ReturnType<typeof useDismissibleNotice> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Probe() {
      latest = useDismissibleNotice();
      return null;
    }
    act(() => root?.render(createElement(Probe)));
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    latest = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("keeps the legacy call (message only) as a string notice without action", () => {
    act(() => latest?.show("Saved"));
    expect(latest?.notice).toBe("Saved");
    expect(latest?.action).toBeNull();

    act(() => vi.advanceTimersByTime(1800));
    expect(latest?.notice).toBeNull();
  });

  it("exposes the action in its own field and clears both on expiry", () => {
    const onAction = vi.fn();
    act(() =>
      latest?.show("Version restored", { action: { label: "Undo", onAction } }),
    );
    expect(latest?.notice).toBe("Version restored");
    expect(latest?.action?.label).toBe("Undo");

    act(() => latest?.action?.onAction());
    expect(onAction).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(ACTION_NOTICE_MS));
    expect(latest?.notice).toBeNull();
    expect(latest?.action).toBeNull();
  });

  it("clears the action together with the notice on clear()", () => {
    act(() =>
      latest?.show("Version restored", {
        action: { label: "Undo", onAction: () => undefined },
      }),
    );
    act(() => latest?.clear());
    expect(latest?.notice).toBeNull();
    expect(latest?.action).toBeNull();
  });
});
