import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { useLinkEditorStore } from './linkEditorStore';

export interface LinkBubbleState {
  /** 'edit' — an existing link, rich view (metadata) + edit/remove.
   *  'insert' — a brand-new link being created, blank form. */
  mode: 'edit' | 'insert';
  href: string;
  /** Existing link text (mode 'edit'), or the currently-selected text
   *  being wrapped (mode 'insert' with a real selection). Empty string
   *  in mode 'insert' when there was no selection — the popover then
   *  prompts for display text separately. */
  text: string;
  from: number;
  to: number;
  coords: { left: number; top: number };
}

/** Finds the link mark (if any) covering `pos`, and its full extent
 *  within its parent block — shared by both the reactive
 *  cursor-moved-into-a-link path and the explicit Ctrl+K/button-triggered
 *  check for "is there already a link here?". */
// Audited against the page-break coordsAtPos discontinuity (see
// breakBoundaryCorrection.ts): every coordsAtPos call in this file anchors
// to a *start* position (existing.from below, or a fresh selection's from) —
// safe by construction, since measurePages.ts's breakPos() is defined as
// the first position of the page-after's content for both break kinds, so a
// link/selection that genuinely starts at a breakPos is correctly resolved
// to the page it starts on. Only end-anchored or pixel-to-position lookups
// need breakBoundaryCorrection.ts's correction — not needed here.
function findLinkAt(state: EditorState, pos: number) {
  const marks = state.doc.resolve(pos).marks();
  const linkMark = marks.find((m) => m.type.name === 'link');
  if (!linkMark) return null;

  let start = pos;
  let end = pos;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  parent.forEach((node, offset) => {
    const nodeStart = parentStart + offset;
    const nodeEnd = nodeStart + node.nodeSize;
    if (nodeStart <= pos && pos <= nodeEnd && node.marks.some((m) => m.type.name === 'link')) {
      start = Math.min(start === pos ? nodeStart : start, nodeStart);
      end = Math.max(end === pos ? nodeEnd : end, nodeEnd);
    }
  });

  return { href: linkMark.attrs.href as string, text: state.doc.textBetween(start, end), from: start, to: end };
}

/**
 * `coordsFor` (M5.6 STEP 5): where the bubble anchors for a given doc
 * position, in VIEWPORT px. Default: hidden-DOM coordsAtPos (correct for
 * pageless, where the PM view is the visible surface). Paginated mode
 * passes a painted-rect resolver — the hidden view's geometry must never
 * position anything (L3).
 */
export function useLinkBubble(
  editor: Editor | null,
  bubbleElRef: React.RefObject<HTMLElement | null>,
  coordsFor?: (pos: number) => { left: number; top: number }
) {
  const [bubble, setBubble] = useState<LinkBubbleState | null>(null);
  const pinnedRef = useRef(false);

  const insertRequestId = useLinkEditorStore((s) => s.insertRequestId);
  const closeRequestId = useLinkEditorStore((s) => s.closeRequestId);
  const lastInsertId = useRef(insertRequestId);
  const lastCloseId = useRef(closeRequestId);

  // --- Reactive path: cursor moves into/out of an existing link ---
  // Unchanged behavior from before this feature — only shows the rich
  // edit view for an existing link, and only for a collapsed selection.
  useEffect(() => {
    if (!editor) return;
    const currentEditor = editor;

    function updateBubble() {
      if (pinnedRef.current) return;

      const { state } = currentEditor;
      const { from, empty } = state.selection;

      if (!empty) {
        setBubble(null);
        return;
      }

      const existing = findLinkAt(state, from);
      if (!existing) {
        setBubble(null);
        return;
      }

      const coords = coordsFor
        ? coordsFor(existing.from)
        : (() => {
            const domCoords = currentEditor.view.coordsAtPos(existing.from);
            return { left: domCoords.left, top: domCoords.bottom };
          })();
      setBubble({
        mode: 'edit',
        href: existing.href,
        text: existing.text,
        from: existing.from,
        to: existing.to,
        coords,
      });
    }

    function handlePointerDown(e: PointerEvent) {
      const bubbleEl = bubbleElRef.current;
      const target = e.target as Node;
      pinnedRef.current = !!(bubbleEl && bubbleEl.contains(target));
    }

    currentEditor.on('selectionUpdate', updateBubble);
    currentEditor.on('update', updateBubble);
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      currentEditor.off('selectionUpdate', updateBubble);
      currentEditor.off('update', updateBubble);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [editor, bubbleElRef, coordsFor]);

  // --- Explicit open: Ctrl+K or LinkButton (Ribbon/FloatingToolbar) ---
  useEffect(() => {
    if (!editor) return;
    if (insertRequestId === lastInsertId.current) return;
    lastInsertId.current = insertRequestId;

    const { state } = editor;
    const { from, to, empty } = state.selection;

    // Already on/covering an existing link — jump straight to the rich
    // edit view rather than starting a blank insert form.
    const existing = findLinkAt(state, from);
    if (existing) {
      const coords = coordsFor
        ? coordsFor(existing.from)
        : (() => {
            const domCoords = editor.view.coordsAtPos(existing.from);
            return { left: domCoords.left, top: domCoords.bottom };
          })();
      pinnedRef.current = true;
      setBubble({
        mode: 'edit',
        href: existing.href,
        text: existing.text,
        from: existing.from,
        to: existing.to,
        coords,
      });
      return;
    }

    const text = empty ? '' : state.doc.textBetween(from, to);
    const coords = coordsFor
      ? coordsFor(from)
      : (() => {
          const domCoords = editor.view.coordsAtPos(from);
          return { left: domCoords.left, top: domCoords.bottom };
        })();
    pinnedRef.current = true;
    setBubble({
      mode: 'insert',
      href: '',
      text,
      from,
      to,
      coords,
    });
  }, [insertRequestId, editor, coordsFor]);

  // --- Explicit close: Cancel/Save/X/Escape inside the popover itself ---
  useEffect(() => {
    if (closeRequestId === lastCloseId.current) return;
    lastCloseId.current = closeRequestId;
    pinnedRef.current = false;
    setBubble(null);
  }, [closeRequestId]);

  return bubble;
}
