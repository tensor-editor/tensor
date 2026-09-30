import { useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Check, Monitor, SearchIcon, Upload, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TensorLogo } from '@/components/icons/TensorIcon';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { useFontBrowserStore } from '@/lib/fonts/browserStore';
import {
  useFontRegistryStore,
  detectUploadFamily,
  type FontEntry,
  type FontSource,
  type StagedUpload,
} from '@/lib/fonts/registry';

/**
 * M-FONTS-A — the Font Browser. Styled after the Style dialog
 * (wider-than-tall, two panes) and under its preview-never-lies rule:
 * every preview line and the detail paragraph render with the REAL
 * registered family (uploaded faces are registered FontFaces;
 * Fontsource families are CSS-loaded; system families resolve via the
 * OS — entries with files undefined DEGRADE gracefully when the
 * machine lacks the system font, by design).
 *
 * Toolbar: search + source filter + the icon-only Upload. The detail
 * pane's "Use this font" applies the family to the current selection
 * (the picker's own path — setFontFamily); Uninstall is
 * uploaded-only.
 */

const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog — 0123456789';

interface ConfirmState {
  staged: StagedUpload;
  name: string;
}

/** Source badges: an icon per origin — Tensor's own mark in brand
 *  orange, a computer for the OS families, a user mark for uploads,
 *  and the Google "G" for catalog fonts (milestone B). */
function SourceBadge({ source }: { source: FontSource }) {
  const base = 'inline-flex size-4 shrink-0 items-center justify-center rounded';
  switch (source) {
    case 'bundled':
      return (
        <span
          data-testid="font-badge-bundled"
          className={`${base} bg-primary/15 text-primary`}
          title="Tensor"
        >
          <TensorLogo size={10} />
        </span>
      );
    case 'system':
      return (
        <span data-testid="font-badge-system" className={`${base} bg-muted text-muted-foreground`} title="System font">
          <Monitor className="size-3" />
        </span>
      );
    case 'uploaded':
      return (
        <span data-testid="font-badge-uploaded" className={`${base} bg-muted text-muted-foreground`} title="Uploaded">
          <UserRound className="size-3" />
        </span>
      );
    case 'catalog':
      return (
        <span
          data-testid="font-badge-catalog"
          className={`${base} bg-blue-500/15 font-sans text-[10px] font-bold text-blue-500`}
          title="Google Fonts"
        >
          G
        </span>
      );
  }
}

const FILTERS: { id: FontSource | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bundled', label: 'Tensor' },
  { id: 'system', label: 'System' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'catalog', label: 'Google Fonts' },
];

export function FontBrowserDialog() {
  const isOpen = useFontBrowserStore((s) => s.isOpen);
  const selectedId = useFontBrowserStore((s) => s.selectedId);
  const close = useFontBrowserStore((s) => s.close);
  const select = useFontBrowserStore((s) => s.select);

  const entries = useFontRegistryStore((s) => s.entries);
  const uninstall = useFontRegistryStore((s) => s.uninstall);

  // Catalog browsing is gated by the Privacy toggle — inert until
  // milestone B ships the network code, but the FILTER only makes
  // sense to show once the user opted in.
  const allowFontCatalogs = useConfigStore((s) => s.config.privacy.allowFontCatalogs);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<FontSource | 'all'>('all');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [uploading, setUploading] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        entry.displayName.toLowerCase().includes(q) || entry.family.toLowerCase().includes(q)
      );
    });
  }, [entries, query, sourceFilter]);

  // The selected entry must survive filtering — detail stays put even
  // when the filter narrows the list.
  const selected = entries.find((e) => e.id === selectedId) ?? visible[0] ?? null;

  async function beginUpload() {
    setUploading(true);
    try {
      const path = await openDialog({
        filters: [{ name: 'Font', extensions: ['ttf', 'otf', 'woff2'] }],
        multiple: false,
      });
      if (!path || Array.isArray(path)) return;
      // Family detection: the sfnt name table (.ttf/.otf) or the
      // filename convention (.woff2) — the confirm dialog makes the
      // name editable either way.
      const staged = await detectUploadFamily(path);
      setConfirm({ staged, name: staged.detectedFamily ?? staged.fallbackName });
    } finally {
      setUploading(false);
    }
  }

  async function confirmUpload() {
    if (!confirm) return;
    const name = confirm.name.trim() || confirm.staged.fallbackName;
    const entry = await useFontRegistryStore.getState().addUploaded({
      family: name,
      displayName: name,
      sourcePath: confirm.staged.sourcePath,
    });
    if (entry) {
      select(entry.id);
      setSourceFilter('all');
      setQuery('');
    }
    setConfirm(null);
  }

  /** The picker's own path — one command, same as the ribbon dropdown. */
  function useThisFont(entry: FontEntry) {
    const editor = useDocumentStore.getState().editor;
    editor?.chain().focus().setFontFamily(entry.family).run();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fonts</DialogTitle>
          <DialogDescription>Installed fonts — Tensor's catalog, your system, and your uploads.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[300px] grid-cols-[240px_1fr] gap-4">
          {/* Left pane: search + filter + upload toolbar, then the list. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="font-search"
                  className="h-8 pl-7 text-sm"
                  placeholder="Search fonts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="size-8"
                      aria-label="Upload Font"
                      onClick={() => void beginUpload()}
                      disabled={uploading}
                    >
                      <Upload size={14} />
                    </Button>
                  }
                />
                <TooltipContent>Upload Font</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.filter((f) => f.id !== 'catalog' || allowFontCatalogs).map((f) => (
                <button
                  key={f.id}
                  data-testid={`font-filter-${f.id}`}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    sourceFilter === f.id
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => setSourceFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div data-testid="font-list" className="max-h-[380px] flex-1 overflow-y-auto rounded-lg border p-1">
              {visible.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {sourceFilter === 'catalog'
                    ? 'No catalog fonts installed yet — online browsing ships in a future update.'
                    : 'No fonts match.'}
                </div>
              ) : (
                visible.map((entry) => (
                  <button
                    key={entry.id}
                    data-testid={`font-row-${entry.id}`}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted ${
                      entry.id === selected?.id ? 'bg-muted' : ''
                    }`}
                    onClick={() => select(entry.id)}
                  >
                    <SourceBadge source={entry.source} />
                    <span className="truncate text-sm" style={{ fontFamily: entry.family }}>
                      {entry.displayName}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right pane: detail of the selection. */}
          {selected ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SourceBadge source={selected.source} />
                  <div>
                    <div className="text-sm font-medium">{selected.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {selected.variable
                        ? 'Variable font — bold weights the axis'
                        : selected.files?.bold
                          ? 'Regular + Bold'
                          : 'Regular'}
                      {selected.status === 'error' && ' — failed to load'}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  {selected.source === 'uploaded' && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="font-uninstall"
                      // The doc-reference warned-set warning lives in
                      // the store's uninstall action.
                      onClick={() => void uninstall(selected.id)}
                    >
                      Uninstall
                    </Button>
                  )}
                  <Button size="sm" data-testid="font-use" onClick={() => useThisFont(selected)}>
                    <Check size={14} /> Use this font
                  </Button>
                </div>
              </div>
              {/* Preview-never-lies: the REAL registered family. */}
              <div
                data-testid="font-detail-preview"
                className="flex-1 rounded-lg border bg-background p-3 text-foreground"
                style={{ fontFamily: selected.family }}
              >
                {PREVIEW_TEXT}
                <br />
                <b>{PREVIEW_TEXT}</b>
                <br />
                <i>{PREVIEW_TEXT}</i>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center text-sm text-muted-foreground">No fonts installed</div>
          )}
        </div>

        {/* Upload confirm: the editable family name (detected when the
            sfnt name table parsed, filename convention otherwise). */}
        <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Install Font</DialogTitle>
              <DialogDescription>
                {confirm?.staged.detectedFamily
                  ? `Detected family: ${confirm.staged.detectedFamily}`
                  : 'Family name (filename convention — .woff2 cannot be parsed for names)'}
              </DialogDescription>
            </DialogHeader>
            <Input
              data-testid="font-name-input"
              value={confirm?.name ?? ''}
              onChange={(e) => setConfirm((c) => (c ? { ...c, name: e.target.value } : c))}
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button data-testid="font-confirm-install" onClick={() => void confirmUpload()}>Install</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
