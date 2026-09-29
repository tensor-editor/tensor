import { useEffect, useMemo, useState } from 'react';
import {
  ALargeSmall,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignVerticalSpaceAround,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Highlighter,
  Indent,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Strikethrough,
  Tag,
  Text,
  Type,
  Underline,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconButton } from '@/components/layout/IconButton';
import { ColorPickerButton } from '@/components/layout/ribbon/ColorPickerButton';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import { baselineRunStyle, inlineStyle, resolveRun } from '@/lib/styles/resolve';
import { captureStyleFromSelection } from '@/lib/styles/selection';
import { PT_PER_PX, fontPxToDisplayPt, fontPtToPx } from '@/lib/editor/fontSize';
import { isBuiltinId, type StyleKind, type StyleProperties, type TextTransform } from '@/lib/styles/types';

/**
 * The style editor (M-STYLES STEP 4 + addendum 2), UI-polished:
 *
 * LAYOUT, top to bottom — name/font/font-size, then the EDITABLE
 * centered live preview (no label), then the icon-button tiers
 * (B/I/U/S | alignment | case | colors), then the remaining measure
 * inputs, each wearing its lucide icon in the label. The preview is
 * wired to the SAME resolveRun both render modes use — no parallel
 * preview logic — and its SAMPLE TEXT is editable (type your own).
 *
 * Validation is INK ON THE CONTROL: a missing name rings the name box
 * (aria-invalid), never a floating red line.
 *
 * Measurements speak POINTS at the chrome and commit px (M6-PRE).
 * CREATE mode captures the selection's EFFECTIVE formatting (reverse
 * resolution). SAVING over an existing style is a DEFINITION EDIT
 * through the registry-epoch path — never a stamp.
 */

export interface StyleDialogState {
  open: boolean;
  /** null = create; a style id = edit that definition. */
  editingId: string | null;
  /** Initial kind for create mode (edit mode keeps the definition's). */
  kind: StyleKind;
}

/** IconButton-sized toggle pill for the Paragraph/Text kind. */
function KindToggle({ kind, onChange, disabled }: { kind: StyleKind; onChange: (k: StyleKind) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border" data-testid="style-kind-toggle">
      {([['paragraph', 'Paragraph'], ['character', 'Text']] as const).map(([k, label]) => (
        <Tooltip key={k}>
          <TooltipTrigger
            render={
              <button
                className={`px-2.5 py-1 text-xs transition-colors ${
                  kind === k ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => onChange(k)}
                disabled={disabled}
                aria-pressed={kind === k}
              >
                {label}
              </button>
            }
          />
          <TooltipContent>
            {k === 'paragraph' ? 'Paragraph style — block-level formatting' : 'Text style — span-level formatting'}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function Field({
  label,
  icon,
  children,
  invalid,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  invalid?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className={`flex items-center gap-1.5 text-muted-foreground ${invalid ? 'text-destructive' : ''}`}>
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function SmallIcon({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground [&>svg]:size-3.5">{children}</span>;
}

/** Measurement input: displays pt, commits px (chrome law, M6-PRE). */
function PtField({
  px,
  onChange,
  placeholder,
  min,
  step = 1,
}: {
  px: number | undefined;
  onChange: (px: number | undefined) => void;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <Input
      type="number"
      className="h-7 w-24 text-right"
      value={px != null ? fontPxToDisplayPt(px) : ''}
      min={min != null ? Math.round(min * PT_PER_PX) : undefined}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(undefined);
        const pt = parseFloat(raw);
        if (Number.isFinite(pt)) onChange(fontPtToPx(pt));
      }}
    />
  );
}

const PREVIEW_SAMPLE = 'The quick brown fox jumps over the lazy dog';

export function StyleDialog({ state, onClose }: { state: StyleDialogState; onClose: () => void }) {
  const editor = useDocumentStore((s) => s.editor);
  const merged = useStyleRegistryStore((s) => s.merged);
  const updateDefinition = useStyleRegistryStore((s) => s.updateDefinition);
  const createDefinition = useStyleRegistryStore((s) => s.createDefinition);
  const deleteDefinition = useStyleRegistryStore((s) => s.deleteDefinition);
  const defaultFontFamily = useConfigStore((s) => s.config.editor.defaultFontFamily);
  const defaultFontSize = useConfigStore((s) => s.config.editor.defaultFontSize);

  const editing = state.editingId ? (merged[state.editingId] ?? null) : null;

  const [name, setName] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [kind, setKind] = useState<StyleKind>(state.kind);
  const [properties, setProperties] = useState<StyleProperties>({});

  // Reset the draft when the dialog (re)opens: edit mode seeds from the
  // definition; create mode CAPTURES the selection's effective
  // formatting (reverse resolution — receipt test: a directly-bolded
  // Normal span captures bold: true).
  useEffect(() => {
    if (!state.open) return;
    setNameInvalid(false);
    if (editing) {
      setName(editing.name);
      setKind(editing.kind);
      setProperties({ ...editing.properties });
    } else {
      setKind(state.kind);
      if (editor) {
        const base = baselineRunStyle({ fontFamily: defaultFontFamily, fontSize: defaultFontSize });
        setProperties(captureStyleFromSelection(editor, base, merged));
      } else {
        setProperties({});
      }
      setName(state.kind === 'character' ? 'New Text Style' : 'New Paragraph Style');
    }
    // The capture intentionally runs once per open — re-capturing on
    // every keystroke in the dialog would fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.editingId, state.kind]);

  const set = (patch: Partial<StyleProperties>) =>
    setProperties((p) => {
      const next = { ...p, ...patch };
      for (const key of Object.keys(patch) as Array<keyof StyleProperties>) {
        if (patch[key] === undefined) delete next[key];
      }
      return next;
    });

  // LIVE PREVIEW — the same resolveRun the editor's render paths use,
  // fed the DRAFT definition: exactly what applying it would render.
  const previewStyle = useMemo(() => {
    const base = baselineRunStyle({ fontFamily: defaultFontFamily, fontSize: defaultFontSize });
    const resolved = resolveRun({
      base,
      para: kind === 'paragraph' ? { id: 'draft', name, kind, properties } : null,
      char: kind === 'character' ? { id: 'draft', name, kind, properties } : null,
    });
    return inlineStyle({
      fontFamily: resolved.fontFamily,
      fontSize: resolved.fontSize,
      bold: resolved.bold,
      italic: resolved.italic,
      underline: resolved.underline,
      strike: resolved.strike,
      color: resolved.color !== '#000000' ? resolved.color : undefined,
      highlight: resolved.highlight !== '' ? resolved.highlight : undefined,
      lineHeight: resolved.lineHeight !== 1 ? resolved.lineHeight : undefined,
      textTransform: resolved.textTransform !== 'none' ? resolved.textTransform : undefined,
      fontVariant: resolved.fontVariant !== 'normal' ? resolved.fontVariant : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, kind, defaultFontFamily, defaultFontSize]);

  // Validation is ink on the control: a missing name rings the box.
  const save = () => {
    if (!name.trim()) {
      setNameInvalid(true);
      return;
    }
    setNameInvalid(false);
    try {
      if (editing) {
        // DEFINITION EDIT — the registry-epoch path: every user of the
        // style restyles in both modes; nothing is stamped.
        updateDefinition(editing.id, { name: name.trim(), properties });
      } else {
        createDefinition({ name: name.trim(), kind, properties });
      }
      onClose();
    } catch (err) {
      // Unexpected store rejections (deleted-elsewhere races etc.)
      // surface loudly in dev; the dialog stays open.
      console.error('[styles] save failed:', err);
    }
  };

  const remove = () => {
    if (!editing) return;
    try {
      deleteDefinition(editing.id);
      onClose();
    } catch (err) {
      console.error('[styles] delete failed:', err);
    }
  };

  // Case group: single-select transform buttons (none = all inactive);
  // small caps is independent (fontVariant, not a transform).
  const toggleTransform = (value: TextTransform) =>
    set({ textTransform: properties.textTransform === value ? undefined : value });

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="gap-1">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              <DialogTitle>{editing ? `Edit Style: ${editing.name}` : 'New Style'}</DialogTitle>
              {editing && isBuiltinId(editing.id) && <Badge variant="secondary">Built In</Badge>}
            </div>
            <KindToggle kind={kind} onChange={setKind} disabled={!!editing} />
          </div>
          <DialogDescription>
            {editing
              ? 'Saving restyles every paragraph using this style.'
              : 'Captured from the selection\u2019s effective formatting; saving applies to future uses.'}
          </DialogDescription>
        </DialogHeader>

        {/* Name / font / font size — above the preview. */}
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
          <Field label="Name" icon={<SmallIcon><Tag /></SmallIcon>} invalid={nameInvalid}>
            <Input
              className="h-7 w-36"
              value={name}
              aria-invalid={nameInvalid || undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (nameInvalid && e.target.value.trim()) setNameInvalid(false);
              }}
            />
          </Field>
          <Field label="Font" icon={<SmallIcon><Type /></SmallIcon>}>
            <Input
              className="h-7 w-36"
              placeholder={defaultFontFamily}
              value={properties.fontFamily ?? ''}
              onChange={(e) => set({ fontFamily: e.target.value || undefined })}
            />
          </Field>
          <Field label="Size" icon={<SmallIcon><Text /></SmallIcon>}>
            <PtField
              px={properties.fontSize}
              min={1}
              placeholder={`${fontPxToDisplayPt(defaultFontSize || 16)} pt`}
              onChange={(v) => set({ fontSize: v })}
            />
          </Field>
        </div>

        {/* The EDITABLE live preview — centered, label-less, same
            resolveRun both render modes use. Type your own sample:
            UNCONTROLLED on purpose (constant children mean React never
            diffs the typed text back — the caret survives keystrokes). */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Style preview text"
            data-testid="style-preview"
            spellCheck={false}
            className="min-h-[1.75rem] rounded bg-background p-2 text-center outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
            style={previewStyle}
          >
            {PREVIEW_SAMPLE}
          </div>
        </div>

        {/* Icon tiers: B/I/U/S | alignment | case | colors. */}
        <div className="flex flex-wrap items-center mx-auto gap-0.5">
          <IconButton
            label="Bold"
            icon={<Bold size={16} />}
            active={properties.bold === true}
            onClick={() => set({ bold: properties.bold === true ? undefined : true })}
          />
          <IconButton
            label="Italic"
            icon={<Italic size={16} />}
            active={properties.italic === true}
            onClick={() => set({ italic: properties.italic === true ? undefined : true })}
          />
          <IconButton
            label="Underline"
            icon={<Underline size={16} />}
            active={properties.underline === true}
            onClick={() => set({ underline: properties.underline === true ? undefined : true })}
          />
          <IconButton
            label="Strikethrough"
            icon={<Strikethrough size={16} />}
            active={properties.strike === true}
            onClick={() => set({ strike: properties.strike === true ? undefined : true })}
          />

          {kind === 'paragraph' && (
            <>
              <GroupDivider />
              {(
                [
                  ['left', <AlignLeft size={16} key="l" />, 'Align Left'],
                  ['center', <AlignCenter size={16} key="c" />, 'Align Center'],
                  ['right', <AlignRight size={16} key="r" />, 'Align Right'],
                  ['justify', <AlignJustify size={16} key="j" />, 'Align Justify'],
                ] as const
              ).map(([value, icon, label]) => (
                <IconButton
                  key={value}
                  label={label}
                  icon={icon}
                  active={(properties.textAlign ?? 'left') === value}
                  onClick={() =>
                    set({ textAlign: value === 'left' ? undefined : (value as StyleProperties['textAlign']) })
                  }
                />
              ))}
            </>
          )}

          <GroupDivider />
          <IconButton
            label="Small Caps"
            icon={<ALargeSmall size={16} />}
            active={properties.fontVariant === 'small-caps'}
            onClick={() =>
              set({ fontVariant: properties.fontVariant === 'small-caps' ? undefined : 'small-caps' })
            }
          />
          <IconButton
            label="UPPERCASE"
            icon={<CaseUpper size={16} />}
            active={properties.textTransform === 'uppercase'}
            onClick={() => toggleTransform('uppercase')}
          />
          <IconButton
            label="lowercase"
            icon={<CaseLower size={16} />}
            active={properties.textTransform === 'lowercase'}
            onClick={() => toggleTransform('lowercase')}
          />
          <IconButton
            label="Title Case"
            icon={<CaseSensitive size={16} />}
            active={properties.textTransform === 'title-case' || properties.textTransform === 'capitalize'}
            onClick={() => toggleTransform('title-case')}
          />

          <GroupDivider />
          <ColorPickerButton
            label="Text Color"
            resetLabel="Automatic"
            icon={<span className="text-sm font-semibold">A</span>}
            defaultColor={properties.color ?? '#000000'}
            onChange={(color) => set({ color: color ?? undefined })}
          />
          <ColorPickerButton
            label="Highlight Color"
            resetLabel="Transparent"
            icon={<Highlighter size={16} />}
            defaultColor={properties.highlight ?? ''}
            onChange={(color) => set({ highlight: color || undefined })}
          />
        </div>

        {/* Measure inputs, icons in their labels. */}
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Field label="Line height" icon={<SmallIcon><AlignVerticalSpaceAround /></SmallIcon>}>
            <Input
              type="number"
              className="h-7 w-24 text-right"
              value={properties.lineHeight ?? ''}
              min={0.25}
              step={0.05}
              placeholder="1.0"
              onChange={(e) => {
                if (e.target.value === '') return set({ lineHeight: undefined });
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n > 0) set({ lineHeight: n });
              }}
            />
          </Field>

          {kind === 'paragraph' && (
            <>
              <Field label="Space before" icon={<SmallIcon><ArrowUpToLine /></SmallIcon>}>
                <PtField px={properties.spaceBefore} min={0} placeholder="0 pt" onChange={(v) => set({ spaceBefore: v })} />
              </Field>
              <Field label="Space after" icon={<SmallIcon><ArrowDownToLine /></SmallIcon>}>
                <PtField px={properties.spaceAfter} min={0} placeholder="0 pt" onChange={(v) => set({ spaceAfter: v })} />
              </Field>
              <Field label="Indent left" icon={<SmallIcon><IndentIncrease /></SmallIcon>}>
                <PtField px={properties.indentLeft} min={0} placeholder="0 pt" onChange={(v) => set({ indentLeft: v })} />
              </Field>
              <Field label="Indent right" icon={<SmallIcon><IndentDecrease /></SmallIcon>}>
                <PtField px={properties.indentRight} min={0} placeholder="0 pt" onChange={(v) => set({ indentRight: v })} />
              </Field>
              <Field label="First-line indent" icon={<SmallIcon><Indent /></SmallIcon>}>
                <PtField px={properties.firstLineIndent} placeholder="0 pt" onChange={(v) => set({ firstLineIndent: v })} />
              </Field>
            </>
          )}
        </div>

        <DialogFooter>
          {editing && !isBuiltinId(editing.id) && (
            <Button variant="outline" className="text-destructive" onClick={remove}>
              Delete
            </Button>
          )}
          {editing && isBuiltinId(editing.id) && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" className="gap-1.5 opacity-60" disabled>
                    Delete
                  </Button>
                }
              />
              <TooltipContent>Built-in styles cannot be deleted</TooltipContent>
            </Tooltip>
          )}
          <Button onClick={save}>{editing ? 'Save Style' : 'Create Style'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupDivider() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}
