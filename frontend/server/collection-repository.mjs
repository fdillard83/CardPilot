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
}
