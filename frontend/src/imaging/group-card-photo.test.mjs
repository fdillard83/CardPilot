import assert from "node:assert/strict";
import test from "node:test";
import { componentRectangles } from "./group-card-photo.ts";

test("group-card components are separated and ordered by row", () => {
  const width = 20;
  const height = 14;
  const mask = new Uint8Array(width * height);
  for (const [left, top] of [[2, 2], [12, 2], [2, 8], [12, 8]]) {
    for (let y = top; y < top + 4; y += 1) {
      for (let x = left; x < left + 5; x += 1) mask[y * width + x] = 1;
    }
  }
  assert.deepEqual(componentRectangles(mask, width, height), [
    { x: 2, y: 2, width: 5, height: 4 },
    { x: 12, y: 2, width: 5, height: 4 },
    { x: 2, y: 8, width: 5, height: 4 },
    { x: 12, y: 8, width: 5, height: 4 },
  ]);
});
