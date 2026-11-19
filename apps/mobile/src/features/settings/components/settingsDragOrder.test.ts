import { describe, expect, it } from "vite-plus/test";

import { dragDropIndex, dragShift } from "./settingsDragOrder";

const order = ["a", "b", "c"];
const heights = new Map([
  ["a", 40],
  ["b", 100],
  ["c", 40],
]);

describe("dragDropIndex", () => {
  it("passes a neighbour once the drag covers half of it", () => {
    expect(dragDropIndex(order, heights, 0, 49)).toBe(0);
    expect(dragDropIndex(order, heights, 0, 50)).toBe(1);
    expect(dragDropIndex(order, heights, 0, 120)).toBe(2);
    expect(dragDropIndex(order, heights, 2, -49)).toBe(2);
    expect(dragDropIndex(order, heights, 2, -50)).toBe(1);
  });

  it("stops at the ends and at rows it has not measured", () => {
    expect(dragDropIndex(order, heights, 0, 10_000)).toBe(2);
    expect(dragDropIndex(order, heights, 0, -10_000)).toBe(0);
    expect(dragDropIndex(order, new Map(), 0, 500)).toBe(0);
  });
});

describe("dragShift", () => {
  it("slides only the rows between the start and the drop", () => {
    expect([0, 1, 2, 3].map((index) => dragShift(index, 0, 2, 40))).toEqual([0, -40, -40, 0]);
    expect([0, 1, 2, 3].map((index) => dragShift(index, 3, 1, 40))).toEqual([0, 40, 40, 0]);
    expect(dragShift(1, -1, -1, 40)).toBe(0);
  });
});
