import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, request } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

// Only an isolated child is exposed to malformed bodies, never the user's server.
let child: ChildProcess;
let base: string;
let temporaryDirectory: string;
const upstream = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
});
const anonymousRequest = JSON.stringify({ messages: [{ role: "user", content: "anonymous JSON safety check" }] });

function sendBody(body: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(`${base}/api/model/chat`, {
      method: "POST", agent: false,
      headers: { "Content-Type": "application/json", "Content-Length": String(body.length), ...headers },
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode!, text }));
    });
    req.setTimeout(5000, () => req.destroy(new Error("Anonymous JSON boundary request timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-interview-json-safety-"));
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const portReservation = createServer();
  await new Promise<void>(resolve => portReservation.listen(0, "127.0.0.1", resolve));
  const port = (portReservation.address() as { port: number }).port;
  await new Promise<void>(resolve => portReservation.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), windowsHide: true, stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production", PORT: String(port),
      MODEL_PROVIDER: "anonymous-local", MODEL_API_KEY: "anonymous-test-key",
      MODEL_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
      MODEL_NAME: "anonymous-local-model", LLM_BUDGET_ENFORCEMENT: "false", LLM_MAX_RETRIES: "0",
      LLM_USAGE_LOG_PATH: path.join(temporaryDirectory, "usage.jsonl") },
  });
  const deadline = Date.now() + 15000;
  while (true) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* Wait for this child only. */ }
    if (Date.now() > deadline) throw new Error("Anonymous JSON safety server did not start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});

after(async () => {
  child?.kill();
  upstream.closeAllConnections();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  // Never remove anything outside the directory created by this fixture.
  if (temporaryDirectory && path.dirname(path.resolve(temporaryDirectory)) === path.resolve(os.tmpdir())
    && path.basename(temporaryDirectory).startsWith("ai-interview-json-safety-")) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("压缩JSON后的尾随字节不终止生产代理，后续健康与普通请求仍可用", async () => {
  // GHSA-27r3-jxmh-p828: the late decoder error must not kill the process.
  const body = Buffer.concat([gzipSync(anonymousRequest), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
  let response: Awaited<ReturnType<typeof sendBody>> | undefined;
  let transportError = "";
  try { response = await sendBody(body, { "Content-Encoding": "gzip" }); }
  catch (error) { transportError = error instanceof Error ? error.message : String(error); }
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(child.exitCode, null, `尾随字节不得导致未捕获异常退出；HTTP错误：${transportError || "无"}`);
  assert.ok(response && (response.status === 200 || response.status === 400), "应正常响应或明确拒绝无效压缩正文");
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const next = await sendBody(Buffer.from(anonymousRequest));
  assert.equal(next.status, 200);
  assert.equal(JSON.parse(next.text).content, '{"ok":true}');
});

for (const encoding of ["identity", "gzip"] as const) {
  test(`${encoding}正常JSON仍可调用代理，返回本地替身的结果`, async () => {
    const body = encoding === "gzip" ? gzipSync(anonymousRequest) : Buffer.from(anonymousRequest);
    const response = await sendBody(body, { "Content-Encoding": encoding });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).content, '{"ok":true}');
  });
}

const invalidBodies = [
  { name: "无效JSON", body: () => Buffer.from('{"messages":'), encoding: "identity", status: 400 },
  { name: "损坏gzip", body: () => Buffer.from("not a gzip frame"), encoding: "gzip", status: 400 },
  { name: "不支持的压缩编码", body: () => Buffer.from(anonymousRequest), encoding: "unsupported", status: 415 },
  { name: "超过原1MiB上限的JSON", body: () => Buffer.from(JSON.stringify({ text: "x".repeat(1024 * 1024) })), encoding: "identity", status: 413 },
];
for (const scenario of invalidBodies) {
  test(`${scenario.name}明确拒绝，服务仍可接受后续健康请求`, async () => {
    const response = await sendBody(scenario.body(), { "Content-Encoding": scenario.encoding });
    assert.equal(response.status, scenario.status);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
}
