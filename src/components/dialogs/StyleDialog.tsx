import { useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import { baselineRunStyle, inlineStyle, resolveRun } from '@/lib/styles/resolve';
import { captureStyleFromSelection } from '@/lib/styles/selection';
import { isBuiltinId, type StyleKind, type StyleProperties } from '@/lib/styles/types';

/**
 * The style editor (M-STYLES STEP 4 + addendum 2): name + property
 * fields + a LIVE PREVIEW paragraph wired to the SAME resolveRun the
 * editor resolves through (no parallel preview logic — the preview
 * renders the draft definition's inlineStyle, the one CSS serializer
 * the pageless sheet uses).
 *
 * CREATE mode opens with the selection's EFFECTIVE formatting captured
 * (reverse resolution). SAVING over an existing style is a DEFINITION
 * EDIT through the registry store — the epoch bump restyles every
 * user in both modes; nothing is ever stamped onto nodes.
 */

export interface StyleDialogState {
  open: boolean;
  /** null = create; a style id = edit that definition. */
  editingId: string | null;
  /** Initial kind for create mode (edit mode keeps the definition's). */
  kind: StyleKind;
}

interface PropertyFieldProps {
  label: string;
  children: React.ReactNode;
}

function PropertyField({ label, children }: PropertyFieldProps) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  value,
  onChange,
  placeholder,
  min,
  step = 1,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <Input
      type="number"
      className="h-7 w-24 text-right"
      value={value ?? ''}
      min={min}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(undefined);
        const n = parseFloat(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

const TRANSFORM_OPTIONS: Array<{ value: StyleProperties['textTransform']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'capitalize', label: 'Capitalize Words' },
  { value: 'title-case', label: 'Title Case' },
];

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
  const [kind, setKind] = useState<StyleKind>(state.kind);
  const [properties, setProperties] = useState<StyleProperties>({});
  const [error, setError] = useState<string | null>(null);

  // Reset the draft when the dialog (re)opens: edit mode seeds from the
  // definition; create mode CAPTURES the selection's effective
  // formatting (reverse resolution — receipt test: a directly-bolded
  // Normal span captures bold: true).
  useEffect(() => {
    if (!state.open) return;
    setError(null);
    if (editing) {
      setName(editing.name);
      setKind(editing.kind);
      setProperties({ ...editing.properties });
    } else {
      setKind(state.kind);
      if (editor) {
        const base = baselineRunStyle({ fontFamily: defaultFontFamily, fontSize: defaultFontSize });
        const captured = captureStyleFromSelection(editor, base, merged);
        setProperties(captured);
      } else {
        setProperties({});
      }
      setName(state.kind === 'character' ? 'New Character Style' : 'New Paragraph Style');
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
      lineHeight: resolved.lineHeight !== 1 ? resolved.lineHeight : undefined,
      textTransform: resolved.textTransform !== 'none' ? resolved.textTransform : undefined,
      fontVariant: resolved.fontVariant !== 'normal' ? resolved.fontVariant : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, kind, defaultFontFamily, defaultFontSize]);

  const save = () => {
    if (!name.trim()) {
      setError('A style needs a name.');
      return;
    }
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
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = () => {
    if (!editing) return;
    try {
      deleteDefinition(editing.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Style: ${editing.name}` : 'New Style'}</DialogTitle>
          <DialogDescription>
            {editing
              ? isBuiltinId(editing.id)
                ? 'Built-in style — edits restyle every paragraph using it (never deletable).'
                : 'Saving restyles every paragraph using this style.'
              : 'Captured from the selection\u2019s effective formatting; saving applies to future uses.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <PropertyField label="Name">
            <Input className="h-7 w-48" value={name} onChange={(e) => setName(e.target.value)} />
          </PropertyField>

          {!editing && (
            <PropertyField label="Kind">
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as StyleKind)}
              >
                <SelectTrigger className="h-7 w-48" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragraph">Paragraph</SelectItem>
                  <SelectItem value="character">Character</SelectItem>
                </SelectContent>
              </Select>
            </PropertyField>
          )}

          <PropertyField label="Font family">
            <Input
              className="h-7 w-48"
              placeholder={defaultFontFamily}
              value={properties.fontFamily ?? ''}
              onChange={(e) => set({ fontFamily: e.target.value || undefined })}
            />
          </PropertyField>
          <PropertyField label="Font size (px)">
            <NumberField
              value={properties.fontSize}
              min={1}
              placeholder={String(defaultFontSize)}
              onChange={(v) => set({ fontSize: v })}
            />
          </PropertyField>

          <div className="flex items-center gap-5 pt-1">
            {(['bold', 'italic', 'underline', 'strike'] as const).map((key) => (
              <label key={key} className="flex items-center gap-1.5 text-sm capitalize">
                <Switch
                  size="sm"
                  checked={properties[key] === true}
                  onCheckedChange={(checked) => set({ [key]: checked || undefined } as Partial<StyleProperties>)}
                />
                {key}
              </label>
            ))}
          </div>

          <PropertyField label="Color">
            <input
              type="color"
              className="h-7 w-12 cursor-pointer rounded border border-input bg-transparent"
              value={properties.color ?? '#000000'}
              onChange={(e) => set({ color: e.target.value === '#000000' ? undefined : e.target.value })}
            />
          </PropertyField>

          <PropertyField label="Line height">
            <NumberField
              value={properties.lineHeight}
              min={0.25}
              step={0.05}
              placeholder="1.0"
              onChange={(v) => set({ lineHeight: v })}
            />
          </PropertyField>

          {kind === 'paragraph' && (
            <>
              <PropertyField label="Space before (px)">
                <NumberField
                  value={properties.spaceBefore}
                  min={0}
                  placeholder="0"
                  onChange={(v) => set({ spaceBefore: v })}
                />
              </PropertyField>
              <PropertyField label="Space after (px)">
                <NumberField
                  value={properties.spaceAfter}
                  min={0}
                  placeholder="0"
                  onChange={(v) => set({ spaceAfter: v })}
                />
              </PropertyField>
              <PropertyField label="Indent left (px)">
                <NumberField
                  value={properties.indentLeft}
                  min={0}
                  placeholder="0"
                  onChange={(v) => set({ indentLeft: v })}
                />
              </PropertyField>
              <PropertyField label="Indent right (px)">
                <NumberField
                  value={properties.indentRight}
                  min={0}
                  placeholder="0"
                  onChange={(v) => set({ indentRight: v })}
                />
              </PropertyField>
              <PropertyField label="First-line indent (px)">
                <NumberField
                  value={properties.firstLineIndent}
                  placeholder="0"
                  onChange={(v) => set({ firstLineIndent: v })}
                />
              </PropertyField>
              <PropertyField label="Alignment">
                <Select
                  value={properties.textAlign ?? 'left'}
                  onValueChange={(v) =>
                    set({ textAlign: (v === 'left' ? undefined : v) as StyleProperties['textAlign'] })
                  }
                >
                  <SelectTrigger className="h-7 w-24" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyField>
            </>
          )}

          <PropertyField label="Small caps">
            <Select
              value={properties.fontVariant ?? 'normal'}
              onValueChange={(v) =>
                set({ fontVariant: (v === 'normal' ? undefined : v) as StyleProperties['fontVariant'] })
              }
            >
              <SelectTrigger className="h-7 w-24" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="small-caps">Small Caps</SelectItem>
              </SelectContent>
            </Select>
          </PropertyField>

          <PropertyField label="Text transform">
            <Select
              value={properties.textTransform ?? 'none'}
              onValueChange={(v) =>
                set({ textTransform: (v === 'none' ? undefined : v) as StyleProperties['textTransform'] })
              }
            >
              <SelectTrigger className="h-7 w-32" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSFORM_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value!}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyField>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 text-xs text-muted-foreground">Live preview (resolveRun)</div>
            <div className="rounded bg-background p-2" style={{ minHeight: '1.5rem' }}>
              <span data-testid="style-preview" style={previewStyle}>
                The quick brown fox jumps over the lazy dog
              </span>
            </div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          {editing && !isBuiltinId(editing.id) && (
            <Button variant="outline" className="gap-1.5 text-destructive" onClick={remove}>
              <Trash2 size={14} />
              Delete
            </Button>
          )}
          {editing && isBuiltinId(editing.id) && (
            <Button variant="outline" className="gap-1.5 opacity-60" disabled title="Built-in styles cannot be deleted">
              <Trash2 size={14} />
              Delete
            </Button>
          )}
          <Button onClick={save}>
            <Pencil size={14} className="mr-1" />
            {editing ? 'Save Style' : 'Create Style'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
