import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { reviseTurn, saveFinalAnswer } from "./coaching";
import { loadHistory, saveHistory } from "./storage";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { publicationDrift, scanPublicationText, unresolvedFindings } from "../../scripts/github-sync-check.mjs";

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
  assert.ok(!files.some(file => file.startsWith("docs/")), "内部文档不得进入公开候选");
  assert.ok(!files.some(file => /(?:^|\/)(?:\.env$|\.local-backups|playwright-report|test-results)|docs\/job-search-handoff|docs\/real-coach-20261017/.test(file)));
  assert.deepEqual(preview.errors, []);
});

test("虚构凭据仅按准确路径和值核查，真实或同一行其他凭据在工作区、暂存与历史仍需处理", () => {
  const mock = ["anonymous", "test", "key"].join("-");
  const opaque = ["unreviewed", "opaque", "credential"].join("-");
  const assignment = (value: string) => `MODEL_API_KEY: "${value}"`;
  for (const file of ["src/services/jsonRequestSafety.test.ts", "src/services/modelProxy.test.ts"]) {
    const reviewed = scanPublicationText(file, assignment(mock));
    assert.equal(reviewed.length, 1);
    assert.equal(unresolvedFindings(reviewed).length, 0, "明确的虚构值不应阻断历史");
    assert.ok(unresolvedFindings(scanPublicationText(file, assignment(opaque))).length > 0, "不能按测试文件整体豁免");
    const mixed = scanPublicationText(file, assignment(mock) + ", " + assignment(opaque));
    assert.equal(mixed.filter(item => item.resolution).length, 1);
    assert.equal(unresolvedFindings(mixed).length, 1, "同一行虚构值不得掩盖第二个凭据");
    assert.ok(unresolvedFindings(scanPublicationText(file, assignment(mock), [mock])).length > 0, "当前本地密钥完整值匹配不能被虚构分类覆盖");
    const providerCredential = "sk-" + "Z".repeat(32);
    assert.ok(unresolvedFindings(scanPublicationText(file, assignment(providerCredential))).some(item => item.kind === "credential_pattern"));
  }
  assert.ok(unresolvedFindings(scanPublicationText("src/other.test.ts", assignment(mock))).length > 0);
  assert.ok(unresolvedFindings(scanPublicationText("src/config.ts", "-----BEGIN " + "PRIVATE KEY-----")).some(item => item.kind === "private_key"));
});

test("发布范围逐文件比较，数量相同也不能隐藏额外跟踪或遗漏文件", () => {
  const clean = publicationDrift(["a.ts", "README.md"], ["README.md", "a.ts"], ["a.ts", "README.md"]);
  assert.ok(Object.values(clean).every(paths => paths.length === 0));
  const changed = publicationDrift(["a.ts", "README.md"], ["a.ts", "README.md"], ["a.ts", "private.json"]);
  assert.deepEqual(changed.trackedOnly, ["private.json"]);
  assert.deepEqual(changed.candidateNotTracked, ["README.md"]);
  assert.deepEqual(changed.trackedNotPlanned, ["private.json"]);
  const omitted = publicationDrift(["README.md", "GITHUB_SYNC.md"], ["README.md"], ["README.md", "GITHUB_SYNC.md"]);
  assert.deepEqual(omitted.gitOnly, ["GITHUB_SYNC.md"]);
});

test("同步检查实际验证30条规则并对齐工作区、发布清单、Git跟踪和暂存内容，保留历史扫描", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const packageConfig = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(packageConfig.scripts["sync:check"], "node scripts/github-sync-check.mjs", "必须保留可用的 npm 检查入口");
  const result = spawnSync(process.execPath, ["scripts/github-sync-check.mjs"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(readFileSync(new URL("../../.local-publication-audit/summary.json", import.meta.url), "utf8"));
  assert.equal(summary.probesTotal, 30);
  assert.equal(summary.probesPassed, 30);
  assert.deepEqual(summary.blockers, []);
  assert.equal(summary.readyForHumanReview, true);
  assert.deepEqual(summary.trackedIgnored, []);
  assert.deepEqual(summary.missingPlanFiles, []);
  assert.ok(Object.values(summary.manifestDrift).every((paths: unknown) => Array.isArray(paths) && paths.length === 0));
  const actual = spawnSync("git", ["--no-optional-locks", "ls-files", "-z"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(actual.status, 0, actual.stderr);
  const tracked = actual.stdout.split("\0").filter(Boolean).sort();
  const candidates = readFileSync(new URL("../../.local-publication-audit/upload-files.txt", import.meta.url), "utf8").trim().split("\n").sort();
  assert.deepEqual(candidates, tracked);
  assert.equal(summary.candidates, tracked.length);
  assert.equal(summary.originalGit.indexBlobsScanned, tracked.length);
  assert.equal(summary.originalGit.indexUnscanned.length, 0);
  assert.equal(summary.originalGit.indexUnsupported.length, 0);
  assert.equal(unresolvedFindings(summary.originalGit.indexFindings).length, 0);
  assert.equal(unresolvedFindings(summary.originalGit.history).length, 0);
  assert.equal(summary.originalGit.blobsSkipped, 0);
  assert.ok(summary.originalGit.blobsScanned > 0, "必须执行真实历史扫描");
  assert.equal(summary.candidateFindings, 0);
});
