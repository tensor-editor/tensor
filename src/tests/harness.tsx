import { render, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Editor } from '@/components/editor/Editor';
import { useDocumentStore } from '@/lib/document/store';
import { FakeMetrics } from './fakeMetrics';

/** Renders the REAL production <Editor/> (tensorExtensions, mode routing,
 * PaginatedView) with deterministic FakeMetrics injected through the
 * STEP 3 seam, optionally replacing the document content. */
export function renderTensor(initialHTML?: string) {
  const utils = render(<Editor metrics={FakeMetrics} />);
  const editor = useDocumentStore.getState().editor;
  if (!editor) throw new Error('editor not in document store after render');
  if (initialHTML) {
    act(() => {
      editor.commands.setContent(initialHTML);
    });
  }
  return { editor, ...utils };
}

/** Renders <Editor/> inside the app-shaped scroll container (App.tsx's
 * `absolute inset-0 overflow-auto`), for scroll-behavior assertions. */
export function renderTensorInScrollContainer(initialHTML?: string) {
  let utils: ReturnType<typeof render> | null = null;
  const el: ReactElement = (
    <div
      data-testid="scroll-container"
      style={{ overflow: 'auto', height: 400, width: 900 }}
    >
      <Editor metrics={FakeMetrics} />
    </div>
  );
  utils = render(el);
  const editor = useDocumentStore.getState().editor;
  if (!editor) throw new Error('editor not in document store after render');
  if (initialHTML) {
    act(() => {
      editor.commands.setContent(initialHTML);
    });
  }
  return { editor, ...utils };
}

/** Content width/height numbers under FakeMetrics + default Letter setup. */
export const GEOMETRY = {
  pageWidth: 816,
  pageHeight: 1056,
  contentX: 96,
  contentY: 96,
  contentWidth: 624,
  contentHeight: 864,
  charsPerLine: 62,
  linesPerPage: 54,
} as const;