export class IndexedDbTaskStore {
  constructor({ dbName = "task-orchestrator-dashboard", storeName = "runtime", key = "latest" } = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.key = key;
    this._dbPromise = null;
  }

  async loadState() {
    const db = await this.#openDb();
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(this.key);

      request.onsuccess = () => resolve(request.result?.snapshot ?? null);
      request.onerror = () => reject(request.error ?? new Error("indexeddb-read-failed"));
    });
  }

  async saveState(snapshot) {
    const db = await this.#openDb();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);

      store.put({ id: this.key, savedAt: Date.now(), snapshot });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb-write-failed"));
    });
  }

  async #openDb() {
    if (typeof indexedDB === "undefined") return null;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexeddb-open-failed"));
    });

    return this._dbPromise;
  }
}
