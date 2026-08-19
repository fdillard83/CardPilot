import assert from "node:assert/strict";
import test from "node:test";

import { detectCardBoundary } from "./card-boundary.ts";

function insideQuad(x, y, corners) {
  let direction = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    const cross = (end.x - start.x) * (y - start.y) -
      (end.y - start.y) * (x - start.x);
    if (Math.abs(cross) < 0.001) continue;
    const nextDirection = Math.sign(cross);
    if (direction && nextDirection !== direction) return false;
    direction = nextDirection;
  }
  return true;
}

function texturedCardPhoto() {
  const width = 210;
  const height = 280;
  const corners = [
    { x: 36, y: 31 },
    { x: 174, y: 35 },
    { x: 181, y: 237 },
    { x: 31, y: 241 },
  ];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dataIndex = (y * width + x) * 4;
      const grain = ((x * 17 + y * 29 + (x * y) % 31) % 49) - 24;
      if (insideQuad(x, y, corners)) {
        const stripe = (x + Math.floor(y / 3)) % 37 < 7;
        data[dataIndex] = stripe ? 55 : 205 + (x % 24);
        data[dataIndex + 1] = stripe ? 95 : 210 + (y % 20);
        data[dataIndex + 2] = stripe ? 145 : 218;
      } else {
        data[dataIndex] = 145 + grain;
        data[dataIndex + 1] = 82 + Math.round(grain * 0.55);
        data[dataIndex + 2] = 47 + Math.round(grain * 0.35);
      }
      data[dataIndex + 3] = 255;
    }
  }
  return { data, width, height, corners };
}

test("finds and straightens a card on a textured 3:4 camera background", () => {
  const fixture = texturedCardPhoto();
  const detection = detectCardBoundary(fixture.data, fixture.width, fixture.height);
  assert.ok(detection);
  for (let index = 0; index < fixture.corners.length; index += 1) {
    assert.ok(
      Math.hypot(
        detection.corners[index].x - fixture.corners[index].x,
        detection.corners[index].y - fixture.corners[index].y,
      ) < 10,
    );
  }
  assert.ok(detection.metrics.confidence > 0.75);
});

test("does not invent a card boundary on a textured background alone", () => {
  const fixture = texturedCardPhoto();
  for (let y = 0; y < fixture.height; y += 1) {
    for (let x = 0; x < fixture.width; x += 1) {
      const dataIndex = (y * fixture.width + x) * 4;
      const grain = ((x * 17 + y * 29 + (x * y) % 31) % 49) - 24;
      fixture.data[dataIndex] = 145 + grain;
      fixture.data[dataIndex + 1] = 82 + Math.round(grain * 0.55);
      fixture.data[dataIndex + 2] = 47 + Math.round(grain * 0.35);
    }
  }
  assert.equal(
    detectCardBoundary(fixture.data, fixture.width, fixture.height),
    null,
  );
});
