import { readFile } from "node:fs/promises";

export class LocalCollectionRepository {
  constructor({ store }) {
    this.store = store;
    this.mode = "local";
  }

  list(_userId) {
    return this.store.list();
  }

  get(_userId, collectionId) {
    return this.store.get(collectionId);
  }

  create(_userId, input) {
    return this.store.create(input);
  }

  update(_userId, collectionId, input) {
    return this.store.update(collectionId, input);
  }

  remove(_userId, collectionId) {
    return this.store.remove(collectionId);
  }

  updateConfirmedValuation(_userId, collectionId, input) {
    return this.store.updateConfirmedValuation(collectionId, input);
  }

  clearConfirmedValuation(_userId, collectionId) {
    return this.store.clearConfirmedValuation(collectionId);
  }

  image(_userId, collectionId, side) {
    return this.store.image(collectionId, side);
  }

  async export(_userId) {
    const cards = await this.store.list();
    return Promise.all(
      cards.map(async (card) => {
        const [front, back] = await Promise.all([
          this.store.image(card.collectionId, "front"),
          this.store.image(card.collectionId, "back"),
        ]);
        const encode = async (image) => {
          if (!image) return null;
          const contents = await readFile(image.filePath);
          return {
            mimeType: image.mimeType,
            base64: contents.toString("base64"),
          };
        };
        return {
          ...card,
          images: {
            front: await encode(front),
            back: await encode(back),
          },
        };
      }),
    );
  }
}
