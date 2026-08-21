import assert from "node:assert/strict";
import test from "node:test";
import { expandedTriangleClip } from "./card-photo.ts";

test("mesh triangle clips overlap their original edges to prevent JPEG seams", () => {
  const original = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 90 }];
  const expanded = expandedTriangleClip(original, 1.25);

  assert.ok(expanded[0].x < original[0].x);
  assert.ok(expanded[0].y < original[0].y);
  assert.ok(expanded[1].x > original[1].x);
  assert.ok(expanded[2].x > original[2].x);
  assert.ok(expanded[2].y > original[2].y);
});

test("zero overlap preserves the original triangle", () => {
  const original = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 80 }];
  assert.deepEqual(expandedTriangleClip(original, 0), original);
});
