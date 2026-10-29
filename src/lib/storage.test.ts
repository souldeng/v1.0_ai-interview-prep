import assert from "node:assert/strict";
import test from "node:test";
import { deleteHistory } from "./storage";

test("历史模块容量常量保持个人 MVP 边界", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./storage.ts", import.meta.url), "utf8"));
  assert.match(source, /MAX_ITEMS = 20/); assert.match(source, /MAX_BYTES = 2 \* 1024 \* 1024/);
});
test("选择性删除遇到损坏历史时拒绝写入，不能丢弃其他原始记录", () => {
  const raw = JSON.stringify([{ id: "damaged-record", answer: "必须保留的旧原文" }]);
  let stored = raw;
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } } });
  try { assert.throws(() => deleteHistory("another-record"), /损坏|备份/); assert.equal(stored, raw); }
  finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous }); }
});
