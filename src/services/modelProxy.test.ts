import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let child: ChildProcess;
let base: string;
let releaseStarted: () => void;
let releaseClosed: () => void;
let usageDirectory: string;
const upstream = createServer((req, res) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const marker = JSON.parse(body).messages[0].content;
    if (marker === "anonymous invalid envelope") { res.setHeader("Content-Type", "application/json"); res.end("not-json"); return; }
    if (marker === "anonymous truncated output") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: '{"incomplete":' }, finish_reason: "length" }], usage: { prompt_tokens: 30, completion_tokens: 40, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 20, completion_tokens_details: { reasoning_tokens: 25 } } })); return; }
    if (JSON.parse(body).messages[0].content === "anonymous experience questions") {
      const request = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ model: request.model, max_tokens: request.max_tokens, thinking: request.thinking, response_format: request.response_format }) } }], usage: { prompt_tokens: 50, completion_tokens: 80 } }));
      return;
    }
    if (JSON.parse(body).messages[0].content === "anonymous bad request") {
      res.statusCode = 400; res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "anonymous-test-key private provider detail" } })); return;
    }
    if (JSON.parse(body).messages[0].content === "anonymous upstream failure") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { message: "upstream echoed anonymous-test-key and private internals" } }));
      return;
    }
    if (JSON.parse(body).messages[0].content === "anonymous successful test") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}', reasoning_content: "anonymous internal-thought", encrypted_content: "anonymous encrypted thought" }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 450, completion_tokens_details: { reasoning_tokens: 300 } } }));
      return;
    }
    if (JSON.parse(body).messages[0].content === "anonymous streaming test") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.write('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\n');
      res.end('data: {"choices":[],"usage":{"prompt_tokens":77,"completion_tokens":12,"total_tokens":89,"prompt_cache_hit_tokens":20,"prompt_cache_miss_tokens":57}}');
      return;
    }
    releaseStarted?.();
    res.on("close", () => releaseClosed?.());
    // The external API deliberately stays pending; a proxy disconnect must close it.
  });
});

test("代理成功响应提供实际token用量和耗时，不返回密钥或推理内容", async () => {
  const response = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "coach", messages: [{ role: "user", content: "anonymous successful test" }] }) });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.content, '{"ok":true}');
  assert.equal(data.metrics?.inputTokens, 120);
  assert.equal(data.metrics?.outputTokens, 450);
  assert.equal(data.metrics?.reasoningTokens, 300);
  assert.ok(data.metrics?.durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(data), /anonymous-test-key|reasoning_content|encrypted_content|internal-thought|Authorization/);
});

test("上游失败保留HTTP状态，但不向浏览器转发可能包含凭据的原始错误", async () => {
  const response = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "coach", messages: [{ role: "user", content: "anonymous upstream failure" }] }) });
  const data = await response.json();
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(data), /anonymous-test-key|private internals/);
});
test("专项题使用有界JSON与DeepSeek非思考参数，独立计量；400不泄露上游正文", async () => {
  const response = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "experience_question_generation", messages: [{ role: "user", content: "anonymous experience questions" }] }) });
  const data = await response.json(), sent = JSON.parse(data.content);
  assert.equal(sent.model, "deepseek-flash");
  assert.equal(sent.max_tokens, 2048);
  assert.deepEqual(sent.thinking, { type: "disabled" });
  assert.deepEqual(sent.response_format, { type: "json_object" });
  const bad = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "experience_question_generation", messages: [{ role: "user", content: "anonymous bad request" }] }) });
  assert.equal(bad.status, 400);
  assert.doesNotMatch(await bad.text(), /anonymous-test-key|private provider/);
  const log = await readFile(path.join(usageDirectory, "usage.jsonl"), "utf8");
  assert.match(log, /"feature":"experience_question_generation"/);
  assert.doesNotMatch(log, /anonymous experience questions/);
});
test("资料分类与汇总沿用代理预算和用量日志，各自使用有界JSON参数", async () => {
  for (const feature of ["material_organization", "material_summary"]) {
    const response = await fetch(`${base}/api/model/chat`, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feature,messages:[{role:"user",content:"anonymous experience questions"}]}) });
    assert.equal(response.status,200);
    const data = await response.json(); const request = JSON.parse(data.content);
    assert.equal(request.thinking.type,"disabled"); assert.equal(request.response_format.type,"json_object");
    assert.ok(request.max_tokens > 0 && request.max_tokens <= 6144);
    const events = (await readFile(path.join(usageDirectory,"usage.jsonl"),"utf8")).trim().split("\n").map(s => JSON.parse(s));
    const saved = events.find(e => e.requestId === data.metrics.requestId && e.status === "succeeded");
    assert.equal(saved.feature,feature); assert.equal(saved.inputTokens,50); assert.equal(saved.outputTokens,80);
  }
});
before(async () => {
  usageDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-interview-proxy-"));
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), MODEL_PROVIDER: "deepseek", MODEL_API_KEY: "anonymous-test-key", MODEL_BASE_URL: `http://127.0.0.1:${upstreamPort}`, MODEL_NAME: "deepseek-flash", MODEL_COACH_TIMEOUT_MS: "1000", MODEL_INTERVIEW_TIMEOUT_MS: "1000", LLM_USAGE_LOG_PATH: path.join(usageDirectory, "usage.jsonl"), LLM_BUDGET_ENFORCEMENT: "false" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 10000;
  while (true) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error("Anonymous proxy fixture did not start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
});
after(async () => {
  child?.kill();
  upstream.closeAllConnections();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await rm(usageDirectory, { recursive: true, force: true });
});

test("浏览器断开模型请求后，本地代理会终止到上游的HTTP连接", async () => {
  const started = new Promise<void>(resolve => { releaseStarted = resolve; });
  let closed = false;
  releaseClosed = () => { closed = true; };
  const controller = new AbortController();
  const request = fetch(`${base}/api/model/chat`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "coach", messages: [{ role: "user", content: "anonymous cancellation test" }] }) }).catch(() => null);
  await started;
  controller.abort(); await request;
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(closed, true, "上游连接不应在浏览器断开后继续悬挂");
});

test("代理转发流式响应时采集最终 usage，且日志不包含提示正文", async () => {
  const response = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "interview_feedback", stream: true, messages: [{ role: "user", content: "anonymous streaming test" }] }) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /prompt_tokens/);
  const log = await readFile(path.join(usageDirectory, "usage.jsonl"), "utf8");
  assert.match(log, /"inputTokens":77/);
  assert.match(log, /"cacheHitTokens":20/);
  assert.doesNotMatch(log, /anonymous streaming test/);
  const event = log.trim().split("\n").map(line => JSON.parse(line)).filter(event => event.inputTokens === 77).at(-1);
  assert.ok(typeof event.firstTokenLatencyMs === "number" && event.firstTokenLatencyMs >= 0);
});

test("代理记录结构化异常阶段、真实思考Token及截断，不把传输成功当业务成功", async () => {
  const invalid = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "anonymous invalid envelope" }] }) });
  assert.equal(invalid.status, 502);
  const truncated = await fetch(`${base}/api/model/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "experience_extraction", messages: [{ role: "user", content: "anonymous truncated output" }] }) });
  assert.equal(truncated.status, 200, "不改已有客户端格式校验流程"); await truncated.json();
  const events = (await readFile(path.join(usageDirectory, "usage.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const bad = events.find(event => event.errorCode === "invalid_response_json");
  assert.equal(bad.diagnostics.phase, "response_json"); assert.equal(bad.inputTokens, null);
  const cut = events.find(event => event.diagnostics?.finishReason === "length");
  assert.equal(cut.diagnostics.phase, "output_truncated"); assert.equal(cut.diagnostics.contentJsonValid, false);
  assert.equal(cut.reasoningTokens, 25); assert.equal(cut.nonReasoningOutputTokens, 15);
  assert.equal(cut.firstTokenLatencyMs, null, "非流式首Token不可测");
});

test("代理的可配置教练等待到期后返回504，并关闭未响应的上游连接", async () => {
  let closed = false;
  releaseClosed = () => { closed = true; };
  const response = await fetch(`${base}/api/model/chat`, { method: "POST", signal: AbortSignal.timeout(2500), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "coach", messages: [{ role: "user", content: "anonymous timeout test" }] }) });
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /超时/);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(closed, true);
});
