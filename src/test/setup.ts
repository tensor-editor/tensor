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
// (reset it before the assertion window). fillStyle rides along so
// style-color edits are assertable (M-STYLES paint-only epoch).
const paintOps: Array<{ op: string; args: unknown[]; fillStyle?: string; font?: string }> = [];
(globalThis as { __paintOps?: typeof paintOps }).__paintOps = paintOps;

const stubContext: StubRecord = {
  canvas: null,
  fillStyle: '#000',
  font: '',
  fontVariantCaps: 'normal',
  textAlign: 'left',
  fillText: function (this: StubRecord, ...args: unknown[]) {
    paintOps.push({ op: 'fillText', args, fillStyle: this.fillStyle as string, font: this.font as string });
  },
  fillRect: function (this: StubRecord, ...args: unknown[]) {
    paintOps.push({ op: 'fillRect', args, fillStyle: this.fillStyle as string });
  },
  clearRect: () => {},
  setTransform: () => {},
  measureText: (text: string) => ({
    width: text.length * 10,
    actualBoundingBoxAscent: 0,
    actualBoundingBoxDescent: 0,
  }),
  drawImage: function (this: StubRecord, ...args: unknown[]) {
    // M-IMAGES-1: image paint ops — args[1..4] are x/y/w/h when the
    // 9-arg form is used (img, x, y, w, h = 5-arg form at 1..4).
    paintOps.push({ op: 'drawImage', args, fillStyle: this.fillStyle as string });
  },
  // M-IMAGES-1.5: the corner-radius clip path (roundRect + clip
  // recorded; the path builders are no-ops — geometry rides the
  // recorded ops).
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  arcTo: () => {},
  closePath: () => {},
  save: () => {},
  restore: () => {},
  clip: function (this: StubRecord, ...args: unknown[]) {
    paintOps.push({ op: 'clip', args, fillStyle: this.fillStyle as string });
  },
  roundRect: function (this: StubRecord, ...args: unknown[]) {
    paintOps.push({ op: 'roundRect', args, fillStyle: this.fillStyle as string });
  },
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
// jsdom ships no ResizeObserver; cmdk's CommandList observes its own
// height on mount (the palette renders CommandList). No-op stub keeps
// the component renderable in jsdom.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom ships no scrollIntoView; cmdk scrolls its selected item into
// view on mount/selection (the palette). No-op keeps it renderable.
if (typeof (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView === 'undefined') {
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = () => {};
}

// jsdom ships no CSS Font Loading API — no document.fonts, no FontFace
// global. M-FONTS-A registers faces against that API; these stubs give
// the registry's REAL code path an honest recording surface for tests:
// added faces are tracked (globally readable via __fontFaces), and
// load("<weight> <size>px <family>") resolves the faces registered for
// that family — the bold-resolution receipts ride it. No glyph
// rasterization happens here (jsdom has none); geometry comes from the
// injected metrics seam as always.
class FontFaceStub {
  static instances: FontFaceStub[] = [];
  family: string;
  descriptors: { weight?: string; style?: string };
  status: 'unloaded' | 'loaded' | 'error' = 'unloaded';
  constructor(
    family: string,
    _source: ArrayBuffer | string,
    descriptors: { weight?: string; style?: string } = {},
  ) {
    this.family = family;
    this.descriptors = descriptors;
    FontFaceStub.instances.push(this);
  }
  load() {
    this.status = 'loaded';
    return Promise.resolve(this);
  }
}
(globalThis as { FontFace?: unknown }).FontFace = FontFaceStub;
(globalThis as { __fontFaces?: typeof FontFaceStub }).__fontFaces = FontFaceStub;

class FontFaceSetStub {
  private faces: FontFaceStub[] = [];
  add(face: FontFaceStub) {
    if (!this.faces.includes(face)) this.faces.push(face);
  }
  delete(face: FontFaceStub) {
    const i = this.faces.indexOf(face);
    if (i >= 0) this.faces.splice(i, 1);
  }
  has(face: FontFaceStub) {
    return this.faces.includes(face);
  }
  get size() {
    return this.faces.length;
  }
  *[Symbol.iterator]() {
    yield* this.faces;
  }
  check() {
    return true;
  }
  /** "<italic?> <weight?> <size>px <family>" → faces whose registered
   *  descriptors satisfy the request (the bold-resolution receipts:
   *  an entry claiming bold must resolve '700 …' from its OWN bold
   *  face — a regular-only family must NOT). Variable-style stubs are
   *  out of scope; the app-world axis story lives in fontString's
   *  comment. */
  async load(font: string) {
    const m = /(\d+)px\s+(.+)$/.exec(font);
    if (!m) return [];
    const wantsItalic = /^\s*italic\b/.test(font);
    const weightMatch = /(\d{3})\s/.exec(font);
    const wantsWeight = weightMatch ? weightMatch[1]! : '400';
    return this.faces.filter(
      (f) =>
        f.family === m![2] &&
        (f.descriptors.weight === wantsWeight || f.descriptors.weight === undefined) &&
        (wantsItalic ? f.descriptors.style === 'italic' : true),
    );
  }
  get ready() {
    return Promise.resolve(this);
  }
}
Object.defineProperty(document, 'fonts', { value: new FontFaceSetStub(), configurable: true });
