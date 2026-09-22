import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useSearchStore } from './store';
import { useSidebarStore } from '@/lib/layout/sidebarStore';

export interface SearchMatch {
  from: number;
  to: number;
  /** full matched text, i.e. regex match[0] */
  match: string;
  /** capture groups, only populated in regex mode */
  groups: string[];
  /** up to 5 words preceding the match, "… " prefixed if truncated */
  contextBefore: string;
  /** up to 5 words following the match, " …" suffixed if truncated */
  contextAfter: string;
}

const CONTEXT_WORD_COUNT = 5;

interface SearchPluginState {
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  regexError: string | null;
  /** total capture groups in the current pattern (regex mode only) — used to
   *  warn when a replacement references a group that doesn't exist, e.g. the
   *  classic "$1 with no parentheses in the pattern silently inserts nothing"
   *  trap. Independent of match count so it's available even with 0 matches. */
  groupCount: number;
  matches: SearchMatch[];
  currentIndex: number;
  decorations: DecorationSet;
}

type SearchMeta =
  | { type: 'search'; query: string; caseSensitive: boolean; useRegex: boolean }
  | { type: 'setIndex'; index: number }
  | { type: 'recomputeKeepingPosition'; anchorPos: number }
  | { type: 'clear' };

export const searchPluginKey = new PluginKey<SearchPluginState>('search');

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Number of capturing groups in `pattern`, regardless of whether anything matches. */
function getGroupCount(pattern: string, flags: string): number {
  try {
    const nonGlobalFlags = flags.replace('g', '');
    const probe = new RegExp(`${pattern}|`, nonGlobalFlags);
    const m = probe.exec('');
    return m ? m.length - 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * Walks the doc's text content into one flat string, inserting a '\n'
 * between separate textblocks (paragraphs/headings/etc) so matches don't
 * silently span across them. posMap[i] gives the real ProseMirror position
 * of character i in that string.
 */
function buildDocIndex(doc: PMNode): { text: string; posMap: number[] } {
  let text = '';
  const posMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const nodeText = node.text ?? '';
      for (let i = 0; i < nodeText.length; i++) {
        posMap.push(pos + i);
      }
      text += nodeText;
      return false;
    }
    if (node.isTextblock && text.length > 0) {
      text += '\n';
      posMap.push(pos);
    }
    return true;
  });

  return { text, posMap };
}

function getContextBefore(text: string, index: number, count: number): string {
  const before = text.slice(0, index);
  const words = before.trim().split(/\s+/).filter(Boolean);
  const truncated = words.length > count;
  const slice = words.slice(-count).join(' ');
  return truncated ? `… ${slice}` : slice;
}

function getContextAfter(text: string, index: number, count: number): string {
  const after = text.slice(index);
  const words = after.trim().split(/\s+/).filter(Boolean);
  const truncated = words.length > count;
  const slice = words.slice(0, count).join(' ');
  return truncated ? `${slice} …` : slice;
}

function computeMatches(
  doc: PMNode,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): { matches: SearchMatch[]; error: string | null; groupCount: number } {
  if (!query) return { matches: [], error: null, groupCount: 0 };

  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    const pattern = useRegex ? query : escapeRegExp(query);
    regex = new RegExp(pattern, flags);
  } catch (e) {
    return { matches: [], error: e instanceof Error ? e.message : 'Invalid regular expression', groupCount: 0 };
  }

  const groupCount = useRegex ? getGroupCount(query, flags) : 0;
  const { text, posMap } = buildDocIndex(doc);
  const docSize = doc.content.size;
  const matches: SearchMatch[] = [];

  regex.lastIndex = 0;
  let execMatch: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((execMatch = regex.exec(text)) !== null) {
    const matchText = execMatch[0];
    if (matchText.length === 0) {
      // avoid infinite loop on zero-length matches (e.g. `a*`)
      regex.lastIndex++;
      continue;
    }
    const startIdx = execMatch.index;
    const endIdx = startIdx + matchText.length;
    const from = posMap[startIdx];
    if (from === undefined) continue;
    const to = endIdx < posMap.length ? posMap[endIdx] : docSize;

    matches.push({
      from,
      to,
      match: matchText,
      groups: execMatch.slice(1).map((g) => g ?? ''),
      contextBefore: getContextBefore(text, startIdx, CONTEXT_WORD_COUNT),
      contextAfter: getContextAfter(text, endIdx, CONTEXT_WORD_COUNT),
    });
  }

  return { matches, error: null, groupCount };
}

function buildDecorations(doc: PMNode, matches: SearchMatch[], currentIndex: number): DecorationSet {
  const decorations = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex ? 'tensor-search-match tensor-search-match-current' : 'tensor-search-match',
    }),
  );
  return DecorationSet.create(doc, decorations);
}

/** Applies `$&`, `$$`, `$1`-`$9` backreferences in regex mode; literal replacement otherwise. */
function buildReplacement(template: string, m: SearchMatch, useRegex: boolean): string {
  if (!useRegex) return template;
  return template.replace(/\$(\$|&|\d{1,2})/g, (_, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return m.match;
    const n = parseInt(token, 10);
    return m.groups[n - 1] ?? '';
  });
}

function createSearchPlugin() {
  return new Plugin<SearchPluginState>({
    key: searchPluginKey,
    state: {
      init(): SearchPluginState {
        return {
          query: '',
          caseSensitive: false,
          useRegex: false,
          regexError: null,
          groupCount: 0,
          matches: [],
          currentIndex: -1,
          decorations: DecorationSet.empty,
        };
      },
      apply(tr, prev, _oldState, newState): SearchPluginState {
        const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;

        if (meta?.type === 'clear') {
          return {
            query: '',
            caseSensitive: prev.caseSensitive,
            useRegex: prev.useRegex,
            regexError: null,
            groupCount: 0,
            matches: [],
            currentIndex: -1,
            decorations: DecorationSet.empty,
          };
        }

        if (meta?.type === 'search') {
          const { matches, error, groupCount } = computeMatches(newState.doc, meta.query, meta.caseSensitive, meta.useRegex);
          const currentIndex = matches.length > 0 ? 0 : -1;
          return {
            query: meta.query,
            caseSensitive: meta.caseSensitive,
            useRegex: meta.useRegex,
            regexError: error,
            groupCount,
            matches,
            currentIndex,
            decorations: buildDecorations(newState.doc, matches, currentIndex),
          };
        }

        if (meta?.type === 'setIndex') {
          if (prev.matches.length === 0) return prev;
          const clamped = ((meta.index % prev.matches.length) + prev.matches.length) % prev.matches.length;
          return {
            ...prev,
            currentIndex: clamped,
            decorations: buildDecorations(newState.doc, prev.matches, clamped),
          };
        }

        if (meta?.type === 'recomputeKeepingPosition') {
          const { matches, error, groupCount } = computeMatches(newState.doc, prev.query, prev.caseSensitive, prev.useRegex);
          let currentIndex = matches.findIndex((m) => m.from >= meta.anchorPos);
          if (currentIndex === -1) currentIndex = matches.length > 0 ? 0 : -1;
          return {
            ...prev,
            matches,
            regexError: error,
            groupCount,
            currentIndex,
            decorations: buildDecorations(newState.doc, matches, currentIndex),
          };
        }

        if (tr.docChanged && prev.query) {
          const { matches, error, groupCount } = computeMatches(newState.doc, prev.query, prev.caseSensitive, prev.useRegex);
          const currentIndex = matches.length > 0 ? Math.min(prev.currentIndex === -1 ? 0 : prev.currentIndex, matches.length - 1) : -1;
          return {
            ...prev,
            matches,
            regexError: error,
            groupCount,
            currentIndex,
            decorations: buildDecorations(newState.doc, matches, currentIndex),
          };
        }

        return prev;
      },
    },
    props: {
      decorations(state) {
        return searchPluginKey.getState(state)?.decorations;
      },
    },
  });
}

export interface SearchStorage {
  matches: SearchMatch[];
  currentIndex: number;
  regexError: string | null;
  groupCount: number;
}

declare module '@tiptap/core' {
  interface Storage {
    search: SearchStorage;
  }

  interface Commands<ReturnType> {
    search: {
      setSearchQuery: (query: string, opts: { caseSensitive: boolean; useRegex: boolean }) => ReturnType;
      searchNext: () => ReturnType;
      searchPrevious: () => ReturnType;
      setSearchIndex: (index: number) => ReturnType;
      replaceSearchMatch: (replaceTerm: string) => ReturnType;
      replaceAllSearchMatches: (replaceTerm: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const SearchExtension = Extension.create<Record<string, never>, SearchStorage>({
  name: 'search',

  addStorage() {
    return { matches: [], currentIndex: -1, regexError: null, groupCount: 0 };
  },

  onTransaction() {
    const state = searchPluginKey.getState(this.editor.state);
    if (state) {
      this.storage.matches = state.matches;
      this.storage.currentIndex = state.currentIndex;
      this.storage.regexError = state.regexError;
      this.storage.groupCount = state.groupCount;
    }
  },

  addKeyboardShortcuts() {
      return {
        Escape: () => {
          const searchState = useSearchStore.getState();
          const sidebarState = useSidebarStore.getState();
          const sidebarActive = sidebarState.active?.id === 'search';
          if (!searchState.isOpen && !sidebarActive) return false;
          if (sidebarActive) sidebarState.close();
          searchState.close();
          this.editor.commands.clearSearch();
          return true;
        },
      };
    },

  addCommands() {
    return {
      setSearchQuery:
        (query, opts) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(searchPluginKey, {
              type: 'search',
              query,
              caseSensitive: opts.caseSensitive,
              useRegex: opts.useRegex,
            });
            dispatch(tr);
          }
          return true;
        },

      searchNext:
        () =>
        ({ tr, dispatch, state }) => {
          const pState = searchPluginKey.getState(state);
          if (!pState || pState.matches.length === 0) return false;
          if (dispatch) {
            tr.setMeta(searchPluginKey, { type: 'setIndex', index: pState.currentIndex + 1 });
            dispatch(tr);
          }
          return true;
        },

      searchPrevious:
        () =>
        ({ tr, dispatch, state }) => {
          const pState = searchPluginKey.getState(state);
          if (!pState || pState.matches.length === 0) return false;
          if (dispatch) {
            tr.setMeta(searchPluginKey, { type: 'setIndex', index: pState.currentIndex - 1 });
            dispatch(tr);
          }
          return true;
        },

      setSearchIndex:
        (index) =>
        ({ tr, dispatch, state }) => {
          const pState = searchPluginKey.getState(state);
          if (!pState || pState.matches.length === 0) return false;
          if (dispatch) {
            tr.setMeta(searchPluginKey, { type: 'setIndex', index });
            dispatch(tr);
          }
          return true;
        },

      replaceSearchMatch:
        (replaceTerm) =>
        ({ tr, dispatch, state }) => {
          const pState = searchPluginKey.getState(state);
          if (!pState || pState.currentIndex < 0 || pState.matches.length === 0) return false;
          const m = pState.matches[pState.currentIndex];
          const replacement = buildReplacement(replaceTerm, m, pState.useRegex);
          if (dispatch) {
            tr.insertText(replacement, m.from, m.to);
            tr.setMeta(searchPluginKey, { type: 'recomputeKeepingPosition', anchorPos: m.from });
            dispatch(tr);
          }
          return true;
        },

      replaceAllSearchMatches:
        (replaceTerm) =>
        ({ tr, dispatch, state }) => {
          const pState = searchPluginKey.getState(state);
          if (!pState || pState.matches.length === 0) return false;
          if (dispatch) {
            // back-to-front so earlier positions remain valid as we go
            const sorted = [...pState.matches].sort((a, b) => b.from - a.from);
            for (const m of sorted) {
              const replacement = buildReplacement(replaceTerm, m, pState.useRegex);
              tr.insertText(replacement, m.from, m.to);
            }
            tr.setMeta(searchPluginKey, { type: 'clear' });
            dispatch(tr);
          }
          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(searchPluginKey, { type: 'clear' });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [createSearchPlugin()];
  },
});
