import assert from "node:assert/strict";
import test from "node:test";
import { deleteMaterialFile, storeMaterialFile } from "./materialFileStorage";

test("原件删除事务中止会报告失败，不能一直等待或假称删除成功", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const failure = new Error("匿名原件事务中止");
  const transaction = { error: failure, onabort: null as (() => void) | null, objectStore: () => ({ delete: () => { setTimeout(() => transaction.onabort?.(), 0); } }) };
  const database = { transaction: () => transaction, close: () => {} };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => { const request = { result: database, onsuccess: null as (() => void) | null }; setTimeout(() => request.onsuccess?.(), 0); return request; } } });
  try {
    const result = await Promise.race([deleteMaterialFile("anonymous-original").then(() => "success", error => error.message), new Promise<string>(resolve => setTimeout(() => resolve("没有报告事务中止"), 150))]);
    assert.equal(result, "匿名原件事务中止");
  } finally { if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else Reflect.deleteProperty(globalThis, "indexedDB"); }
});
test("原件仅对PNG/JPEG开放10MB，文档仍8MB；超限请求不打开IndexedDB",async()=>{
  let opened=0;
  const previous=Object.getOwnPropertyDescriptor(globalThis,"indexedDB");
  Object.defineProperty(globalThis,"indexedDB",{configurable:true,value:{open:()=>{opened++;throw new Error("不应打开原件库");}}});
  try {
    await assert.rejects(()=>storeMaterialFile("over-image",new File([new Uint8Array(10*1024*1024+1)],"过大.png",{type:"image/png"})),/10MB/);
    await assert.rejects(()=>storeMaterialFile("over-doc",new File([new Uint8Array(8*1024*1024+1)],"过大.pdf",{type:"application/pdf"})),/8MB/);
    assert.equal(opened,0);
  }finally{if(previous)Object.defineProperty(globalThis,"indexedDB",previous);else Reflect.deleteProperty(globalThis,"indexedDB");}
});
