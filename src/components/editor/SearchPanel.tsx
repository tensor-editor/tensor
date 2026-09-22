import { useEffect, useRef } from 'react';
import { ArrowUpRight, CaseSensitive, Regex } from 'lucide-react';
import { useDocumentStore } from '@/lib/document/store';
import { useSearchStore } from '@/lib/editor/search/store';
import { useSearchMatches, useScrollToCurrentSearchMatch } from '@/lib/editor/search/useSearchMatches';
import { getGroupMismatchWarning } from '@/lib/editor/search/replaceWarning';
import { useSidebarStore } from '@/lib/layout/sidebarStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IconButton } from '@/components/layout/IconButton';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export function SearchPanel() {
  const editor = useDocumentStore((s) => s.editor);

  const isOpen = useSearchStore((s) => s.isOpen);
  const focusToken = useSearchStore((s) => s.focusToken);
  const searchTerm = useSearchStore((s) => s.searchTerm);
  const replaceTerm = useSearchStore((s) => s.replaceTerm);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const useRegex = useSearchStore((s) => s.useRegex);
  const setSearchTerm = useSearchStore((s) => s.setSearchTerm);
  const setReplaceTerm = useSearchStore((s) => s.setReplaceTerm);
  const toggleCaseSensitive = useSearchStore((s) => s.toggleCaseSensitive);
  const toggleUseRegex = useSearchStore((s) => s.toggleUseRegex);
  const close = useSearchStore((s) => s.close);
  const hide = useSearchStore((s) => s.hide);

  const { matches, currentIndex, regexError, groupCount } = useSearchMatches(editor);
  useScrollToCurrentSearchMatch(currentIndex, matches.length);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isOpen, focusToken]);

  useEffect(() => {
    if (!editor || !isOpen) return;
    const timeout = setTimeout(() => {
      editor.commands.setSearchQuery(searchTerm, { caseSensitive, useRegex });
    }, 150);
    return () => clearTimeout(timeout);
  }, [editor, isOpen, searchTerm, caseSensitive, useRegex]);

  useEffect(() => {
    if (!editor) return;
    if (!isOpen) editor.commands.clearSearch();
  }, [editor, isOpen]);

  if (!isOpen || !editor) return null;

  const hasMatches = matches.length > 0;
  const matchLabel = regexError ? null : hasMatches ? `${currentIndex + 1} of ${matches.length}` : searchTerm ? 'No results' : null;
  const groupWarning = getGroupMismatchWarning(useRegex, replaceTerm, groupCount);

  const handleNext = () => editor.commands.searchNext();
  const handlePrevious = () => editor.commands.searchPrevious();
  const handleReplace = () => editor.commands.replaceSearchMatch(replaceTerm);
  const handleReplaceAll = () => editor.commands.replaceAllSearchMatches(replaceTerm);

  const handleClose = () => {
    close();
    editor.commands.focus();
  };

  /** Hands off to the Advanced sidebar: hide (not close) so the query and
   *  toggles carry over instead of resetting. */
  const handleOpenAdvanced = () => {
    hide();
    useSidebarStore.getState().open('search', 'right');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) handlePrevious();
      else handleNext();
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleReplace();
    }
  };

  return (
    <TooltipProvider>
      <div className="absolute top-4 right-6 z-40 w-96 rounded-lg border border-border bg-popover shadow-lg">
        <div className="grid grid-cols-[1fr_auto] items-center gap-1 p-2 pb-1">
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find in document"
            className="h-8"
          />

          <div className="flex items-center gap-1">
            <IconButton
              label="Toggle case sensitive"
              icon={<CaseSensitive size={16} />}
              onClick={toggleCaseSensitive}
            />
            <IconButton
              label="Use regular expressions"
              icon={<Regex size={16} />}
              onClick={toggleUseRegex}
            />
            <IconButton
              label="Previous match"
              icon={<ChevronUp className="h-4 w-4" />}
              onClick={handlePrevious}
              disabled={!hasMatches}
            />
            <IconButton
              label="Next match"
              icon={<ChevronDown className="h-4 w-4" />}
              onClick={handleNext}
              disabled={!hasMatches}
            />
            <IconButton label="Close" icon={<X className="h-4 w-4" />} onClick={handleClose}/>
          </div>

          <Input
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace with"
            className="h-8"
          />

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8" onClick={handleReplace} disabled={!hasMatches}>
              Replace
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={handleReplaceAll} disabled={!hasMatches}>
              Replace All
            </Button>
          </div>
        </div>

        <div className="px-2 pb-2 text-xs text-muted-foreground min-h-4">
          {regexError ? (
            <span className="text-destructive">Invalid regex: {regexError}</span>
          ) : groupWarning ? (
            <span className="text-amber-600">{groupWarning}</span>
          ) : (
            matchLabel
          )}
        </div>

        <button
          type="button"
          onClick={handleOpenAdvanced}
          className="flex w-full items-center justify-center gap-2 border-t border-border py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-b-lg"
        >
          Open in sidebar
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </TooltipProvider>
  );
}
