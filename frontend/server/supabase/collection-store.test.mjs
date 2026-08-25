import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { SupabaseCollectionRepository } from "./collection-store.mjs";

class FakeQuery {
  constructor(client) {
    this.client = client;
    this.action = "select";
    this.filters = [];
    this.payload = null;
    this.returnRows = false;
    this.single = false;
  }

  select() {
    this.returnRows = true;
    return this;
  }

  insert(payload) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(key, value) {
    this.filters.push([key, value]);
    return this;
  }

  order() {
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const matches = (row) =>
      this.filters.every(([key, value]) => row[key] === value);
    if (this.action === "insert") {
      this.client.rows.push({ ...this.payload });
      return { data: null, error: null };
    }
    if (this.action === "update") {
      const updated = [];
      for (const row of this.client.rows.filter(matches)) {
        Object.assign(row, this.payload);
        updated.push({ collection_id: row.collection_id });
      }
      return { data: this.returnRows ? updated : null, error: null };
    }
    if (this.action === "delete") {
      this.client.rows = this.client.rows.filter((row) => !matches(row));
      return { data: null, error: null };
    }
    const rows = this.client.rows
      .filter(matches)
      .map((row) => ({ record: row.record }));
    return {
      data: this.single ? rows[0] ?? null : rows,
      error: null,
    };
  }
}

function fakeClient() {
  const objects = new Map();
  return {
    rows: [],
    objects,
    from() {
      return new FakeQuery(this);
    },
    storage: {
      from() {
        return {
          async upload(path, buffer, options) {
            objects.set(path, { buffer, options });
            return { error: null };
          },
          async remove(paths) {
            for (const path of paths) objects.delete(path);
            return { error: null };
          },
          async download(path) {
            const object = objects.get(path);
            return object
              ? { data: new Blob([object.buffer]), error: null }
              : { data: null, error: new Error("Object not found") };
          },
          async createSignedUrl(path) {
            return {
              data: { signedUrl: `https://private.example/${path}?token=signed` },
              error: null,
            };
          },
        };
      },
    },
  };
}

const passthroughBackupImageEncoder = async (blob, mimeType) => ({
  mimeType,
  base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
});

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

test("Supabase collections and images are scoped to one account", async () => {
  const client = fakeClient();
  const store = new SupabaseCollectionRepository({
    client,
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
  const created = await store.create("user-a", {
    identificationId: "identification-1",
    fields,
    overallConfidence: 0.91,
    decision: "confirm",
    frontImage: "data:image/jpeg;base64,Zm9v",
  });

  assert.equal((await store.list("user-a")).length, 1);
  assert.equal((await store.list("user-b")).length, 0);
  assert.equal(await store.get("user-b", created.collectionId), null);
  assert.equal(client.objects.size, 1);

  const image = await store.image("user-a", created.collectionId, "front");
  assert.match(image.signedUrl, new RegExp(`user-a/${created.collectionId}`));
  assert.equal(await store.image("user-b", created.collectionId, "front"), null);

  assert.equal(await store.remove("user-b", created.collectionId), false);
  assert.equal(await store.remove("user-a", created.collectionId), true);
  assert.equal(client.objects.size, 0);
});

test("collection export includes private images and account cleanup stays scoped", async () => {
  const client = fakeClient();
  const store = new SupabaseCollectionRepository({
    client,
    backupImageEncoder: passthroughBackupImageEncoder,
  });
  await store.create("user-a", {
    identificationId: "identification-a",
    fields,
    overallConfidence: 0.91,
    decision: "confirm",
    frontImage: "data:image/jpeg;base64,Zm9v",
  });
  await store.create("user-b", {
    identificationId: "identification-b",
    fields,
    overallConfidence: 0.82,
    decision: "confirm",
    frontImage: "data:image/jpeg;base64,YmFy",
  });

  const backup = await store.export("user-a");
  assert.equal(backup.length, 1);
  assert.equal(backup[0].images.front.base64, "Zm9v");
  assert.equal(backup[0].images.front.mimeType, "image/jpeg");

  const removed = await store.removeAllForUser("user-a");
  assert.deepEqual(removed, { cardCount: 1, imageCount: 1 });
  assert.equal((await store.list("user-a")).length, 0);
  assert.equal((await store.list("user-b")).length, 1);
  assert.equal(client.objects.size, 1);
});

test("collection export retries images and preserves card details when an image is unavailable", async () => {
  const client = fakeClient();
  const store = new SupabaseCollectionRepository({
    client,
    backupImageEncoder: passthroughBackupImageEncoder,
  });
  const created = await store.create("user-a", {
    identificationId: "identification-a",
    fields,
    overallConfidence: 0.91,
    decision: "confirm",
    frontImage: "data:image/jpeg;base64,Zm9v",
  });
  client.objects.clear();

  const backup = await store.export("user-a");

  assert.equal(backup.length, 1);
  assert.equal(backup[0].collectionId, created.collectionId);
  assert.equal(backup[0].images.front, null);
  assert.deepEqual(backup[0].imageWarnings, [
    "Front image was unavailable when this backup was created.",
  ]);
});

test("collection export processes a bounded group of card images concurrently", async () => {
  const client = fakeClient();
  const store = new SupabaseCollectionRepository({
    client,
    backupImageEncoder: passthroughBackupImageEncoder,
  });
  for (let index = 0; index < 8; index += 1) {
    await store.create("user-a", {
      identificationId: `identification-${index}`,
      fields,
      overallConfidence: 0.91,
      decision: "confirm",
      frontImage: "data:image/jpeg;base64,Zm9v",
    });
  }

  const originalStorageFrom = client.storage.from.bind(client.storage);
  let activeDownloads = 0;
  let maximumActiveDownloads = 0;
  client.storage.from = () => {
    const bucket = originalStorageFrom();
    return {
      ...bucket,
      async download(path) {
        activeDownloads += 1;
        maximumActiveDownloads = Math.max(maximumActiveDownloads, activeDownloads);
        await new Promise((resolve) => setTimeout(resolve, 10));
        try {
          return await bucket.download(path);
        } finally {
          activeDownloads -= 1;
        }
      },
    };
  };

  const backup = await store.export("user-a");

  assert.equal(backup.length, 8);
  assert.ok(maximumActiveDownloads > 1);
  assert.ok(maximumActiveDownloads <= 6);
});

test("collection export replaces full images with compact JPEG thumbnails", async () => {
  const client = fakeClient();
  const store = new SupabaseCollectionRepository({ client });
  const source = await sharp({
    create: {
      width: 1_000,
      height: 1_400,
      channels: 3,
      background: { r: 36, g: 112, b: 64 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
  await store.create("user-a", {
    identificationId: "identification-thumbnail",
    fields,
    overallConfidence: 0.91,
    decision: "confirm",
    frontImage: `data:image/jpeg;base64,${source.toString("base64")}`,
  });

  const backup = await store.export("user-a");
  const thumbnail = Buffer.from(backup[0].images.front.base64, "base64");
  const metadata = await sharp(thumbnail).metadata();

  assert.equal(backup[0].images.front.mimeType, "image/jpeg");
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 480);
  assert.equal(metadata.height, 672);
  assert.ok(thumbnail.length < source.length);
});
