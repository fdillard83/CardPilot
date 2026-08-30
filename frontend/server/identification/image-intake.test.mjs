import assert from "node:assert/strict";
import test from "node:test";
import { ImageIntakeError, parseImageIntake } from "./image-intake.mjs";

const image = "data:image/jpeg;base64,Y2FyZA==";

test("image intake preserves enlarged back-card details for small year text", () => {
  const intake = parseImageIntake({
    frontImage: image,
    backImage: image,
    backDetailImages: [{ label: "lower detail band", image }],
  });
  assert.equal(intake.backDetailImages.length, 1);
  assert.equal(intake.backDetailImages[0].label, "lower detail band");
});

test("back detail crops cannot be detached from a back-card image", () => {
  assert.throws(
    () => parseImageIntake({
      frontImage: image,
      backDetailImages: [{ label: "lower detail band", image }],
    }),
    ImageIntakeError,
  );
});
