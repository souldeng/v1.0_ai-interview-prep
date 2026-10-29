import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { reviseTurn, saveFinalAnswer } from "./coaching";
import { loadHistory, saveHistory } from "./storage";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

test("短重答与短思路按原记录保存读回，空白拒绝且不改原答", () => {
  const prep = createPreparation("", "");
  prep.questions = [{ id: "anonymous-short", text: "什么是RAG？", category: "技术理解", technical: true, sourceType: "foundation", source: "匿名测试题" }];
  const original = nextTurn(startSession(prep), "我不知道", { action: "next" });
  const revised = reviseTurn(original, 0, "不会");
  const final = saveFinalAnswer(revised, 0, "先检索再生成");
  const old = globalThis.localStorage, values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    saveHistory(final);
    const restored = loadHistory()[0];
    assert.equal(restored.turns[0].answer, "我不知道");
    assert.equal(restored.turns[0].revisions?.[0].answer, "不会");
    assert.equal(restored.turns[0].finalAnswer, "先检索再生成");
    assert.throws(() => reviseTurn(restored, 0, " \n\t "), /填写|为空|输入/);
    assert.throws(() => saveFinalAnswer(restored, 0, " \n "), /填写|为空|输入/);
    assert.deepEqual(loadHistory()[0], restored);
    assert.equal(original.turns[0].revisions, undefined);
  } finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: old }); }
});

test("发布预览包含虚构替代夹具并排除历史原件，许可证缺失仍明确阻止发布", () => {
  const result = spawnSync(process.execPath, ["scripts/release-preview.mjs", "--json"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", windowsHide: true });
  const preview = JSON.parse(result.stdout);
  const files: string[] = preview.files.map((item: { path: string }) => item.path);
  assert.ok(!files.some(file => file.startsWith("test-fixtures/coach/")), "未授权历史输出不得进入公开候选");
  const licensed = existsSync(new URL("../../LICENSE", import.meta.url));
  assert.equal(result.status, licensed ? 0 : 1, result.stderr);
  assert.equal(preview.ready, licensed);
  assert.ok(preview.excluded.includes("test-fixtures/coach"));
  assert.deepEqual(preview.blockers.map((item: { code: string; path: string }) => [item.code, item.path]), licensed ? [] : [["missing_required_file", "LICENSE"]]);
  for (const name of ["02-rag-evaluation", "03-experience", "04-discovery", "05-dont-know", "06-hypothetical", "experience-internal-note", "experience-semantic-expansion"]) {
    assert.ok(files.includes(`test-fixtures/public-coach/${name}.json`), `缺少公开替代夹具：${name}`);
  }
  assert.ok(files.includes(".env.example"));
  assert.ok(files.includes("src/App.tsx"));
  assert.ok(files.includes("SECURITY.md"));
  assert.ok(files.includes("GITHUB_SYNC.md"));
  assert.ok(files.includes("THIRD_PARTY_NOTICES.md"));
  assert.ok(!files.some(file => file.startsWith("docs/")), "内部文档不进入公开候选");
  assert.ok(!files.some(file => /(?:^|\/)(?:\.env$|\.local-backups|playwright-report|test-results)|docs\/job-search-handoff|docs\/real-coach-20261017/.test(file)));
  assert.deepEqual(preview.errors, []);
});
