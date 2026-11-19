import { useState } from "react";

/** Where a row dragged `translation` points from `from` lands: past a neighbour once it covers half of it. */
export function dragDropIndex(
  order: readonly string[],
  heights: ReadonlyMap<string, number>,
  from: number,
  translation: number,
): number {
  const step = translation > 0 ? 1 : -1;
  let to = from;
  let remaining = Math.abs(translation);
  while (to + step >= 0 && to + step < order.length) {
    const next = heights.get(order[to + step]!) ?? 0;
    if (next === 0 || remaining < next / 2) break;
    remaining -= next;
    to += step;
  }
  return to;
}

/** How far a resting row slides to open the gap for a row dragged from `from` to `to`. */
export function dragShift(index: number, from: number, to: number, liftedHeight: number): number {
  if (from === -1 || index === from) return 0;
  if (from < to && index > from && index <= to) return -liftedHeight;
  if (from > to && index < from && index >= to) return liftedHeight;
  return 0;
}

export type SettingsRowDrag = ReturnType<ReturnType<typeof useSettingsDragOrder>["rowDrag"]>;

/** Drag state for a settings list reordered with `SettingsDragHandle`. */
export function useSettingsDragOrder(
  order: readonly string[],
  onMove: (from: number, to: number) => void,
) {
  const [drag, setDrag] = useState<{ readonly id: string; readonly translation: number } | null>(
    null,
  );
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  // Each drop remounts the rows so the new order and the cleared offsets land in one frame.
  const [drops, setDrops] = useState(0);
  const from = drag === null ? -1 : order.indexOf(drag.id);
  const to = drag === null ? -1 : dragDropIndex(order, heights, from, drag.translation);
  const liftedHeight = drag === null ? 0 : (heights.get(drag.id) ?? 0);
  const move = (index: number, target: number) => {
    if (target < 0 || target >= order.length || index === target) return;
    onMove(index, target);
  };

  return {
    rowKey: (id: string) => `${id}:${drops}`,
    rowDrag: (id: string, index: number) => ({
      offset: index === from ? (drag?.translation ?? 0) : dragShift(index, from, to, liftedHeight),
      lifted: index === from,
      onHeight: (height: number) =>
        setHeights((current) =>
          current.get(id) === height ? current : new Map(current).set(id, height),
        ),
      onDragStart: () => setDrag({ id, translation: 0 }),
      onDragMove: (translation: number) => setDrag({ id, translation }),
      onDragEnd: (translation: number, cancelled: boolean) => {
        setDrag(null);
        setDrops((count) => count + 1);
        if (!cancelled) move(index, dragDropIndex(order, heights, index, translation));
      },
      onStep: (direction: "up" | "down") => move(index, direction === "up" ? index - 1 : index + 1),
    }),
  };
}
