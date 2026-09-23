import { writeTextFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { Editor } from '@tiptap/core';
import { CURRENT_DOCUMENT_VERSION, type DocumentFile } from './schema';
import type { PageSetup } from './pageSetup';

// Stable per-app-launch id, used for recovery files of never-yet-saved
// documents (no real filePath to derive an identity from).
const SESSION_ID = crypto.randomUUID();

async function hashPath(path: string): Promise<string> {
  const data = new TextEncoder().encode(path);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16); // short prefix is plenty, this just needs to avoid collisions
}

async function getRecoveryPath(originalPath: string | null): Promise<string> {
  const dir = await appDataDir();
  const recoveryDir = await join(dir, 'recovery');
  if (!(await exists(recoveryDir))) {
    await mkdir(recoveryDir, { recursive: true });
  }
  const key = originalPath ? await hashPath(originalPath) : SESSION_ID;
  return join(recoveryDir, `${key}.wpdoc`);
}

export async function saveRecoveryCopy(
  editor: Editor,
  originalPath: string | null,
  pageSetup: PageSetup
): Promise<void> {
  try {
    const file: DocumentFile = {
      version: CURRENT_DOCUMENT_VERSION,
      docJSON: editor.getJSON(),
      metadata: {
        modifiedAt: new Date().toISOString(),
        originalPath: originalPath ?? undefined,
        pageSetup,
      },
    };
    const path = await getRecoveryPath(originalPath);
    await writeTextFile(path, JSON.stringify(file, null, 2));
  } catch (err) {
    console.error('Autosave failed:', err);
  }
}

export async function clearRecoveryCopy(originalPath: string | null): Promise<void> {
  try {
    const path = await getRecoveryPath(originalPath);
    if (await exists(path)) {
      await remove(path);
    }
  } catch (err) {
    console.error('Failed to clear recovery copy:', err);
  }
}
