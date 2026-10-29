import { isOcrImage, validateOcrImage } from "./localOcr";
/** Binary originals deliberately live outside localStorage and JSON backups. */
const DB_NAME = "ai-interview-material-files-v1";
const STORE = "files";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export type StoredMaterialFile = { id: string; blob: Blob; name: string; type: string; size: number; createdAt: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("当前浏览器不支持原文件存储；可继续仅保存文字。"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开原文件存储。"));
  });
}

export async function storeMaterialFile(id: string, file: File): Promise<StoredMaterialFile> {
  if (!file.size) throw new Error("文件为空，未保存原件。");
  if (isOcrImage(file)) validateOcrImage(file);
  else if (file.size > MAX_FILE_BYTES) throw new Error("文件超过 8MB 原件保存上限；可改为只保存已核对文字。");
  const value: StoredMaterialFile = { id, blob: file, name: file.name, type: file.type, size: file.size, createdAt: new Date().toISOString() };
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); return value; }
  finally { db.close(); }
}

export async function getMaterialFile(id: string): Promise<StoredMaterialFile | null> {
  const db = await openDatabase();
  try { return await new Promise(resolve => { const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id); request.onsuccess = () => resolve((request.result as StoredMaterialFile | undefined) ?? null); request.onerror = () => resolve(null); }); }
  finally { db.close(); }
}

export async function deleteMaterialFile(id: string): Promise<void> {
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || new Error("原件删除失败。")); tx.onabort = () => reject(tx.error || new Error("原件删除事务中止。")); }); }
  finally { db.close(); }
}

export const materialFileLimit = MAX_FILE_BYTES;
