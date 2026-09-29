import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { DEFAULT_CONFIG, type Config } from './schema';

const CONFIG_FILENAME = 'config.json';

async function getConfigPath(): Promise<string> {
  const dir = await appConfigDir();
  return join(dir, CONFIG_FILENAME);
}

export async function loadConfigFromDisk(): Promise<unknown> {
  const path = await getConfigPath();

  if (!(await exists(path))) {
    return {}; // no file yet — schema defaults will fill everything in
  }

  const raw = await readTextFile(path);
  try {
    return JSON.parse(raw);
  } catch {
    return {}; // corrupted file — fall back to defaults, don't crash
  }
}

export async function saveConfigToDisk(config: Config): Promise<void> {
  try {
    const dir = await appConfigDir();
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    const path = await getConfigPath();
    await writeTextFile(path, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to save config to disk:', err);
  }
}

/**
 * Opens the OS file manager with config.json highlighted, for the
 * Settings > About "Configuration Files" button. In the extremely narrow
 * window where a user opens Settings before the very first debounced
 * save has landed (in practice, the load effect in useConfigPersistence
 * itself triggers an initial re-save almost immediately, so this is
 * mostly a defensive fallback), writes DEFAULT_CONFIG once first so
 * there's actually a real file to reveal rather than failing silently.
 */
export async function revealConfigFile(): Promise<void> {
  const path = await getConfigPath();

  if (!(await exists(path))) {
    const dir = await appConfigDir();
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    await writeTextFile(path, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  await revealItemInDir(path);
}
