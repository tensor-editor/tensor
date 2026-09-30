import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Check,
  CloudOff,
  Monitor,
  Package,
  SearchIcon,
  SearchX,
  Share2,
  Upload,
  UserRound,
} from 'lucide-react';
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
import { useBrandMark, ensureBrandMarks } from '@/lib/fonts/catalogs/brandMarks';
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
} from '@/components/ui/empty';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { useFontBrowserStore } from '@/lib/fonts/browserStore';
import { useFontRegistryStore, detectUploadFamily, type FontEntry, type StagedUpload } from '@/lib/fonts/registry';
import {
  CATALOG_LABELS,
  type CatalogId,
  type CatalogSource,
} from '@/lib/fonts/catalogs/types';
import { getCatalogSources, searchCatalogs, type MergedCatalogFont } from '@/lib/fonts/catalogs';
import { loadPreviewFace, releasePreviewFace } from '@/lib/fonts/catalogs/preview';

/**
 * M-FONTS-A + B — the Font Browser. Two panes, Style-dialog styling,
 * preview-never-lies. A: installed list (search + source filter +
 * icon-only upload), detail (real-font preview, Use this font,
 * Uninstall uploaded/catalog). B, gated by privacy.allowFontCatalogs:
 * OFF → a banner with a Privacy deep-link and NO network module
 * constructed; ON → the search bar goes live (debounced), results are
 * deduped across Google Fonts / Font Share / Fontsource with source
 * chips, and the detail pane previews the REAL font via a lazy
 * single-slot temp face before an all-or-nothing install.
 */

const PREVIEW_TEXT = 'The quick brown fox jumps over the lazy dog — 0123456789';

interface ConfirmState {
  staged: StagedUpload;
  name: string;
}

interface InstallState {
  status: 'idle' | 'installing' | 'error';
}

/** Source badges — an icon per origin, shadcn-tooltipped as
 *  "Source (Name)". Fontsource coverage note rides its tooltip. */
function SourceBadge({ source, catalog }: { source: FontEntry['source']; catalog?: CatalogId }) {
  const base = 'inline-flex size-4 shrink-0 items-center justify-center rounded';
  if (source === 'catalog') {
    if (catalog === 'fontshare') {
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <span data-testid="font-badge-catalog" className={`${base} bg-muted text-muted-foreground`}>
                <Share2 className="size-3" />
              </span>
            }
          />
          <TooltipContent>Font Share</TooltipContent>
        </Tooltip>
      );
    }
    if (catalog === 'fontsource') {
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <span data-testid="font-badge-catalog" className={`${base} bg-muted text-muted-foreground`}>
                <Package className="size-3" />
              </span>
            }
          />
          <TooltipContent>Fontsource</TooltipContent>
        </Tooltip>
      );
    }
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              data-testid="font-badge-catalog"
              className={`${base} bg-blue-500/15 font-sans text-[10px] font-bold text-blue-500`}
            >
              G
            </span>
          }
        />
        <TooltipContent>Google Fonts</TooltipContent>
      </Tooltip>
    );
  }
  switch (source) {
    case 'bundled':
      return (
        <Tooltip>
          <TooltipTrigger render={<span data-testid="font-badge-bundled" className={`${base} bg-primary/15 text-primary`} />}>
            <TensorLogo size={10} />
          </TooltipTrigger>
          <TooltipContent>Tensor</TooltipContent>
        </Tooltip>
      );
    case 'system':
      return (
        <Tooltip>
          <TooltipTrigger render={<span data-testid="font-badge-system" className={`${base} bg-muted text-muted-foreground`} />}>
            <Monitor className="size-3" />
          </TooltipTrigger>
          <TooltipContent>System</TooltipContent>
        </Tooltip>
      );
    case 'uploaded':
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <span data-testid="font-badge-uploaded" className={`${base} bg-muted text-muted-foreground`}>
                <UserRound className="size-3" />
              </span>
            }
          />
          <TooltipContent>Uploaded</TooltipContent>
        </Tooltip>
      );
    default:
      return null; // 'catalog' handled above
  }
}

/** A catalog source's mark: the service's OWN favicon (fetched once
 *  at boot — brandMarks.ts) when available, the lucide fallback
 *  otherwise, the inlined official G for Google. Used by BOTH the
 *  installed-sidebar badges and the result chips so the mark is one
 *  spelling everywhere. */
function CatalogMark({ id }: { id: CatalogId }) {
  // The reactive hook: a favicon that lands after first paint swaps
  // the fallback out instantly (no stale plain-G).
  const url = useBrandMark(id);
  if (url) {
    return <img src={url} alt="" data-testid="brand-mark" className="size-2.5 object-contain" />;
  }
  // Favicon fetch failed/unavailable → letter/lucide fallback marks.
  if (id === 'google') return <span className="text-[10px] font-bold text-blue-500">G</span>;
  if (id === 'fontshare') return <Share2 className="size-3" />;
  return <Package className="size-3" />;
}

/** Chip for a catalog-source mark in results and install choice.
 *  Rows render it non-interactive (a span — nested buttons are
 *  invalid HTML); the install-choice chips are clickable. */
function CatalogChip({ id, muted, onClick }: { id: CatalogId; muted?: boolean; onClick?: () => void }) {
  const mark = <CatalogMark id={id} />;
  const className = `inline-flex size-4 items-center justify-center rounded bg-muted text-muted-foreground ${muted ? 'opacity-40' : ''} ${onClick ? 'hover:bg-accent' : ''}`;
  const tooltip = (
    <TooltipContent>
      {CATALOG_LABELS[id]}
      {muted ? ' — unavailable' : ''}
    </TooltipContent>
  );
  if (!onClick) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span data-testid={`catalog-chip-${id}`} className={className}>
              {mark}
            </span>
          }
        />
        {tooltip}
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button data-testid={`catalog-chip-${id}`} className={className} onClick={onClick} type="button">
            {mark}
          </button>
        }
      />
      {tooltip}
    </Tooltip>
  );
}

/** The subtitle badges: how many styles the family offers (variable
 *  fonts carry the axis, spelled on the badge — never appended to the
 *  family name) + script direction. */
function StyleBadges({ entry }: { entry: FontEntry }) {
  const styleCount = entry.variable
    ? null
    : entry.files
      ? Object.values(entry.files).filter(Boolean).length
      : 1;
  const direction = entry.direction ?? 'ltr';
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span data-testid="font-styles-badge" className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
        {styleCount != null ? `${styleCount} style${styleCount === 1 ? '' : 's'}` : 'Variable'}
      </span>
      <span
        data-testid="font-direction-badge"
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${direction === 'rtl' ? 'bg-primary/15 text-primary' : 'bg-muted'}`}
      >
        {direction.toUpperCase()}
      </span>
    </div>
  );
}

const FILTERS: { id: FontEntry['source'] | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bundled', label: 'Tensor' },
  { id: 'system', label: 'System' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'catalog', label: 'Online' },
];

export function FontBrowserDialog() {
  const isOpen = useFontBrowserStore((s) => s.isOpen);
  const selectedId = useFontBrowserStore((s) => s.selectedId);
  const close = useFontBrowserStore((s) => s.close);
  const select = useFontBrowserStore((s) => s.select);

  const entries = useFontRegistryStore((s) => s.entries);
  const uninstall = useFontRegistryStore((s) => s.uninstall);

  const allowFontCatalogs = useConfigStore((s) => s.config.privacy.allowFontCatalogs);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<FontEntry['source'] | 'all'>('all');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── B: online search state (constructed ONLY when the toggle is
  // on — the gate is getCatalogSources; OFF constructs nothing).
  const [results, setResults] = useState<MergedCatalogFont[]>([]);
  const [unavailable, setUnavailable] = useState<CatalogId[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCatalogKey, setSelectedCatalogKey] = useState<string | null>(null);
  const [chosenSource, setChosenSource] = useState<CatalogId | null>(null);
  const [previewFamily, setPreviewFamily] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallState>({ status: 'idle' });
  const sourcesRef = useRef<CatalogSource[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const installedSelected = entries.find((e) => e.id === selectedId) ?? visible[0] ?? null;
  const catalogSelected = results.find((r) => r.key === selectedCatalogKey) ?? null;

  // Construct/destroy the source adapters with the toggle; release
  // preview state when the dialog closes or the selection moves.
  useEffect(() => {
    if (!isOpen) {
      sourcesRef.current = [];
      setResults([]);
      setSelectedCatalogKey(null);
      releasePreviewFace();
      setPreviewFamily(null);
      setInstall({ status: 'idle' });
      return;
    }
    sourcesRef.current = allowFontCatalogs ? getCatalogSources() : [];
    // Opening the browser is an explicit user action — retry any
    // still-missing brand marks (a failed boot fetch must not pin
    // fallback icons for the session).
    if (allowFontCatalogs) void ensureBrandMarks();
  }, [isOpen, allowFontCatalogs]);

  // Debounced online search (~300ms) — an explicit user action per
  // request: typing. No search fires while the toggle is OFF.
  useEffect(() => {
    if (!isOpen || !allowFontCatalogs) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setUnavailable([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const result = await searchCatalogs(sourcesRef.current, q);
      setResults(result.fonts);
      setUnavailable(result.unavailable);
      setSearching(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, allowFontCatalogs]);

  async function beginUpload() {
    setUploading(true);
    try {
      const path = await openDialog({
        filters: [{ name: 'Font', extensions: ['ttf', 'otf', 'woff2'] }],
        multiple: false,
      });
      if (!path || Array.isArray(path)) return;
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

  /** Selecting an online result previews the REAL font: one lazy
   *  download through the single-slot queue, a temp FontFace deleted
   *  on deselection/close. */
  async function selectCatalogFont(font: MergedCatalogFont) {
    releasePreviewFace();
    setPreviewFamily(null);
    setInstall({ status: 'idle' });
    setSelectedCatalogKey(font.key);
    setChosenSource(font.sources.find((s) => !unavailable.includes(s)) ?? font.sources[0] ?? null);
    const source = sourcesRef.current.find((s) => s.id === font.sources[0]);
    const fontForSource = source ? font.perSource[source.id] : undefined;
    if (source && fontForSource) {
      const alias = await loadPreviewFace(font.key, () => source.previewBytes(fontForSource));
      setPreviewFamily(alias);
    }
  }

  function deselectCatalogFont() {
    setSelectedCatalogKey(null);
    releasePreviewFace();
    setPreviewFamily(null);
  }

  /** All-or-nothing install: download every face, then the registry's
   *  addCatalogFont writes + registers (A's verbatim path). Failures
   *  surface a retryable error state — no partial anything. */
  async function installCatalogFont(font: MergedCatalogFont) {
    const id = chosenSource ?? font.sources[0];
    if (!id) return;
    const source = sourcesRef.current.find((s) => s.id === id);
    const fontForSource = font.perSource[id];
    if (!source || !fontForSource) return;
    setInstall({ status: 'installing' });
    try {
      const download = await source.download(fontForSource);
      const entry = await useFontRegistryStore.getState().addCatalogFont({
        family: font.family,
        displayName: font.family,
        catalog: id,
        download,
        direction: font.direction,
      });
      if (!entry) {
        setInstall({ status: 'error' });
        return;
      }
      setInstall({ status: 'idle' });
      deselectCatalogFont();
      select(entry.id);
      setQuery('');
    } catch {
      setInstall({ status: 'error' });
    }
  }

  /** "Use font": apply to the selection via the picker's own path,
   *  note it as recently used, and CLOSE — the next act is selecting
   *  text in the editor, not browsing more fonts. */
  function useThisFont(entry: FontEntry) {
    const editor = useDocumentStore.getState().editor;
    editor?.chain().focus().setFontFamily(entry.family).run();
    useFontRegistryStore.getState().noteRecentFont(entry.family);
    close();
  }

  const rightPaneFont = catalogSelected
    ? (previewFamily ?? catalogSelected.family)
    : installedSelected?.family ?? '';

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="flex w-180 h-115 flex-col overflow-hidden sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Fonts</DialogTitle>
          <DialogDescription>
            Installed fonts{allowFontCatalogs ? ' + online catalogs (Google Fonts, Font Share, Fontsource)' : ' — Tensor\u2019s catalog, your system, and your uploads'}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-4">
          {/* Left pane: toolbar + installed list + online results. */}
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="font-search"
                  className="h-8 pl-7 text-sm"
                  placeholder="Search fonts..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // The preview follows the search — a stale catalog
                    // selection (and its temp face) never outlives
                    // the query it belonged to.
                    deselectCatalogFont();
                  }}
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

            {/* OFF: the banner + Privacy deep-link. ON: nothing — the
                search box above already carries the affordance. */}
            {/* OFF: a slim assurance line — the actionable guidance
                (icon + link) lives in the Online tab's Empty, and the
                Online tab itself stays visible so previously installed
                catalog fonts still list. */}
            {!allowFontCatalogs && (
              <div
                data-testid="catalogs-off-banner"
                className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1.5 text-xs font-medium"
              >
                <CloudOff className="size-3.5 shrink-0 text-muted-foreground" />
                Online catalogs are off
              </div>
            )}

            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  data-testid={`font-filter-${f.id}`}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    sourceFilter === f.id
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => {
                    setSourceFilter(f.id);
                    deselectCatalogFont();
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div data-testid="font-list" className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-1">
              {visible.length === 0 && !searching && results.length === 0 ? (
                sourceFilter === 'catalog' && !allowFontCatalogs ? (
                  <Empty data-testid="font-list-empty" className="h-full gap-2 rounded-none border-0 p-4">
                    <EmptyMedia variant="icon">
                      <CloudOff className="size-4" />
                    </EmptyMedia>
                    <EmptyDescription className="text-xs">
                      Online catalogs are off — no network requests are being made.
                    </EmptyDescription>
                    <button
                      data-testid="catalogs-off-link"
                      className="text-xs text-primary underline underline-offset-2"
                      onClick={() => useSettingsDialogStore.getState().open('privacy')}
                    >
                      Turn on in Settings → Privacy → Fonts
                    </button>
                  </Empty>
                ) : (
                  <Empty data-testid="font-list-empty" className="h-full gap-2 rounded-none border-0 p-4">
                    <EmptyMedia variant="icon">
                      <SearchX className="size-4" />
                    </EmptyMedia>
                    <EmptyDescription className="text-xs">
                      {sourceFilter === 'catalog'
                        ? 'No online fonts installed yet — search above.'
                        : 'No fonts match.'}
                    </EmptyDescription>
                  </Empty>
                )
              ) : (
                visible.map((entry) => (
                  <button
                    key={entry.id}
                    data-testid={`font-row-${entry.id}`}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted ${
                      entry.id === installedSelected?.id && !catalogSelected ? 'bg-muted' : ''
                    }`}
                    onClick={() => {
                      select(entry.id);
                      deselectCatalogFont();
                    }}
                  >
                    <SourceBadge source={entry.source} catalog={entry.catalog} />
                    <span className="truncate text-sm" style={{ fontFamily: entry.family }}>
                      {entry.displayName}
                    </span>
                  </button>
                ))
              )}

              {/* Online results (deduped, source chips). */}
              {allowFontCatalogs && results.length > 0 && (
                <div className={`mt-1 pt-1 ${visible.length > 0 ? 'border-t' : ''}`}>
                  <div className="px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    Online {searching ? '— searching…' : ''}
                  </div>
                  {results.map((font) => (
                    <button
                      key={font.key}
                      data-testid={`catalog-row-${font.key}`}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted ${
                        font.key === selectedCatalogKey ? 'bg-muted' : ''
                      }`}
                      onClick={() => void selectCatalogFont(font)}
                    >
                      <span className="flex shrink-0 items-center gap-0.5">
                        {font.sources.map((id) => (
                          <CatalogChip key={id} id={id} muted={unavailable.includes(id)} />
                        ))}
                      </span>
                      <span className="truncate text-sm">{font.displayName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right pane. */}
          {catalogSelected ? (
            <div className="flex min-h-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5">
                    {catalogSelected.sources.map((id) => (
                      <CatalogChip
                        key={id}
                        id={id}
                        muted={unavailable.includes(id)}
                        onClick={() => setChosenSource(id)}
                      />
                    ))}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{catalogSelected.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {[catalogSelected.variable ? 'Variable' : null, catalogSelected.license]
                        .filter(Boolean)
                        .join(' · ') || 'Online font'}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    data-testid="catalog-install"
                    disabled={install.status === 'installing'}
                    onClick={() => void installCatalogFont(catalogSelected)}
                  >
                    <Check size={14} />
                    {install.status === 'installing' ? 'Installing…' : 'Install'}
                  </Button>
                </div>
              </div>
              {install.status === 'error' && (
                <div data-testid="catalog-install-error" className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs">
                  <span>Install failed — nothing was added. Retry?</span>
                  <Button variant="outline" size="sm" onClick={() => void installCatalogFont(catalogSelected)}>
                    Retry
                  </Button>
                </div>
              )}
              <div
                data-testid="font-detail-preview"
                className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-3 text-foreground"
                style={{ fontFamily: rightPaneFont }}
              >
                {PREVIEW_TEXT}
                <br />
                <b>{PREVIEW_TEXT}</b>
                <br />
                <i>{PREVIEW_TEXT}</i>
              </div>
            </div>
          ) : installedSelected ? (
            <div className="flex min-h-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <SourceBadge source={installedSelected.source} catalog={installedSelected.catalog} />
                  <div>
                    <div className="text-sm font-medium">{installedSelected.displayName}</div>
                    <StyleBadges entry={installedSelected} />
                    {installedSelected.status === 'error' && (
                      <div className="text-xs text-destructive">failed to load</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {(installedSelected.source === 'uploaded' || installedSelected.source === 'catalog') && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="font-uninstall"
                      onClick={() => void uninstall(installedSelected.id)}
                    >
                      Uninstall
                    </Button>
                  )}
                  <Button size="sm" data-testid="font-use" onClick={() => useThisFont(installedSelected)}>
                    <Check size={14} /> Use font
                  </Button>
                </div>
              </div>
              <div
                data-testid="font-detail-preview"
                className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-3 text-foreground"
                style={{ fontFamily: rightPaneFont }}
              >
                {PREVIEW_TEXT}
                <br />
                <b>{PREVIEW_TEXT}</b>
                <br />
                <i>{PREVIEW_TEXT}</i>
              </div>
            </div>
          ) : (
            <Empty data-testid="fonts-none-empty" className="h-full gap-2">
              <EmptyMedia variant="icon">
                <Package className="size-4" />
              </EmptyMedia>
              <EmptyDescription className="text-xs">No fonts installed</EmptyDescription>
            </Empty>
          )}
        </div>

        {/* Upload confirm: the editable family name. */}
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
