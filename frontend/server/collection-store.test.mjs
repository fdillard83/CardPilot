import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CollectionStore } from "./collection-store.mjs";

const fields = {
  player: "Nolan Ryan",
  sport: "Baseball",
  team: "California Angels",
  year: "2026",
  manufacturer: "Topps",
  product: "Topps Series 2",
  brand: "Topps",
  setOrInsert: "Crooked Numbers",
  cardNumber: "CN-14",
  rookieStatus: false,
  parallel: "Green Foil",
  serialNumber: "63/85",
  autograph: false,
  memorabilia: false,
  imageVariation: false,
};

test("collection records persist images and support update and removal", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cardpilot-collection-"));
  const store = new CollectionStore({
    recordsFile: path.join(directory, "collection.json"),
    imagesDirectory: path.join(directory, "images"),
    now: (() => {
      let second = 0;
      return () => new Date(`2026-08-12T12:00:0${second++}.000Z`);
    })(),
  });

  try {
    const created = await store.create({
      identificationId: "identification-1",
      fields,
      overallConfidence: 0.91,
      decision: "confirm",
      frontImage: "data:image/jpeg;base64,Zm9v",
      backImage: "data:image/png;base64,YmFy",
      ebayReference: {
        itemId: "v1|123|0",
        title: "Nolan Ryan Green Foil /85",
        itemWebUrl: "https://www.ebay.com/itm/123",
      },
    });

    assert.equal(created.title, "2026 Nolan Ryan Crooked Numbers");
    assert.deepEqual(created.grading, {
      isGraded: false,
      company: null,
      grade: null,
      certificationNumber: null,
    });
    assert.match(created.images.frontUrl, /\/images\/front$/);
    assert.match(created.images.backUrl, /\/images\/back$/);
    assert.equal((await store.list()).length, 1);

    assert.equal(
      (await store.get(created.collectionId)).collectionId,
      created.collectionId,
    );

    const frontImage = await store.image(created.collectionId, "front");
    assert.equal(frontImage.mimeType, "image/jpeg");
    assert.equal((await readFile(frontImage.filePath)).toString(), "foo");

    const updated = await store.update(created.collectionId, {
      fields: { ...fields, player: "Nolan Ryan (confirmed)" },
      grading: {
        isGraded: true,
        company: "PSA",
        grade: "10",
        certificationNumber: "12345678",
      },
    });
    assert.equal(updated.fields.player, "Nolan Ryan (confirmed)");
    assert.deepEqual(updated.grading, {
      isGraded: true,
      company: "PSA",
      grade: "10",
      certificationNumber: "12345678",
    });
    assert.notEqual(updated.updatedAt, created.updatedAt);

    const identityOnlyUpdate = await store.update(created.collectionId, {
      fields: { ...updated.fields, team: "California Angels" },
    });
    assert.deepEqual(identityOnlyUpdate.grading, updated.grading);

    assert.equal(await store.remove(created.collectionId), true);
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.image(created.collectionId, "front"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
