import { Extension, type Editor } from '@tiptap/core';
import { Plugin, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { nanoid } from 'nanoid';

/**
 * STEP 1 (M4): author-assigned, stable block ids on every top-level
 * paragraph/heading. The engine's LineBox/FragmentBreak records carry
 * `blockId` as the edit-survival identity ("author-assigned, stable
 * across edits by contract" — engine/src/types.ts), and its caches are
 * id-keyed, so the shell must guarantee two invariants before any
 * layout call:
 *
 *  - MISSING ids are minted (legacy .wpdoc files saved before ids
 *    existed load through here — the "load pass" — and so does the
 *    editor's INITIAL content, which is created without a transaction
 *    and therefore never reaches appendTransaction; that path is
 *    covered by onCreate + ensureBlockIds).
 *  - DUPLICATE ids are re-minted on the LATER node — the earlier
 *    occurrence keeps its id. PASTE is the canonical duplicate source:
 *    copied content carries the source's ids, so a paste re-mints
 *    every id it collides with. Pinned by test.
 *
 * The engine independently throws loudly on any duplicate that still
 * slips through (validateDuplicateIds, engine/src/layout.ts) — this
 * plugin is the shell-side guarantee, not the enforcement.
 */

const ID_BEARING_KINDS = ['paragraph', 'heading'];

/**
 * Mint ids for missing/duplicate top-level blocks INTO `tr` (positions
 * are doc-relative, so tr must belong to the same doc). Returns whether
 * anything was written. Shared by appendTransaction (every doc change)
 * and ensureBlockIds (editor creation / setContent-from-JSON paths that
 * never dispatch a doc-changed transaction the plugin would see).
 */
function mintIds(doc: PMNode, tr: Transaction): boolean {
  const seen = new Set<string>();
  let modified = false;

  doc.forEach((node, offset) => {
    if (!ID_BEARING_KINDS.includes(node.type.name)) return;
    const id = node.attrs.blockId;
    if (typeof id === 'string' && id && !seen.has(id)) {
      seen.add(id);
      return;
    }
    // Missing id, or a duplicate: the LATER node loses — the earlier
    // occurrence (the original, when the later one is a paste) keeps its id.
    const minted = nanoid();
    seen.add(minted);
    tr.setNodeMarkup(offset, undefined, { ...node.attrs, blockId: minted });
    modified = true;
  });

  return modified;
}

/** Run the mint pass against the live doc and dispatch if needed. Used
 * for the initial-content path (no transaction ever fires there). */
export function ensureBlockIds(editor: Editor): void {
  const { state, view } = editor;
  const tr = state.tr;
  if (mintIds(state.doc, tr)) view.dispatch(tr);
}

export const BlockIdExtension = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: ID_BEARING_KINDS,
        attributes: {
          blockId: {
            default: null,
            // Splitting a block must NOT clone the id — the halves would
            // duplicate and the mint pass would have to guess which half
            // keeps it. Mint fresh on split instead.
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = newState.tr;
          return mintIds(newState.doc, tr) ? tr : null;
        },
      }),
    ];
  },
});