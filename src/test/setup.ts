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

// Recorded canvas ops, readable by tests via (globalThis as any).__paintOps
// (reset it before the assertion window).
const paintOps: Array<{ op: string; args: unknown[] }> = [];
(globalThis as { __paintOps?: typeof paintOps }).__paintOps = paintOps;

const stubContext: StubRecord = {
  canvas: null,
  fillStyle: '#000',
  font: '',
  textAlign: 'left',
  fillText: (...args: unknown[]) => paintOps.push({ op: 'fillText', args }),
  fillRect: (...args: unknown[]) => paintOps.push({ op: 'fillRect', args }),
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

// jsdom ships no IntersectionObserver. The stub auto-reports every
// observed element as visible (default), which keeps the whole tree
// mounted for existing tests; the virtualization test flips
// `auto` off and drives `instances[n].callback(entries, observer)`
// by hand.
class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];
  static auto = true;
  callback: (entries: unknown[], observer: unknown) => void;
  targets = new Set<Element>();
  constructor(cb: (entries: unknown[], observer: unknown) => void) {
    this.callback = cb;
    IntersectionObserverStub.instances.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
    if (IntersectionObserverStub.auto) {
      const target = el;
      queueMicrotask(() =>
        this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this)
      );
    }
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
(globalThis as { __IO?: typeof IntersectionObserverStub }).__IO = IntersectionObserverStub;