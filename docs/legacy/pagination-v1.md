# Pagination engine — engineering reference

This document explains how the fake-multi-page-in-a-single-scrollable-DOM
pagination system actually works. It's aimed at an engineer who has never
touched this code before and needs to modify it without reintroducing bugs
that have already been found and fixed once.

## The core idea

The document is one continuous ProseMirror/TipTap document — there is no
real per-page splitting of the content model. "Pages" are a pure rendering
illusion built from two things layered on top of a single flowing document:

1. **Page background rectangles** — absolutely-positioned white boxes
   (`PaginatedEditor.tsx`) drawn behind the content at fixed heights
   (`pageOffsets`), purely cosmetic.
2. **Spacer widgets** — invisible ProseMirror decorations inserted into the
   content flow at the exact document positions where a page should end
   (`PaginationExtension.ts`). Each spacer is tall enough to push everything
   after it down past the bottom margin of the current page and the top
   margin of the next one. There is no `overflow: hidden` or page clipping
   anywhere — pushing content down with spacer height *is* the pagination.

Because of this, "finding where pages break" reduces to one problem:
**measure the live rendered DOM and figure out, for a given usable page
height, exactly which document positions need a spacer inserted before
them.** That's what `measurePages.ts` does. Everything else in this
directory exists to do that measurement fast, keep it correct as the user
types, and patch the various ways a giant invisible DOM spacer confuses
native browser text selection/caret/click handling.

## File map

| File | Responsibility |
|---|---|
| `measurePages.ts` | The actual layout walk — decides where breaks go. |
| `usePagination.ts` | React hook: debouncing, incremental re-measurement, caching, page background offsets. |
| `PaginationExtension.ts` | TipTap/ProseMirror extension: turns computed breaks into real decorations (the spacer widgets). |
| `PageBreakNode.ts` | The *manual*, user-inserted hard page break (`Ctrl+Enter`-style), a real document node — distinct from the automatic soft breaks `measurePages.ts` computes. |
| `breakBoundaryCorrection.ts` | Pure position-math helpers that correct click/keyboard hit-testing near a break (see "The dead zone" below). |
| `useBreakBoundaryCorrection.ts` | React hook wiring those helpers into real mouse/keyboard event handlers. |
| `constants.ts` | Page sizes (Letter/Legal/A4), margins, page gap, debounce interval. |

## Data model: `PageBreak`

Defined in `measurePages.ts`. A break is one of two kinds:

- **`'node'` break** — falls exactly on a top-level block boundary (between
  two paragraphs, list items, etc). Carries `nextRange` (the following
  node's `[from, to]`) and `prevRange` (the previous sibling's range, or
  `null`). The spacer is inserted as a widget decoration at `pos ===
  nextRange[0]`, and the following node gets a `pagination-collapse-top`
  class (its own margin-top is zeroed so the spacer's height is the only
  thing separating the pages — otherwise you'd get spacer height *plus*
  the node's own margin, an inconsistent gap).

- **`'line'` break** — falls *inside* a single textblock (a long paragraph
  that itself has to be split across two pages, mid-wrap). Carries
  `nodeEnd`, the containing textblock's end position at measurement time.
  This is deliberately tracked separately from `pos` — see the type's own
  comment in the source for why an edit anywhere in that textblock (not
  just at `pos`) can invalidate the break.

Both kinds carry `leftoverSpace`: the (possibly negative) number of pixels
between the current page's filled content and the theoretical page
boundary. `PaginationExtension.ts`'s spacer height is computed directly
from this field (clamped to ≥0 there, not before — see the comment on the
type for why the clamp point matters).

## The measurement walk (`measurePages.ts`)

`measurePageBreaks(view, usablePageHeight, resume?, forceFullWalk?)` walks
the document's top-level children in order, using real
`getBoundingClientRect()` calls (this only works against a live, rendered
DOM — there is no headless/virtual layout math here at all):

1. For each top-level node, get its rect. If it fits under the running
   page-start top + `usablePageHeight`, keep going.
2. If it doesn't fit, and it's a **textblock**, try `trySplitLines`: measure
   every wrapped line's rect individually (via `Range.getClientRects()`,
   merged into logical lines with `mergeRectsByLine`) and emit `'line'`
   breaks wherever a line would cross the boundary. This is what lets a
   single long paragraph itself span a page break.
3. If it doesn't fit and it's a **breakable container**
   (`bulletList`/`orderedList`/`listItem`/`blockquote`), recurse into its
   children instead of treating it as an atomic unit — so a page break can
   land between list items, not just around the whole list.
4. Otherwise (an atomic block that doesn't fit and isn't breakable), emit a
   whole-node `'node'` break before it.
5. An explicit `pageBreakNode` (the user-inserted hard break) sets a
   `forcePageBreakBefore` flag consumed by the very next node, forcing a
   break there regardless of remaining space.

### Incremental re-measurement (the expensive part, avoided)

Walking the *entire* document and calling `getBoundingClientRect()` on
every node on every keystroke is the naive approach and is O(document
size) per keystroke — too slow for any real document. Two techniques cut
this down:

**1. Resume from a known-safe prefix (`findResumePoint`).** ProseMirror's
block model guarantees content *before* an edit position can never have its
height/position changed by that edit (normal block flow doesn't flow
backwards). So on each cycle, `findResumePoint` finds the last cached break
at or before the edit position and treats everything up to there as still
correct — the walk only restarts from that point forward. This is a
structural guarantee, not a heuristic.

**2. Reconvergence early-exit.** Once the walk re-measures a
still-uncertain ("trailing") region, it checks after every top-level
child whether the freshly computed breaks so far match what was cached
from last cycle at the same index (`breakRenderMatches`). If they match, it
splices in the *rest* of the old cached array and stops walking early,
instead of re-measuring the entire remainder of a possibly very long
document. This is **not** structurally provable — it's a content-fingerprint
argument (same kind + pos + leftoverSpace ⇒ overwhelmingly likely the DOM
downstream is identical). It has known false-negative edge cases (see the
long comment above `breakRenderMatches` in the source for the specific
failure modes that were found and abandoned as unfixable in general).

**3. Periodic forced full walk (the actual correctness backstop).**
Because (2) is a heuristic and chasing every possible staleness cause
proved to be an open-ended effort, `usePagination.ts` unconditionally
forces a full, non-early-exiting walk every `PERIODIC_RESYNC_CYCLES` (30)
edit cycles, timed to land during an idle pause rather than mid-typing
(`fromIdleFlush`) when possible, with a 3x-overdue fallback that forces it
inline if the user never pauses. This self-heals *any* staleness from
*any* cause on a bounded schedule — it is the thing that actually
guarantees correctness, not the reconvergence optimization.

A `DEBUG_VERIFY_RECONVERGENCE` flag (`setReconvergenceDebug`) exists to run
both the optimized and brute-force walk on every cycle and log any
mismatch — useful when investigating a suspected staleness bug, not meant
to ship enabled.

## The React hook (`usePagination.ts`)

This is the stateful glue. Per `editor` instance, on every ProseMirror
`update` transaction:

1. Debounces re-measurement (`PAGINATION_DEBOUNCE_MS` = 60ms via
   `scheduleRemeasure`), but *always* accumulates the transaction's step
   map into a running `Mapping` (`pendingMappingRef`) synchronously,
   regardless of whether a remeasure is about to run — cached break
   positions must never fall behind the document's real coordinate space.
2. On an actual remeasure cycle: remaps all cached breaks through that
   accumulated mapping (`remapBreak`), dropping any break whose anchor was
   *deleted* by the edit (not just shifted — e.g. undoing a manual page
   break). Position-only shifting uses `Mapping.map`; deletion detection
   requires `mapping.mapResult(pos).deleted`, which plain `.map()` cannot
   tell you.
3. Temporarily renders only the "kept" (safe) breaks
   (`setPageBreaks(view, keptBreaks)`) *before* calling
   `measurePageBreaks` — because the measurement needs to see the
   document's unpaginated flow to measure accurately, and the not-yet-kept
   spacers would otherwise pollute that measurement with stale data. This
   collapse-then-restore has to happen **synchronously with no `await` in
   between** the two `setPageBreaks` calls — an `await` here gives the
   browser a real rendering opportunity to paint the transiently-collapsed
   state, producing a visible "content jumps then snaps back" flash. This
   was empirically confirmed on WebKitGTK, not merely theorized.
4. Runs `measurePageBreaks`, decides whether this is a periodic
   forced-full-walk cycle (see above).
5. **Two independent 2-cycle confirmation gates** before anything freshly
   measured becomes visible, both to suppress flicker from single-cycle
   noise while still eventually confirming genuine changes:
   - **Trailing-break gate**: each not-yet-kept break is compared
     per-index (not as a whole-array compare — a whole-array compare lets
     one flickering entry anywhere in a huge trailing region block
     confirmation for every other entry) against last cycle's value by
     `(kind, leftoverSpace)` only (deliberately excluding `pos`, which can
     legitimately jump by an amount unrelated to the edit's length whenever
     a re-wrap happens). A changed value is only rendered once the *same*
     new value repeats on the next cycle.
   - **Page-offset gate** (`pageOffsets`, the array driving the page
     background rectangles): same idea, gates on the offsets array as a
     whole rather than per-index, since a genuine length change always
     commits immediately.
   - A held-back ("pending") value that never gets a confirming cycle
     because the user stops typing would otherwise persist stale forever —
     so whenever anything is pending, a `flushTimerRef` self-schedules one
     more idle remeasure to give it a chance to confirm.
6. **Scroll correction**: because typing near the bottom of a page can
   discover/move breaks, the hook measures the caret's screen position
   before and after the cycle and nudges `scrollParent.scrollTop` by the
   delta so the caret doesn't visually jump. This is explicitly *skipped*
   in two cases where the naive delta would be wrong and produce a worse
   jump than doing nothing: `crossedANewBreak` (the cursor is already past
   a break that didn't exist last cycle — the delta would just be a whole
   spacer's height, never actually seen rendered) and `rewrappedThisCycle`
   (a transient re-wrap this cycle already reverted, so before/after are
   two already-obsolete layouts).

## The decoration layer (`PaginationExtension.ts`)

A plain ProseMirror plugin holding a `DecorationSet` in its state, replaced
wholesale whenever `setPageBreaks(view, breaks)` dispatches a transaction
with `{ breaks }` metadata (otherwise it just maps forward with the
document, same as any decoration set).

For each `PageBreak`, it builds:
- A `Decoration.widget` at `brk.pos` — a real `<div class="page-break-spacer">`
  DOM element (must be a real element, not a `margin`/`padding` value on
  existing content, specifically so it can be excluded from native text
  selection: `contentEditable=false`, `user-select: none`). Its height is
  `leftoverSpace + marginBottom + pageGap + marginTop`, clamped to ≥0.
  It carries `data-break-pos="<pos>"` so other code (mainly
  `usePagination.ts` and `breakBoundaryCorrection.ts`) can look it up by
  break position without going through ambiguous `coordsAtPos` resolution.
- For `'node'` breaks: a `pagination-collapse-top` class on the following
  node (zeroes its own margin-top so the spacer alone determines the gap).
- For `'line'` breaks: a `pagination-has-break` class on the containing
  textblock, used by `index.css` to handle a `text-align: justify`
  interaction — the browser treats the line right before the widget as the
  paragraph's "last line" (exempt from justification) even though it isn't
  really the paragraph's end; the CSS rule and its documented trade-off
  live in `index.css`.

## The dead zone: why clicks/keyboard near a break need correction

This is the least obvious part of the system and has consumed the most
bug-fixing effort. Two independent-but-related facts about how
ProseMirror/the browser resolve a document position sitting exactly at a
large vertical gap:

1. **`coordsAtPos(breakPos)` renders on the page *after* the break, never
   before** — a hard one-position discontinuity, not a fuzzy pixel
   boundary. This is confirmed to be a general property of any
   block-boundary-with-a-large-gap, not something caused by the widget
   specifically (an ordinary paragraph with a huge inline `margin-top` and
   zero decorations shows the identical discontinuity). So this can't be
   fixed by changing how the gap is rendered — it has to be corrected at
   every interaction site instead.

2. **Clicking in the "dead zone"** — the last few pixels of the previous
   page's last line, the spacer itself, or the empty trailing horizontal
   space next to a short last line — resolves via native hit-testing to
   `breakPos`, then renders on the *wrong* (next) page.

`breakBoundaryCorrection.ts`'s `correctedPos(dom, rawPos, clientY, clientX)`
is the shared fix, used by every pixel→position lookup near a break:
- If `rawPos` matches a known break's spacer and the click's `clientY` is
  *above* that spacer's top, substitute `rawPos - 1` (still real text on
  the correct page).
- A second, distinct discontinuity: `breakPos` itself (the very first
  position of the new page) is *unreachable* by click at all — the widget's
  presence in the DOM consumes the hit-test region that would otherwise
  resolve to it, so clicks there resolve to `breakPos + 1` instead. Handled
  narrowly: only substitute back to `breakPos` when the click's coordinates
  land inside the actual first-character rect right after the spacer.

Every known call site that does pixel→position resolution near a break
needs this same substitution: `useBreakBoundaryCorrection.ts`'s
mousedown/mouseup/End handling, `PaginatedEditor.tsx`'s
margin/gutter-click handler (`handleContainerClick`), and `Editor.tsx`'s
link-click handler. Plain position→pixel lookups (`coordsAtPos` used
*forward*, not to resolve a click) were separately audited and don't need
it.

### Owning click/selection behavior once you've corrected a click

`useBreakBoundaryCorrection.ts`'s `mousedown` handler calls
`preventDefault()` once it detects and corrects a dead-zone click — this is
necessary so the browser's own (buggy, uncorrected) native click placement
never gets a chance to overwrite the fix. But `preventDefault()` also sets
`event.defaultPrevented`, which ProseMirror's *own* internal mousedown
handler checks and bails out on — meaning a corrected click disables **all**
of ProseMirror's built-in mouse handling for that gesture: native
drag-to-extend tracking, triple-click paragraph select, and (since it has
no ProseMirror-internal fallback at all) double-click word-select. As a
result this file has to independently reimplement:
- Click-count classification (`classifyClick`, mirroring ProseMirror's own
  timing/distance heuristic, since PM's own counter never advances for a
  corrected click).
- Word/paragraph range selection (`wordRangeAround`/`blockRangeAround` in
  `breakBoundaryCorrection.ts`).
- Live drag-extend visual feedback (`handleMouseMove`, only armed
  (`activeDragRef`) when a plain-click or shift-click gesture *started* in
  the dead zone).

### Keyboard: End key and arrow-key atomic hops

- **`End`**: only intervened on when a break's spacer is within ~60px of
  the caret's current line (elsewhere, native `End` is already correct and
  is left untouched). Re-derives the rightmost position via `posAtCoords`
  at the container's right edge and runs it through `correctedPos`.
- **Arrow keys**: native `ArrowLeft`/`ArrowRight` treat the non-editable
  spacer widget as a single atomic hop, jumping straight from `breakPos-1`
  to `breakPos+1` (or back) and *never* landing on `breakPos` itself —
  confirmed on real input, independent of the click-correction mechanism
  entirely. `handleSkippedBreak` (a `selectionUpdate` listener) detects this
  narrowly: only a magnitude-exactly-2 head jump with a known break sitting
  exactly at the midpoint qualifies (so legitimate larger jumps — word
  motion, multi-line Shift+Down — are never misclassified), and retargets
  the selection to land on the break position itself.
- A previous mechanism that corrected `Home`/arrow-keys/degenerate-caret-rect
  cases was tried and **removed entirely** — see the top-of-file comment in
  `useBreakBoundaryCorrection.ts` for why it was actively wrong (silently
  skipping the first real character of a new page) rather than just
  imperfect. Don't reintroduce a similar "if the caret rect looks
  degenerate, nudge it" heuristic without reading that history first.

## Manual page breaks (`PageBreakNode.ts`)

A real, atomic, non-editable block node (`pageBreak`) a user can insert
explicitly (distinct from the automatic soft breaks the measurement walk
computes). `insertPageBreak()`:
- Splits the current textblock at the cursor if it's mid-block, or inserts
  directly before/after it if the cursor is exactly at the block's start/end.
- Inserts the node, then ensures there's a paragraph immediately after it
  to type into (inserting one if the following node isn't already a
  textblock).
- During measurement, encountering this node sets `forcePageBreakBefore`,
  consumed by the very next walked node to force a break regardless of
  remaining space on the current page — see step 5 of the measurement walk
  above.

## Constants (`constants.ts`)

- `PAGE_SIZES`: Letter (816×1056), Legal (816×1344), A4 (794×1123) — CSS
  pixels at 96 DPI, not physical inches directly.
- `PAGE_GAP` = 32px visual gap between page bottom and next page top.
- `PAGINATION_DEBOUNCE_MS` = 60ms — both the edit-debounce interval and the
  idle-flush retry interval for pending confirmations.
- `DEFAULT_MARGINS` = 96px on all sides (1 inch at 96 DPI).

## Known ongoing risk areas (read before touching this code)

- The **reconvergence early-exit** in `measurePages.ts` is a heuristic, not
  a proof. Its correctness depends entirely on the periodic full-walk
  backstop in `usePagination.ts`. Do not remove or weaken the periodic
  resync without something else providing an equivalent unconditional
  correctness guarantee.
- Any new code that converts a pixel coordinate into a document position
  near a page boundary almost certainly needs to go through
  `correctedPos`. If you add a new click/keyboard handler operating on the
  editor DOM, audit whether it can ever fire near a break.
- The confirmation gates in `usePagination.ts` (`pendingTrailingRef`,
  `pendingOffsetsRef`) exist specifically to absorb single-cycle
  measurement noise (reclassification flicker, sub-pixel `leftoverSpace`
  jitter for `'line'`-kind breaks). If you see a page flicker mid-typing
  that self-resolves after ~2 keystrokes' worth of debounce, this is almost
  certainly the cause — look here before assuming it's a fresh bug.
- `PageBreak` position bookkeeping is maintained entirely by hand via a
  ProseMirror `Mapping` (`remapBreak`) — it does *not* piggyback on
  ProseMirror's own automatic decoration-set position mapping. Any new
  field added to `PageBreak` that encodes a document position must be
  added to `remapBreak` too, or it will silently go stale after an edit.
