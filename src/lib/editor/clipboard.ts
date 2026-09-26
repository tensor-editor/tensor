import { readText } from '@tauri-apps/plugin-clipboard-manager';
import type { Editor } from '@tiptap/core';

/** Menu-driven paste: execCommand('paste') is blocked by web engines, so
 * the Edit menu reads the system clipboard and replays it through PM's
 * own paste handler on the hidden view — a synthetic event, never a
 * reimplementation of PM's insertion logic. Plain text only (the plugin
 * has no readHtml); native Ctrl+V keeps the rich path. */
export async function pasteFromSystemClipboard(editor: Editor): Promise<void> {
  let text: string;
  try {
    text = await readText();
  } catch {
    return;
  }
  if (!text) return;
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  // Event + pinned property rather than the ClipboardEvent constructor:
  // identical to what PM's handler reads, and works everywhere.
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  (editor.view.dom as HTMLElement).dispatchEvent(ev);
}
