import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { SearchMatch } from './SearchExtension';

interface SearchMatchesState {
  matches: SearchMatch[];
  currentIndex: number;
  regexError: string | null;
  groupCount: number;
}

const EMPTY_STATE: SearchMatchesState = { matches: [], currentIndex: -1, regexError: null, groupCount: 0 };

/**
 * Reactive read of the SearchExtension's storage. Storage itself is kept in
 * sync with PM plugin state via the extension's onTransaction hook; this
 * hook just re-syncs whenever a transaction fires.
 */
export function useSearchMatches(editor: Editor | null): SearchMatchesState {
  const [state, setState] = useState<SearchMatchesState>(EMPTY_STATE);

  useEffect(() => {
    if (!editor) {
      setState(EMPTY_STATE);
      return;
    }

    const sync = () => {
      const storage = editor.storage.search;
      setState({
        matches: storage?.matches ?? [],
        currentIndex: storage?.currentIndex ?? -1,
        regexError: storage?.regexError ?? null,
        groupCount: storage?.groupCount ?? 0,
      });
    };

    sync();
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [editor]);

  return state;
}

/**
 * Scrolls the currently-highlighted match into view whenever it changes.
 * Shared between the popup and the Advanced sidebar so both stay in sync
 * with whichever one drove the navigation.
 */
export function useScrollToCurrentSearchMatch(currentIndex: number, matchCount: number) {
  useEffect(() => {
    if (currentIndex < 0 || matchCount === 0) return;
    const el = document.querySelector('.tensor-search-match-current');
    // Match decorations live in the PM view — in paginated mode that
    // is the hidden input-only view (L3), whose geometry is meaningless;
    // scrollIntoView against it would scroll the desk to nonsense
    // coordinates. Skip there (pageless and the paginated fallback render
    // the view visibly, where native scroll is correct). The paginated
    // search path scrolls the current match by painted coordinates.
    if (el?.closest('.pm-input-only')) return;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentIndex, matchCount]);
}
