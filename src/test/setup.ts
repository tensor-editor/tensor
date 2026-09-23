// jsdom has no canvas implementation — stub the 2D context the painted
// sheets request. Painting correctness is asserted indirectly (geometry
// via element styles, contiguity via the dev assert); measurement is
// deterministic through the injected FakeMetrics, never this stub.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest runs with globals disabled; RTL's auto-cleanup only registers
// against a global afterEach — wire it explicitly or DOM accumulates
// across tests.
afterEach(cleanup);

// jsdom ships no DataTransfer constructor; PM's clipboard handlers only
// use setData/getData/clearData (verified against prosemirror-view).
if (typeof (globalThis as { DataTransfer?: unknown }).DataTransfer === 'undefined') {
  class DataTransferStub {
    private data = new Map<string, string>();
    setData(type: string, value: string) {
      this.data.set(type, value);
    }
    getData(type: string) {
      return this.data.get(type) ?? '';
    }
    clearData() {
      this.data.clear();
    }
    get types() {
      return [...this.data.keys()];
    }
    get files() {
      return [] as File[];
    }
  }
  (globalThis as { DataTransfer?: unknown }).DataTransfer = DataTransferStub;
}

type StubRecord = Record<string, unknown>;

const stubContext: StubRecord = {
  canvas: null,
  fillStyle: '#000',
  font: '',
  textAlign: 'left',
  fillText: () => {},
  clearRect: () => {},
  setTransform: () => {},
  measureText: (text: string) => ({
    width: text.length * 10,
    actualBoundingBoxAscent: 0,
    actualBoundingBoxDescent: 0,
  }),
};

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => stubContext,
  configurable: true,
});