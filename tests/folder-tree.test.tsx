// @vitest-environment jsdom

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditableFolder } from "@/components/Shared/FolderEditorDialog";
import { FolderTree } from "@/components/Shared/FolderTree";
import { getPanelDictionary } from "@/lib/i18n/panel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => {
    const nativeProps = { ...props };
    delete (nativeProps as { size?: string }).size;
    delete (nativeProps as { variant?: string }).variant;
    return <button {...nativeProps}>{children}</button>;
  },
}));

vi.mock("@/components/Shared/ColorPicker", () => ({
  DEFAULT_FOLDER_COLOR: "#3B82F6",
  ColorPicker: () => <div data-testid="color-picker" />,
}));

const labels = getPanelDictionary("en").folders;
const base: EditableFolder = {
  id: "base",
  name: "Base",
  color: null,
  parentId: null,
  isBase: true,
};

let root: Root | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
});

/** Monta a árvore real com callbacks mínimos para testar o contrato compartilhado. */
function renderTree(
  folder: EditableFolder,
  options?: {
    busy?: boolean;
    onMove?: (folderId: string, newParentId: string | null) => Promise<void>;
  },
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const parent: EditableFolder | null = folder.parentId
    ? {
        id: folder.parentId,
        name: "Parent",
        color: null,
        parentId: null,
        isBase: false,
      }
    : null;
  act(() => {
    root?.render(
      <FolderTree
        busy={options?.busy}
        folders={[base, ...(parent ? [parent] : []), folder]}
        labels={labels}
        selectedFolderId={folder.id}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onMove={options?.onMove}
        onSelect={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
  });

  const renameButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${labels.rename}"]`,
    ),
  );
  act(() => renameButtons.at(-1)?.click());
  return container;
}

function moveButton(container: HTMLElement): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes(labels.moveToRoot),
    ) ?? null
  );
}

describe("FolderTree move to root", () => {
  it("shows the action only for a movable child and respects busy", () => {
    const child = {
      id: "child",
      name: "Child",
      color: null,
      parentId: "parent",
      isBase: false,
    } satisfies EditableFolder;
    const container = renderTree(child, { busy: true, onMove: vi.fn() });

    expect(moveButton(container)?.disabled).toBe(true);
  });

  it("does not expose an editor action for the protected Base folder", () => {
    const container = renderTree(
      {
        id: "other-base",
        name: "Protected",
        color: null,
        parentId: null,
        isBase: true,
      },
      { onMove: vi.fn() },
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(moveButton(container)).toBeNull();
  });

  it.each([
    ["root folder", null, vi.fn()],
    ["missing move callback", "parent", undefined],
  ])("hides the action for %s", (_case, parentId, onMove) => {
    const container = renderTree(
      {
        id: "folder",
        name: "Folder",
        color: null,
        parentId,
        isBase: false,
      },
      { onMove },
    );

    expect(moveButton(container)).toBeNull();
  });

  it("sends null once and closes only after success", async () => {
    let resolveMove: (() => void) | undefined;
    const pendingMove = new Promise<void>((resolve) => {
      resolveMove = resolve;
    });
    const onMove = vi.fn(() => pendingMove);
    const container = renderTree(
      {
        id: "child",
        name: "Child",
        color: null,
        parentId: "parent",
        isBase: false,
      },
      { onMove },
    );

    act(() => moveButton(container)?.click());
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith("child", null);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      resolveMove?.();
      await pendingMove;
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open when persistence fails", async () => {
    const onMove = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const container = renderTree(
      {
        id: "child",
        name: "Child",
        color: null,
        parentId: "parent",
        isBase: false,
      },
      { onMove },
    );

    await act(async () => moveButton(container)?.click());

    expect(onMove).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
