import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { getScrollParent } from './domUtils';

export interface FloatingToolbarPosition {
  left: number;
  top: number;
  bottom: number;
  placement: 'above' | 'below';
}

const TOOLBAR_HEIGHT_ESTIMATE = 44;
const VIEWPORT_EDGE_PADDING = 8;

export function useFloatingToolbar(editor: Editor | null, enabled: boolean) {
  const [position, setPosition] = useState<FloatingToolbarPosition | null>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!editor || !enabled) {
      setPosition(null);
      return;
    }
    const currentEditor = editor;
    const dom = currentEditor.view.dom;

    function computeAndSetPosition() {
      const { state } = currentEditor;
      const { empty } = state.selection;

      if (empty) {
        setPosition(null);
        return;
      }

      // Use the real DOM selection's rendered geometry rather than
      // coordsAtPos, which has proven unreliable specifically at line-start/
      // soft-wrap boundaries (confirmed via direct measurement earlier).
      // Also checked against the page-break coordsAtPos/posAtCoords
      // discontinuity audit (see breakBoundaryCorrection.ts): this file has
      // zero coordsAtPos/posAtCoords calls, so it can't hit that
      // discontinuity directly - a "toolbar on the wrong line" symptom seen
      // near a page break was traced to a since-fixed bug corrupting the DOM
      // this file's getClientRects() measures, not a bug in this file.
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const range = domSelection.getRangeAt(0);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) return;

      // The topmost real rendered line rect — reliable regardless of drag
      // direction or line-wrap ambiguity, since it's actual paint geometry,
      // not a position-to-coordinate translation.
      const topRect = rects.reduce((top, r) => (r.top < top.top ? r : top), rects[0]);

      const spaceAbove = topRect.top;
      const placement: 'above' | 'below' =
        spaceAbove > TOOLBAR_HEIGHT_ESTIMATE + VIEWPORT_EDGE_PADDING ? 'above' : 'below';

      setPosition({
        left: topRect.left,
        top: topRect.top,
        bottom: topRect.bottom,
        placement,
      });
    }

    function handleMouseDown() {
      isDragging.current = true;
      setPosition(null); // hide immediately once a new drag starts
    }

    function handleMouseUp() {
      isDragging.current = false;
      // Selection is now final — compute position exactly once, using
      // settled, final coordinates rather than mid-drag ones.
      computeAndSetPosition();
    }

    function handleSelectionUpdate() {
      // While actively dragging, do NOT reposition — this is what caused
      // both the erratic jumping and the interference with the browser's
      // own drag-selection tracking when the mouse passed over the toolbar.
      // Also covers non-mouse selection changes (keyboard selection via
      // Shift+arrows), which should still update immediately.
      if (isDragging.current) return;
      computeAndSetPosition();
    }

    const scrollParent = getScrollParent(dom);

    dom.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    currentEditor.on('selectionUpdate', handleSelectionUpdate);
    currentEditor.on('update', handleSelectionUpdate);
    if (scrollParent) {
      scrollParent.addEventListener('scroll', computeAndSetPosition, { passive: true });
    }

    return () => {
      dom.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      currentEditor.off('selectionUpdate', handleSelectionUpdate);
      currentEditor.off('update', handleSelectionUpdate);
      if (scrollParent) {
        scrollParent.removeEventListener('scroll', computeAndSetPosition);
      }
    };
  }, [editor, enabled]);

  return position;
}
