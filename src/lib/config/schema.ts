import { z } from 'zod';
import { PAGE_GAP, DEFAULT_MARGINS } from '../document/pageSetup';
import { SHORTCUTS } from '../shortcuts';

const DEFAULT_KEYBINDINGS: Record<string, string> = Object.fromEntries(
  SHORTCUTS.filter((s) => s.context !== 'os').map((s) => [s.id, s.keys]),
);

export const ConfigSchema = z.object({
  theme: z.enum(['light', 'dark']).default('light'),
  autosaveIntervalMs: z.number().default(5000),
  useFloatingToolbar: z.boolean().default(true),
  editor: z.object({
    defaultFontFamily: z.string().default('system-ui'),
    defaultFontSize: z.number().default(16),
    defaultPageLayout: z.string().default('Pages'),
    defaultPageSize: z.string().default('Letter'),
    defaultPageGap: z.number().default(PAGE_GAP),
    defaultMargins: z.object({
      top: z.number(),
      bottom: z.number(),
      left: z.number(),
      right: z.number(),
    }).default(DEFAULT_MARGINS),
    colorDisplayFormat: z.enum(['hex', 'rgb', 'hsl']).default('hex'),
    customColors: z.array(z.string()).default([]),
    showNonPrintingChars: z.boolean().default(false),
    zoomLevel: z.number().default(100),
  }).default({
    defaultFontFamily: 'system-ui',
    defaultFontSize: 16,
    defaultPageLayout: 'Pages',
    defaultPageSize: 'Letter',
    defaultPageGap: PAGE_GAP,
    defaultMargins: DEFAULT_MARGINS,
    colorDisplayFormat: 'hex',
    customColors: [],
    showNonPrintingChars: false,
    zoomLevel: 100,
  }),
  privacy: z.object({
    autoCheckForUpdates: z.boolean().default(false),
    fetchLinkMetadata: z.boolean().default(true),
  }).default({
    autoCheckForUpdates: false,
    fetchLinkMetadata: true
  }),
  accessibility: z.object({
    reduceMotion: z.enum(['system', 'on', 'off']).default('system'),
  }).default({
    reduceMotion: 'system',
  }),
  /** Keyed by ShortcutDefinition.id (see src/lib/shortcuts.ts). Flat
   *  record rather than a fixed shape — every command in the Shortcuts
   *  registry gets an entry here, seeded from that registry's defaults.
   *  An empty string value means "explicitly unbound". Missing keys
   *  (e.g. a persisted config from before a given shortcut existed) fall
   *  back to the registry default via getEffectiveKeybinding() — never
   *  index this object directly. */
  keybindings: z.record(z.string(), z.string()).default(DEFAULT_KEYBINDINGS),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});
