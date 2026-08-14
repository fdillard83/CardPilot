import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { importLocalCollection, localImportStatus } from "./local-import.mjs";

const localCard = {
  collectionId: "local-1",
  identificationId: "identification-1",
  title: "Nolan Ryan",
  fields: { player: "Nolan Ryan" },
  overallConfidence: 0.9,
  decision: "confirm",
  ebayReference: null,
  pokemonCatalogReference: null,
  grading: {
    isGraded: false,
    company: null,
    grade: null,
    certificationNumber: null,
  },
  valuationProfile: { featureType: "ordinary", source: "derived" },
  confirmedValuation: null,
};

test("local collection import copies images and skips completed cards", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cardpilot-import-"));
  const frontPath = path.join(directory, "front.jpg");
  await writeFile(frontPath, "image");
  const created = [];
  const cloudCards = [];
  const localStore = {
    async list() {
      return [localCard];
    },
    async image(_collectionId, side) {
      return side === "front"
        ? { filePath: frontPath, mimeType: "image/jpeg" }
        : null;
    },
  };
  const cloudRepository = {
    async list() {
      return cloudCards;
    },
    async create(userId, input) {
      created.push({ userId, input });
      const card = {
        collectionId: "cloud-1",
        identificationId: input.identificationId,
      };
      cloudCards.push(card);
      return card;
    },
  };

  try {
    assert.deepEqual(
      await localImportStatus({ userId: "user-1", localStore, cloudRepository }),
      { localCount: 1, alreadyImportedCount: 0, readyCount: 1 },
    );
    assert.deepEqual(
      await importLocalCollection({
        userId: "user-1",
        localStore,
        cloudRepository,
      }),
      { importedCount: 1, skippedCount: 0, totalCount: 1 },
    );
    assert.equal(created[0].userId, "user-1");
    assert.match(created[0].input.frontImage, /^data:image\/jpeg;base64,/);
    assert.deepEqual(
      await importLocalCollection({
        userId: "user-1",
        localStore,
        cloudRepository,
      }),
      { importedCount: 0, skippedCount: 1, totalCount: 1 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
