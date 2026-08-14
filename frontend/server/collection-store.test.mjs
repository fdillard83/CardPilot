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
    assert.deepEqual(created.valuationProfile, {
      featureType: "ordinary",
      source: "derived",
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
      valuationProfile: {
        featureType: "on_card_autograph",
        source: "user_confirmed",
      },
      ebayReference: {
        itemId: "v1|456|0",
        title: "Collector-confirmed visual match",
        itemWebUrl: "https://www.ebay.com/itm/456",
      },
    });
    assert.equal(updated.fields.player, "Nolan Ryan (confirmed)");
    assert.deepEqual(updated.grading, {
      isGraded: true,
      company: "PSA",
      grade: "10",
      certificationNumber: "12345678",
    });
    assert.deepEqual(updated.valuationProfile, {
      featureType: "on_card_autograph",
      source: "user_confirmed",
    });
    assert.equal(updated.ebayReference.itemId, "v1|456|0");
    assert.notEqual(updated.updatedAt, created.updatedAt);

    const identityOnlyUpdate = await store.update(created.collectionId, {
      fields: { ...updated.fields, team: "California Angels" },
    });
    assert.deepEqual(identityOnlyUpdate.grading, updated.grading);
    assert.deepEqual(
      identityOnlyUpdate.valuationProfile,
      updated.valuationProfile,
    );
    assert.deepEqual(identityOnlyUpdate.ebayReference, updated.ebayReference);

    const valued = await store.updateConfirmedValuation(created.collectionId, {
      amountCents: 4250,
      currency: "USD",
      confidence: "medium",
      method: "exact_sold",
      userAdjusted: false,
    });
    assert.deepEqual(valued.confirmedValuation, {
      amountCents: 4250,
      currency: "USD",
      confidence: "medium",
      method: "exact_sold",
      userAdjusted: false,
      valuedAt: "2026-08-12T12:00:03.000Z",
    });

    const storedRecord = JSON.parse(
      await readFile(path.join(directory, "collection.json"), "utf8"),
    )[0];
    assert.deepEqual(Object.keys(storedRecord.confirmedValuation).sort(), [
      "amountCents",
      "confidence",
      "currency",
      "method",
      "userAdjusted",
      "valuedAt",
    ]);

    const cleared = await store.clearConfirmedValuation(created.collectionId);
    assert.equal(cleared.confirmedValuation, null);

    assert.equal(await store.remove(created.collectionId), true);
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.image(created.collectionId, "front"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collection records normalize and title Pokémon fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cardpilot-pokemon-"));
  const store = new CollectionStore({
    recordsFile: path.join(directory, "collection.json"),
    imagesDirectory: path.join(directory, "images"),
  });

  try {
    const created = await store.create({
      identificationId: "pokemon-1",
      fields: {
        ...fields,
        category: "Pokémon",
        player: null,
        character: "Charmander",
        sport: null,
        team: null,
        setOrInsert: "Mega Evolution Promos",
        cardNumber: "038",
        language: "English",
        rarity: "Promo",
        raritySymbol: "Black Star",
        finish: "Holo",
        promo: true,
        rookieStatus: null,
        serialNumber: null,
        autograph: null,
        memorabilia: null,
        imageVariation: null,
      },
      overallConfidence: 0.92,
      decision: "confirm",
      frontImage: "data:image/jpeg;base64,Zm9v",
      pokemonCatalogReference: {
        cardId: "mep-038",
        label: "Charmander · Mega Evolution Promos · #038",
        imageUrl: "https://images.pokemontcg.io/mep/038.png",
        catalogUrl: "https://prices.pokemontcg.io/tcgplayer/mep-038",
      },
    });

    assert.equal(
      created.title,
      "2026 Charmander Mega Evolution Promos #038",
    );
    assert.equal(created.fields.character, "Charmander");
    assert.equal(created.fields.raritySymbol, "Black Star");
    assert.equal(created.fields.promo, true);
    assert.equal(created.pokemonCatalogReference.cardId, "mep-038");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
