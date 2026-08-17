import { describe, expect, it } from "vitest";
import {
  boardToSetInput,
  clearManualOverride,
  confirmRemoval,
  createBoard,
  dismissRemoval,
  resolveSlot,
  setManualOverride,
  updateBoard,
  type Board,
} from "./board";
import type { CardAttributes } from "./classify";
import type { CardCandidate } from "./detection";
import type { ImageBuffer, Point } from "./geometry";
import * as C from "./config";

function fakeImage(): ImageBuffer {
  return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
}

function candidateAt(cx: number, cy: number, size = 40): CardCandidate {
  const quad: Point[] = [
    [cx - size, cy - size / 2],
    [cx + size, cy - size / 2],
    [cx + size, cy + size / 2],
    [cx - size, cy + size / 2],
  ];
  return { quad, area: size * size * 4, warped: fakeImage() };
}

function attrs(overrides: Partial<CardAttributes> = {}): CardAttributes {
  return {
    count: 1,
    color: "R",
    shape: "D",
    fill: "F",
    colorMargin: 1,
    shapeMargin: 1,
    fillMargin: 1,
    symbols: [],
    ...overrides,
  };
}

describe("updateBoard", () => {
  it("creates a new slot for each unmatched detection", () => {
    const board = updateBoard(createBoard(), [candidateAt(100, 100), candidateAt(300, 100)], [attrs(), attrs({ color: "G" })]);
    expect(board.slots).toHaveLength(2);
    expect(board.slots.map((s) => s.status)).toEqual(["active", "active"]);
  });

  it("matches a card that barely moved to its existing slot instead of creating a new one", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    const id = board.slots[0].id;
    board = updateBoard(board, [candidateAt(105, 98)], [attrs()]);
    expect(board.slots).toHaveLength(1);
    expect(board.slots[0].id).toBe(id);
    expect(board.slots[0].attrsHistory).toHaveLength(2);
  });

  it("creates a separate new slot for a detection far from any existing slot", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    board = updateBoard(board, [candidateAt(100, 100), candidateAt(500, 500)], [attrs(), attrs()]);
    expect(board.slots).toHaveLength(2);
  });

  it("marks a slot pendingRemoval only after enough consecutive missed frames", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    for (let i = 0; i < C.BOARD_REMOVE_GRACE_FRAMES - 1; i++) {
      board = updateBoard(board, [], []);
      expect(board.slots[0].status).toBe("active");
    }
    board = updateBoard(board, [], []);
    expect(board.slots[0].status).toBe("pendingRemoval");
  });

  it("brings a pendingRemoval slot back to active if it reappears", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    for (let i = 0; i < C.BOARD_REMOVE_GRACE_FRAMES; i++) board = updateBoard(board, [], []);
    expect(board.slots[0].status).toBe("pendingRemoval");
    board = updateBoard(board, [candidateAt(101, 99)], [attrs()]);
    expect(board.slots[0].status).toBe("active");
    expect(board.slots[0].missedFrames).toBe(0);
  });

  it("caps attribute history at BOARD_HISTORY_SIZE", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    for (let i = 0; i < C.BOARD_HISTORY_SIZE + 5; i++) {
      board = updateBoard(board, [candidateAt(100, 100)], [attrs()]);
    }
    expect(board.slots[0].attrsHistory).toHaveLength(C.BOARD_HISTORY_SIZE);
  });

  it("does not mutate the board passed in", () => {
    const board = createBoard();
    const next = updateBoard(board, [candidateAt(100, 100)], [attrs()]);
    expect(board.slots).toHaveLength(0);
    expect(next.slots).toHaveLength(1);
  });
});

describe("resolveSlot", () => {
  it("resolves a field the history agrees on", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs({ fill: "F" })]);
    board = updateBoard(board, [candidateAt(100, 100)], [attrs({ fill: "F" })]);
    const resolved = resolveSlot(board.slots[0]);
    expect(resolved.fill).toBe("F");
    expect(resolved.uncertain).not.toContain("fill");
    expect(resolved.label).toBe("1RDF");
  });

  it("flags a field as uncertain when history disagrees below the vote threshold", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs({ fill: "F" })]);
    board = updateBoard(board, [candidateAt(100, 100)], [attrs({ fill: "S" })]);
    board = updateBoard(board, [candidateAt(100, 100)], [attrs({ fill: "E" })]);
    const resolved = resolveSlot(board.slots[0]);
    expect(resolved.fill).toBeNull();
    expect(resolved.uncertain).toContain("fill");
    expect(resolved.label).toContain("?");
  });

  it("a manual override wins regardless of history", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs({ fill: "F" })]);
    board = updateBoard(board, [candidateAt(100, 100)], [attrs({ fill: "S" })]);
    board = updateBoard(board, [candidateAt(100, 100)], [attrs({ fill: "E" })]);
    const id = board.slots[0].id;
    board = setManualOverride(board, id, "fill", "S");
    const resolved = resolveSlot(board.slots[0]);
    expect(resolved.fill).toBe("S");
    expect(resolved.uncertain).not.toContain("fill");
  });

  it("clearing an override falls back to the vote again", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs({ fill: "F" })]);
    const id = board.slots[0].id;
    board = setManualOverride(board, id, "fill", "S");
    board = clearManualOverride(board, id, "fill");
    const resolved = resolveSlot(board.slots[0]);
    expect(resolved.fill).toBe("F");
  });
});

describe("confirmRemoval / dismissRemoval", () => {
  it("confirmRemoval deletes the slot", () => {
    const board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    const id = board.slots[0].id;
    const next = confirmRemoval(board, id);
    expect(next.slots).toHaveLength(0);
  });

  it("dismissRemoval resets a pendingRemoval slot back to active", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs()]);
    const id = board.slots[0].id;
    for (let i = 0; i < C.BOARD_REMOVE_GRACE_FRAMES; i++) board = updateBoard(board, [], []);
    expect(board.slots[0].status).toBe("pendingRemoval");
    board = dismissRemoval(board, id);
    expect(board.slots[0].status).toBe("active");
  });
});

describe("boardToSetInput", () => {
  it("excludes pendingRemoval slots", () => {
    let board: Board = createBoard();
    board = updateBoard(board, [candidateAt(100, 100), candidateAt(300, 100)], [attrs(), attrs({ color: "G" })]);
    const staySlotId = board.slots[0].id;
    for (let i = 0; i < C.BOARD_REMOVE_GRACE_FRAMES; i++) {
      board = updateBoard(board, [candidateAt(100, 100)], [attrs()]);
    }
    const { slotIds } = boardToSetInput(board);
    expect(slotIds).toEqual([staySlotId]);
  });

  it("produces '?'-labels for uncertain fields, which findSets rejects", () => {
    let board = updateBoard(createBoard(), [candidateAt(100, 100)], [attrs({ fill: "F" })]);
    board = updateBoard(board, [candidateAt(100, 100)], [attrs({ fill: "S" })]);
    const { labels } = boardToSetInput(board);
    expect(labels[0]).toBe("1RD?");
  });
});
