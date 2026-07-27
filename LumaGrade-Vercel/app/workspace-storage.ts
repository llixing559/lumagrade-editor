const DATABASE_NAME = "lumagrade-workspace";
const DATABASE_VERSION = 1;
const STORE_NAME = "entries";

export const WORKSPACE_CLEAR_EVENT = "lumagrade-workspace-clear";
export const MAX_PERSISTED_TRAINING_BYTES = 350 * 1024 * 1024;

export type StoredFile = {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持工作区自动保存"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开浏览器工作区"));
    request.onblocked = () => reject(new Error("工作区数据库正在被其他页面占用"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("工作区读写失败"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("工作区事务已中止"));
    });
  } finally {
    database.close();
  }
}

export async function loadWorkspaceEntry<T>(key: string) {
  const result = await withStore<unknown>("readonly", (store) => store.get(key));
  return (result ?? null) as T | null;
}

export async function saveWorkspaceEntry<T>(key: string, value: T) {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(value, key));
}

export async function deleteWorkspaceEntry(key: string) {
  await withStore<undefined>("readwrite", (store) => store.delete(key));
}

export async function clearWorkspaceEntries() {
  await withStore<undefined>("readwrite", (store) => store.clear());
}

export function fileToStored(file: File): StoredFile {
  return {
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    blob: file.slice(0, file.size, file.type),
  };
}

export function storedToFile(value: StoredFile) {
  return new File([value.blob], value.name, {
    type: value.type,
    lastModified: value.lastModified,
  });
}

export async function requestPersistentWorkspaceStorage() {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  ) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function workspaceStorageEstimate() {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return null;
  }
}

export function workspaceErrorMessage(error: unknown) {
  if (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return "浏览器存储空间不足，最新工作区未能完整保存";
  }
  return error instanceof Error ? error.message : "工作区自动保存失败";
}
