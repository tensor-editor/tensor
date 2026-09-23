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