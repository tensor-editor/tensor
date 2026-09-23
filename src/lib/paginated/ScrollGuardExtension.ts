import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useConfigStore } from '@/lib/config/store';

/**
 * M4.2 translation layer, PM side. PM's view.scrollToSelection() fires
 * only for transactions carrying PM's scrollIntoView intent flag, and
 * consults handleScrollToSelection BEFORE its native default — which
 * would scrollIntoView the selection's coordsAtPos rect on the HIDDEN
 * input-only view (L3: meaningless geometry; the legacy scroll-jump
 * disease). In paginated mode we intercept and answer the request
 * against PAINTED coordinates instead.
 *
 * The painted implementation is registered by the mounted PaginatedView
 * (it owns the layout result, the stack element, and the metrics) via
 * setPaintedScrollHandler:
 *   - handler returns true  -> request fully handled against painted
 *     coords (minimal-edge caret-follow, see caretFollow.ts); PM's
 *     native default never runs.
 *   - handler returns false -> request declines (adapter-fallback page:
 *     the visible pageless DOM is the real content there, so PM's native
 *     scroll is correct); native default runs.
 *   - no handler registered (Pages mode but view not mounted / no layout
 *     yet) -> blocked: there is nothing painted to reveal, and letting
 *     the native default run would scroll the desk to hidden-view
 *     coordinates.
 * Pageless mode never registers a handler and always keeps PM native.
 */
export type PaintedScrollHandler = (view: EditorView) => boolean;

let paintedScrollHandler: PaintedScrollHandler | null = null;

export function setPaintedScrollHandler(handler: PaintedScrollHandler | null): void {
  paintedScrollHandler = handler;
}

export const ScrollGuardExtension = Extension.create({
  name: 'paginatedScrollGuard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleScrollToSelection(view) {
            if (useConfigStore.getState().config.editor.defaultPageLayout !== 'Pages') {
              return false; // pageless: PM's native selection scrolling is correct
            }
            return paintedScrollHandler ? paintedScrollHandler(view) : true;
          },
        },
      }),
    ];
  },
});