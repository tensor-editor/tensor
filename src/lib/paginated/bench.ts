/**
 * M5.10 differential benchmark — Tensor-vs-Tensor across engines.
 * Activates on #bench/?bench, BENCH_AUTO builds, or the 5-click
 * StatusBar trigger; readable in ANY renderer (file channel in Tauri,
 * <pre>/globals in plain browsers).
 *
 * Per doc (SMALL 1-para vs BIG perf-71), it captures:
 *  - steady-state chain: input(dispatch) → relayout ran → canvas 2D
 *    paint executed → next-next rAF (presented). The relayout→effect
 *    gap is the passive-effect ghost candidate.
 *  - burst: 20 dispatches back-to-back — per-dispatch PM view.update
 *    duration (the hidden view's DOM-sync cost, doc-size dependent).
 *  - branch: __m59sync counters — did sync-first fire, or defer to rAF?
 */

import type { Editor } from '@tiptap/core';

export interface ChainStats {
  n: number;
  /** input → relayout executed (ms). ~0 = synchronous-first working. */
  relayout: { mean: number; p95: number };
  /** input → canvas fillText executed (ms). Includes React commit +
   *  passive-effect scheduling — the paint stage. */
  effect: { mean: number; p95: number };
  /** input → next-next rAF (ms). Upper bound on visible latency. */
  presented: { mean: number; p95: number };
}

export interface BurstStats {
  n: number;
  /** Per-dispatch PM view.update duration (ms) — hidden-view DOM sync. */
  viewUpdate: { mean: number; p95: number; max: number };
  /** First dispatch → last relayout landed (ms) — the drain. */
  drainMs: number;
  relayouts: number;
}

export interface BenchResult {
  label: string;
  keystrokes: number;
  viewUpdate: { mean: number; p95: number };
  relayout: { mean: number; p95: number };
  browserFrame: { mean: number; p95: number };
  chain: ChainStats;
  burst: BurstStats;
  branch: { sync: number; deferred: number };
  longTasks: { duration: number; name: string }[];
  hiddenViewNodes: number;
}

function stats(values: number[]): { mean: number; p95: number; max: number } {
  if (values.length === 0) return { mean: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(2),
    p95: +sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
  };
}

export async function runBench(editor: Editor, docHtml: string, label: string): Promise<BenchResult> {
  editor.commands.setContent(docHtml);
  await new Promise((r) => setTimeout(r, 600));

  const g = globalThis as {
    __m567?: { relayouts: Array<{ total: number; at: number }> };
    __m510?: { paints: Array<{ at: number; blockId: string }> };
    __m59sync?: { sync: number; deferred: number };
  };
  g.__m567 = { relayouts: [] };
  g.__m510 = { paints: [] };
  g.__m59sync = { sync: 0, deferred: 0 };

  const longTasks: { duration: number; name: string }[] = [];
  const po = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.push({ duration: +entry.duration.toFixed(1), name: entry.name });
    }
  });
  try { po.observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }

  // --- Steady phase: one keystroke per frame, full chain per key ---
  const N = 10;
  const viewUpdateMs: number[] = [];
  const relayoutMs: number[] = [];
  const browserFrameMs: number[] = [];
  const chainRelayout: number[] = [];
  const chainEffect: number[] = [];
  const chainPresented: number[] = [];

  for (let i = 0; i < N; i++) {
    const inputAt = performance.now();
    editor.view.dispatch(editor.state.tr.insertText('x', 1).scrollIntoView());
    viewUpdateMs.push(performance.now() - inputAt);

    const raf1 = await new Promise<number>((r) => requestAnimationFrame(r));
    const raf2 = await new Promise<number>((r) => requestAnimationFrame(r));
    browserFrameMs.push(raf2 - raf1);

    const rel = g.__m567!.relayouts.find((e) => e.at >= inputAt - 0.5);
    const paint = g.__m510!.paints.find((e) => e.at >= inputAt - 0.5);
    if (rel) {
      relayoutMs.push(rel.total);
      chainRelayout.push(rel.at - inputAt);
    }
    if (paint) chainEffect.push(paint.at - inputAt);
    chainPresented.push(raf2 - inputAt);
  }

  // --- Burst phase: 20 dispatches back-to-back in one task ---
  g.__m567!.relayouts.length = 0;
  g.__m510!.paints.length = 0;
  const burstViewUpdate: number[] = [];
  const burstStart = performance.now();
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    editor.view.dispatch(editor.state.tr.insertText('y', 1).scrollIntoView());
    burstViewUpdate.push(performance.now() - t0);
  }
  await new Promise((r) => setTimeout(r, 200)); // let deferred + coalesced land
  const burstRelayouts = g.__m567!.relayouts;
  const drainMs = burstRelayouts.length
    ? burstRelayouts[burstRelayouts.length - 1]!.at - burstStart
    : -1;

  po.disconnect();

  const hidden = document.querySelector('.pm-input-only');
  return {
    label,
    keystrokes: N,
    viewUpdate: stats(viewUpdateMs),
    relayout: stats(relayoutMs),
    browserFrame: stats(browserFrameMs),
    chain: {
      n: chainRelayout.length,
      relayout: stats(chainRelayout),
      effect: stats(chainEffect),
      presented: stats(chainPresented),
    },
    burst: {
      n: burstViewUpdate.length,
      viewUpdate: stats(burstViewUpdate),
      drainMs: +drainMs.toFixed(1),
      relayouts: burstRelayouts.length,
    },
    branch: { ...g.__m59sync! },
    longTasks: longTasks.filter((t) => t.duration > 10).slice(-8),
    hiddenViewNodes: hidden ? hidden.querySelectorAll('*').length : 0,
  };
}

export function formatBench(r: BenchResult): string {
  return [
    `${r.label}:`,
    `  steady view.update: mean ${r.viewUpdate.mean}ms p95 ${r.viewUpdate.p95}ms`,
    `  steady relayout:   mean ${r.relayout.mean}ms p95 ${r.relayout.p95}ms`,
    `  browserFrame:      mean ${r.browserFrame.mean}ms p95 ${r.browserFrame.p95}ms`,
    `  CHAIN (n=${r.chain.n}): relayout +${r.chain.relayout.mean}ms (p95 ${r.chain.relayout.p95}) | effect +${r.chain.effect.mean}ms (p95 ${r.chain.effect.p95}) | presented +${r.chain.presented.mean}ms (p95 ${r.chain.presented.p95})`,
    `  BURST (n=${r.burst.n}): view.update mean ${r.burst.viewUpdate.mean}ms p95 ${r.burst.viewUpdate.p95}ms max ${r.burst.viewUpdate.max}ms | relayouts ${r.burst.relayouts} | drain ${r.burst.drainMs}ms`,
    `  branch:            sync ${r.branch.sync} deferred ${r.branch.deferred}`,
    `  long tasks (>10ms): ${r.longTasks.length ? r.longTasks.map((t) => `${t.duration}ms`).join(', ') : 'none'}`,
    `  hidden view:       ${r.hiddenViewNodes} DOM nodes`,
  ].join('\n');
}
