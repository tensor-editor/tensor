import { create } from "zustand";
import { ConfigSchema, DEFAULT_CONFIG, type Config } from "./schema";
import { SHORTCUTS } from "../shortcuts";

interface ConfigStore {
  config: Config;

  setTheme: (theme: Config["theme"]) => void;
  addCustomColor: (color: string) => void;
  removeCustomColor: (color: string) => void;
  setUseFloatingToolbar: (value: boolean) => void;
  setReduceMotion: (value: Config["accessibility"]["reduceMotion"]) => void;
  setSelectionColor: (value: string) => void;
  setMeasurementUnit: (value: Config["editor"]["measurementUnit"]) => void;
  setPasteOnMiddleClick: (value: boolean) => void;

  setKeybinding: (id: string, keys: string) => void;
  resetKeybinding: (id: string) => void;
  resetAllKeybindings: () => void;

  setFetchLinkMetadata: (value: boolean) => void;
  setAutoCheckForUpdates: (value: boolean) => void;

  loadConfig: (raw: unknown) => void;
}

export const useConfigStore = create<ConfigStore>((set) => ({
  config: DEFAULT_CONFIG,

  setTheme: (theme) =>
    set((state) => ({
      config: { ...state.config, theme },
    })),

  addCustomColor: (color) =>
    set((state) => {
      if (state.config.editor.customColors.includes(color)) return state; // no duplicates
      return {
        config: {
          ...state.config,
          editor: {
            ...state.config.editor,
            customColors: [...state.config.editor.customColors, color],
          },
        },
      };
    }),

  removeCustomColor: (color) =>
    set((state) => ({
      config: {
        ...state.config,
        editor: {
          ...state.config.editor,
          customColors: state.config.editor.customColors.filter(
            (c) => c !== color,
          ),
        },
      },
    })),

  setUseFloatingToolbar: (value) =>
    set((state) => ({
      config: { ...state.config, useFloatingToolbar: value },
    })),

  setReduceMotion: (value) =>
    set((state) => ({
      config: {
        ...state.config,
        accessibility: { ...state.config.accessibility, reduceMotion: value },
      },
    })),

  setSelectionColor: (value) =>
    set((state) => ({
      config: {
        ...state.config,
        editor: { ...state.config.editor, selectionColor: value },
      },
    })),

  setMeasurementUnit: (value) =>
    set((state) => ({
      config: {
        ...state.config,
        editor: { ...state.config.editor, measurementUnit: value },
      },
    })),

  setPasteOnMiddleClick: (value) =>
    set((state) => ({
      config: {
        ...state.config,
        editor: { ...state.config.editor, pasteOnMiddleClick: value },
      },
    })),

  setKeybinding: (id, keys) =>
    set((state) => ({
      config: {
        ...state.config,
        keybindings: { ...state.config.keybindings, [id]: keys },
      },
    })),

  resetKeybinding: (id) =>
    set((state) => {
      const def = SHORTCUTS.find((s) => s.id === id);
      if (!def) return state;
      return {
        config: {
          ...state.config,
          keybindings: { ...state.config.keybindings, [id]: def.keys },
        },
      };
    }),

  resetAllKeybindings: () =>
    set((state) => ({
      config: {
        ...state.config,
        keybindings: Object.fromEntries(
          SHORTCUTS.filter((s) => s.context !== "os").map((s) => [
            s.id,
            s.keys,
          ]),
        ),
      },
    })),

  setFetchLinkMetadata: (value: boolean) =>
    set((state) => ({
      config: {
        ...state.config,
        privacy: { ...state.config.privacy, fetchLinkMetadata: value },
      },
    })),

  setAutoCheckForUpdates: (value: boolean) =>
    set((state) => ({
      config: {
        ...state.config,
        privacy: { ...state.config.privacy, autoCheckForUpdates: value },
      },
    })),

  loadConfig: (raw) => {
    const result = ConfigSchema.safeParse(raw);
    if (result.success) {
      set({ config: result.data });
    } else {
      console.warn(
        "Invalid config file, falling back to defaults",
        result.error,
      );
      set({ config: DEFAULT_CONFIG });
    }
  },
}));
