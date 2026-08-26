import type { SavePayload } from './SaveGame';

/**
 * Persistent storage for save payloads.
 *
 * IndexedDB is used where available because saves comfortably exceed what localStorage
 * is guaranteed to hold; localStorage is kept as a fallback so the game still saves in
 * restricted contexts and under test runners without an IndexedDB implementation.
 */

const DB_NAME = 'endlessquest';
const DB_VERSION = 1;
const STORE_NAME = 'saves';
const LOCAL_STORAGE_PREFIX = 'endlessquest:save:';

/** Identifier of the single automatic save slot used by the alpha UI. */
export const DEFAULT_SLOT = 'default';

/**
 * Reports whether IndexedDB is usable in the current environment.
 */
function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/**
 * Reports whether localStorage is usable in the current environment.
 */
function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Opens (and if necessary creates) the save database.
 * @returns Promise resolving to the open database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Writes a save payload to a slot.
 * @param payload Payload to persist
 * @param slot Slot identifier, defaulting to the single automatic slot
 * @throws Error if no storage backend is available
 */
export async function saveToSlot(
  payload: SavePayload,
  slot: string = DEFAULT_SLOT
): Promise<void> {
  if (hasIndexedDB()) {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(payload, slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return;
    } finally {
      db.close();
    }
  }

  if (hasLocalStorage()) {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + slot, JSON.stringify(payload));
    return;
  }

  throw new Error('No storage backend available for saving.');
}

/**
 * Reads a save payload from a slot.
 * @param slot Slot identifier
 * @returns The stored payload, or null if the slot is empty
 */
export async function loadFromSlot(slot: string = DEFAULT_SLOT): Promise<SavePayload | null> {
  if (hasIndexedDB()) {
    const db = await openDatabase();
    try {
      return await new Promise<SavePayload | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(slot);
        request.onsuccess = () => resolve((request.result as SavePayload) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  if (hasLocalStorage()) {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + slot);
    return raw ? (JSON.parse(raw) as SavePayload) : null;
  }

  return null;
}

/**
 * Removes a save from a slot.
 * @param slot Slot identifier
 */
export async function deleteSlot(slot: string = DEFAULT_SLOT): Promise<void> {
  if (hasIndexedDB()) {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } finally {
      db.close();
    }
  }

  if (hasLocalStorage()) {
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + slot);
  }
}
