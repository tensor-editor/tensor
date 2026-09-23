import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { useConfigStore } from '@/lib/config/store';

/**
 * L3 corollary: the hidden PM view is INPUT ONLY — its geometry is
 * meaningless and never measured. PM's built-in scroll-into-view targets
 * that geometry (it scrolls whatever scrollable ancestor reveals the
 * hidden caret), which would scroll the App container to nonsense
 * positions — the same class of disease as the legacy dead-zone
 * corrections (docs/legacy/pagination-v1.md). In paginated mode we
 * prevent it and own scrolling in the shell; pageless mode keeps PM's
 * native behavior untouched.
 */
export const PaginatedScrollGuard = Extension.create({
  name: 'paginatedScrollGuard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleScrollToSelection() {
            return useConfigStore.getState().config.editor.defaultPageLayout === 'Pages';
          },
        },
      }),
    ];
  },
});