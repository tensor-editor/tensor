import { useEffect, useRef } from 'react';
import { useConfigStore } from '../config/store';
import { useDocumentStore } from './store';
import { saveDocument } from './fileOperations';
import { clearRecoveryCopy, saveRecoveryCopy } from './recovery';

export function useAutosave() {
  const revision = useDocumentStore((s) => s.revision);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const intervalMs = useConfigStore((s) => s.config.autosaveIntervalMs);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDirty) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { editor, filePath, pageSetup } = useDocumentStore.getState();
      if (!editor) return;

      await saveRecoveryCopy(editor, filePath);

      if (filePath) {
        await saveDocument(editor, filePath, pageSetup);
        await clearRecoveryCopy(filePath);
        useDocumentStore.setState({ isDirty: false });
      }
    }, intervalMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [revision, intervalMs, isDirty]);
}
