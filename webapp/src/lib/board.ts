/** Persistent per-slot card tracking across frames ("Tisch-Modus").
 *
 * The Scan tab classifies each frame from scratch, which is fast to react
 * but flickers: a single blurry or awkwardly-lit frame produces a wrong
 * guess that flashes on screen. Board mode instead assumes what's usually
 * true for Set -- the cards lie still on a table -- and tracks each one as
 * a "slot" across many frames, voting on its attributes over time instead
 * of trusting any single read. A field the votes disagree on (fill/shape
 * are the classic case) is exposed as "uncertain" for the caller to offer
 * a manual pick, rather than silently keeping the CV's latest guess.
 */
import type { CardAttributes } from "./classify";
import type { CardCandidate } from "./detection";
import * as C from "./config";
import type { Point } from "./geometry";

export type Field = "count" | "color" | "shape" | "fill";

export type ManualOverride = Partial<Record<Field, string | number>>;

export type SlotStatus = "active" | "pendingRemoval";

export interface BoardSlot {
  id: number;
  quad: Point[];
  center: Point;
  attrsHistory: CardAttributes[];
  manualOverride: ManualOverride;
  missedFrames: number;
  status: SlotStatus;
}

export interface Board {
  slots: BoardSlot[];
  nextId: number;
}

export function createBoard(): Board {
  return { slots: [], nextId: 1 };
}

export interface ResolvedSlot {
  id: number;
  quad: Point[];
  status: SlotStatus;
  count: number | null;
  color: string | null;
  shape: string | null;
  fill: string | null;
  uncertain: Field[];
  label: string;
}

function quadCenter(quad: Point[]): Point {
  const sx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
  const sy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
  return [sx, sy];
}

function quadDiagonal(quad: Point[]): number {
  return Math.hypot(quad[2][0] - quad[0][0], quad[2][1] - quad[0][1]);
}

/** Greedy nearest-center matching between existing slots and this frame's
 * detections. Good enough at Set-board scale (a dozen-ish cards) -- no need
 * for an optimal assignment solver. */
function matchCandidatesToSlots(slots: BoardSlot[], centers: Point[], maxDist: number): Map<number, number> {
  const pairs: { slotIdx: number; candIdx: number; dist: number }[] = [];
  slots.forEach((slot, si) => {
    centers.forEach((center, ci) => {
      const dist = Math.hypot(center[0] - slot.center[0], center[1] - slot.center[1]);
      if (dist <= maxDist) pairs.push({ slotIdx: si, candIdx: ci, dist });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);

  const usedSlots = new Set<number>();
  const usedCands = new Set<number>();
  const slotToCand = new Map<number, number>();
  for (const { slotIdx, candIdx } of pairs) {
    if (usedSlots.has(slotIdx) || usedCands.has(candIdx)) continue;
    usedSlots.add(slotIdx);
    usedCands.add(candIdx);
    slotToCand.set(slotIdx, candIdx);
  }
  return slotToCand;
}

/** Advances the board by one frame's detections. Pure: returns a new Board,
 * never mutates the one passed in. Unmatched existing slots accumulate
 * missed frames and eventually flip to "pendingRemoval" (never deleted
 * outright -- that needs the caller's explicit confirmRemoval, since a
 * frame that briefly missed a card isn't proof it's actually gone).
 * Unmatched detections become brand-new slots, which is also how the board
 * grows past its starting size. */
export function updateBoard(board: Board, candidates: CardCandidate[], attrsList: CardAttributes[]): Board {
  const centers = candidates.map((c) => quadCenter(c.quad));
  const avgDiagonal = candidates.length
    ? candidates.reduce((s, c) => s + quadDiagonal(c.quad), 0) / candidates.length
    : 0;
  const maxDist = avgDiagonal * C.BOARD_MATCH_DISTANCE_FACTOR;

  const slotToCand = matchCandidatesToSlots(board.slots, centers, maxDist);
  const usedCands = new Set(slotToCand.values());

  const nextSlots: BoardSlot[] = board.slots.map((slot, si) => {
    const candIdx = slotToCand.get(si);
    if (candIdx === undefined) {
      const missedFrames = slot.missedFrames + 1;
      const status: SlotStatus = missedFrames >= C.BOARD_REMOVE_GRACE_FRAMES ? "pendingRemoval" : slot.status;
      return { ...slot, missedFrames, status };
    }
    const attrsHistory = [...slot.attrsHistory, attrsList[candIdx]].slice(-C.BOARD_HISTORY_SIZE);
    return {
      ...slot,
      quad: candidates[candIdx].quad,
      center: centers[candIdx],
      attrsHistory,
      missedFrames: 0,
      status: "active",
    };
  });

  let nextId = board.nextId;
  centers.forEach((center, ci) => {
    if (usedCands.has(ci)) return;
    nextSlots.push({
      id: nextId++,
      quad: candidates[ci].quad,
      center,
      attrsHistory: [attrsList[ci]],
      manualOverride: {},
      missedFrames: 0,
      status: "active",
    });
  });

  return { slots: nextSlots, nextId };
}

function modeAndAgreement<T>(values: T[]): [T, number] {
  const counts = new Map<string, { value: T; n: number }>();
  for (const v of values) {
    const key = String(v);
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, { value: v, n: 1 });
  }
  let best: { value: T; n: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  return [best!.value, best!.n / values.length];
}

function resolveField<T>(reads: T[], override: T | undefined, agreementThreshold: number): [T | null, boolean] {
  if (override !== undefined) return [override, false];
  if (reads.length === 0) return [null, true];
  const [mode, agreement] = modeAndAgreement(reads);
  return agreement >= agreementThreshold ? [mode, false] : [null, true];
}

export function resolveSlot(slot: BoardSlot): ResolvedSlot {
  const reads = slot.attrsHistory;
  const uncertain: Field[] = [];

  const [count, countUncertain] = resolveField(
    reads.map((r) => r.count).filter((c) => c > 0),
    slot.manualOverride.count as number | undefined,
    C.BOARD_MIN_VOTE_AGREEMENT,
  );
  if (countUncertain) uncertain.push("count");

  const [color, colorUncertain] = resolveField(
    reads.map((r) => r.color).filter((c): c is string => c !== null),
    slot.manualOverride.color as string | undefined,
    C.BOARD_MIN_VOTE_AGREEMENT,
  );
  if (colorUncertain) uncertain.push("color");

  const [shape, shapeUncertain] = resolveField(
    reads.map((r) => r.shape).filter((s): s is string => s !== null),
    slot.manualOverride.shape as string | undefined,
    C.BOARD_MIN_VOTE_AGREEMENT,
  );
  if (shapeUncertain) uncertain.push("shape");

  const [fill, fillUncertain] = resolveField(
    reads.map((r) => r.fill).filter((f): f is string => f !== null),
    slot.manualOverride.fill as string | undefined,
    C.BOARD_MIN_VOTE_AGREEMENT,
  );
  if (fillUncertain) uncertain.push("fill");

  const label = `${count ?? "?"}${color ?? "?"}${shape ?? "?"}${fill ?? "?"}`;

  return { id: slot.id, quad: slot.quad, status: slot.status, count, color, shape, fill, uncertain, label };
}

export function setManualOverride(board: Board, slotId: number, field: Field, value: string | number): Board {
  return {
    ...board,
    slots: board.slots.map((s) => (s.id === slotId ? { ...s, manualOverride: { ...s.manualOverride, [field]: value } } : s)),
  };
}

export function clearManualOverride(board: Board, slotId: number, field: Field): Board {
  return {
    ...board,
    slots: board.slots.map((s) => {
      if (s.id !== slotId) return s;
      const next = { ...s.manualOverride };
      delete next[field];
      return { ...s, manualOverride: next };
    }),
  };
}

/** Removes a slot for good. Only ever called from the user's explicit "X"
 * confirmation -- the tracker itself only ever proposes via pendingRemoval. */
export function confirmRemoval(board: Board, slotId: number): Board {
  return { ...board, slots: board.slots.filter((s) => s.id !== slotId) };
}

/** The card that looked removed is still there after all -- put the slot
 * back into normal tracking instead of waiting for a fresh detection to
 * recreate it (which would also lose its vote history). */
export function dismissRemoval(board: Board, slotId: number): Board {
  return {
    ...board,
    slots: board.slots.map((s) => (s.id === slotId ? { ...s, status: "active", missedFrames: 0 } : s)),
  };
}

/** Resolved labels + matching slot ids for every non-removed slot, ready
 * for findSets(). Cards pending removal are left out: by the time a slot
 * gets there it's missed several frames in a row, which is stronger
 * evidence of "gone" than of "briefly occluded". */
export function boardToSetInput(board: Board): { slotIds: number[]; labels: string[] } {
  const active = board.slots.filter((s) => s.status === "active").map(resolveSlot);
  return { slotIds: active.map((r) => r.id), labels: active.map((r) => r.label) };
}
