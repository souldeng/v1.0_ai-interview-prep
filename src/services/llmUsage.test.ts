import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SseUsageCollector, createUsageReport, estimateCostCny, extractTokenUsage, reserveUsage, settleUsage, loadMonitoringConfig, resolvePricing, calculateBilling } from "./llmUsage";

const temporaryDirectories: string[] = [];
async function anonymousLogPath() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-interview-usage-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "usage.jsonl");
}
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

test("北京时间工作日窗口、周末、法定假期及调休周六按官方时段定价", () => {
  const config = loadMonitoringConfig({});
  for (const [time, expected] of [
    ["2026-10-23T01:00:00Z", 2], ["2026-10-23T03:59:59Z", 2], ["2026-10-23T04:00:00Z", 1],
    ["2026-10-23T06:00:00Z", 2], ["2026-10-23T10:00:00Z", 1],
    ["2026-10-24T02:00:00Z", 1], ["2026-10-10T02:00:00Z", 1], ["2026-10-01T02:00:00Z", 1],
    ["2026-02-20T02:00:00Z", 1], ["2026-10-23T18:00:00Z", 1],
  ] as const) assert.equal(resolvePricing("deepseek", "deepseek-flash", config, {}, new Date(time))?.inputCnyPerMillion, expected, time);
});

test("真实usage周六对账0.100636，跨时段只报告范围，不按时长伪造Token分摊", () => {
  const config = loadMonitoringConfig({});
  const usage = extractTokenUsage({ prompt_tokens: 6696, completion_tokens: 23485, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 6696 });
  const weekend = calculateBilling("deepseek", "deepseek-flash", "2026-10-24T13:24:00Z", "2026-10-24T13:29:00Z", usage, config, {});
  assert.equal(weekend.estimatedCostCny, 0.100636);
  assert.equal(weekend.startPeriod, "off_peak");
  const crossed = calculateBilling("deepseek", "deepseek-flash", "2026-10-23T03:59:50Z", "2026-10-23T04:00:20Z", usage, config, {});
  assert.equal(crossed.crossesPeriods, true);
  assert.equal(crossed.estimatedCostCny, null);
  assert.equal(crossed.minCostCny, 0.100636);
  assert.equal(crossed.maxCostCny, 0.201272);
});

test("真实 usage 保留缓存拆分并按费率估算，不把推理 token 重复计费", () => {
  const usage = extractTokenUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 25 }, completion_tokens_details: { reasoning_tokens: 12 } });
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheHitTokens: 25, cacheMissTokens: 75, reasoningTokens: 12, nonReasoningOutputTokens: 8 });
  assert.equal(estimateCostCny(usage, { inputCnyPerMillion: 2, cacheHitCnyPerMillion: 0.04, outputCnyPerMillion: 8, basis: "anonymous" }), (75 * 2 + 25 * 0.04 + 20 * 8) / 1_000_000);
});

test("流式 usage 只读取最终非空 usage，不累加前序片段", () => {
  const collector = new SseUsageCollector();
  collector.push('data: {"choices":[{"delta":{"content":"答"}}]}\r\n\r\n');
  collector.push('data: {"choices":[{"finish_reason":"length"}],"usage":{"prompt_tokens":80,"completion_tokens":16,"total_tokens":96,"prompt_cache_hit_tokens":30,"prompt_cache_miss_tokens":50,"completion_tokens_details":{"reasoning_tokens":10}}}\n\n');
  collector.push("data: [DONE]\n\n");
  assert.deepEqual(collector.usage(), { inputTokens: 80, outputTokens: 16, totalTokens: 96, cacheHitTokens: 30, cacheMissTokens: 50, reasoningTokens: 10, nonReasoningOutputTokens: 6 });
  assert.equal(collector.finishReason(), "length");
  assert.equal(extractTokenUsage({ prompt_tokens: 4, completion_tokens: 9 }).reasoningTokens, null);
});

test("并发预算预留不会绕过全局每日调用上限，日志不写入提示文本", async () => {
  const logPath = await anonymousLogPath();
  const env = { ...process.env, LLM_USAGE_LOG_PATH: logPath, LLM_BUDGET_ENFORCEMENT: "true", LLM_DAILY_REQUEST_LIMIT: "1", LLM_DAILY_BUDGET_CNY: "100", LLM_MONTHLY_BUDGET_CNY: "100", LLM_MAX_OUTPUT_TOKENS: "16" };
  const input = { feature: "interview_feedback" as const, provider: "DeepSeek", model: "deepseek-v4-pro", messages: [{ content: "匿名简历全文：不应写入监控日志" }] };
  const [first, second] = await Promise.all([reserveUsage(input, env), reserveUsage(input, env)]);
  assert.equal([first, second].filter(result => result.accepted).length, 1);
  assert.equal([first, second].filter(result => !result.accepted).length, 1);
  const accepted = first.accepted ? first : second as Extract<typeof second, { accepted: true }>;
  if (!accepted.accepted) throw new Error("expected an accepted reservation");
  await settleUsage(accepted.reservation, { status: "succeeded", durationMs: 42, usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheHitTokens: null, cacheMissTokens: null } }, env);
  const raw = await readFile(logPath, "utf8");
  assert.doesNotMatch(raw, /匿名简历全文|不应写入监控日志/);
  const report = await createUsageReport(logPath);
  assert.equal(report.today.requests, 1);
  assert.equal(report.today.blocked, 1);
  assert.equal(report.today.byFeature.interview_feedback?.totalTokens, 14);
});

test("没有 usage 的取消请求保留保守预留，而不是错误记为零成本", async () => {
  const logPath = await anonymousLogPath();
  const env = { ...process.env, LLM_USAGE_LOG_PATH: logPath, LLM_BUDGET_ENFORCEMENT: "false", LLM_MAX_OUTPUT_TOKENS: "16" };
  const reserved = await reserveUsage({ feature: "experience_extraction", provider: "DeepSeek", model: "deepseek-v4-pro", messages: [{ content: "anonymous" }] }, env);
  assert.equal(reserved.accepted, true);
  if (!reserved.accepted) throw new Error("expected reservation");
  await settleUsage(reserved.reservation, { status: "cancelled", durationMs: 123, errorCode: "client_cancelled" }, env);
  const report = await createUsageReport(logPath);
  assert.equal(report.all.cancelled, 1);
  assert.equal(report.all.knownCostCny, 0);
  assert.ok(report.all.reservedUnknownCostCny > 0);
});

test("历史估算只读复算，五条400未知用量与预算预留不冒充实际花费", async () => {
  const logPath = await anonymousLogPath();
  const base = { version: 1, timestamp: "2026-10-24T13:28:00Z", startedAt: "2026-10-24T13:24:00Z", feature: "experience_extraction", provider: "deepseek", model: "deepseek-flash", durationMs: 40000, pricingBasis: "DeepSeek direct peak upper-bound pricing (2026-10-22 snapshot)", cacheHitTokens: 0 };
  const events = [
    { ...base, requestId: "known-1", status: "succeeded", inputTokens: 1169, cacheMissTokens: 1169, outputTokens: 11190, totalTokens: 12359, estimatedCostCny: 0.091858, reservedCostCny: null, errorCode: null },
    { ...base, requestId: "known-2", feature: "job_analysis", status: "succeeded", inputTokens: 5527, cacheMissTokens: 5527, outputTokens: 12295, totalTokens: 17822, estimatedCostCny: 0.109414, reservedCostCny: null, errorCode: null },
    ...Array.from({ length: 5 }, (_,i) => ({ ...base, requestId: `failed-${i}`, feature: i === 4 ? "interview_question" : "experience_extraction", status: "failed", inputTokens: null, outputTokens: null, totalTokens: null, cacheHitTokens: null, cacheMissTokens: null, estimatedCostCny: null, reservedCostCny: i === 4 ? 0.133332 : 0.107988, errorCode: "upstream_http_400" })),
  ];
  await appendFile(logPath, events.map(event => JSON.stringify(event)).join("\n") + "\n");
  const before = await readFile(logPath, "utf8");
  const { all } = await createUsageReport(logPath, "2026-10-24T15:00:00Z");
  assert.equal(Number(all.knownCostCny.toFixed(6)), 0.100636);
  assert.equal(Number(all.recordedKnownCostCny.toFixed(6)), 0.201272);
  assert.equal(all.unknownUsageRequests, 5);
  assert.equal(Number(all.reservedUnknownCostCny.toFixed(6)), 0.565284);
  assert.equal(all.reasoningKnownRequests, 0);
  assert.equal(all.reasoningTokenRatio, null);
  assert.equal(all.failures.length, 5);
  assert.ok(all.failures.every(item => item.phase === "upstream_http" && item.httpStatus === 400));
  assert.equal(await readFile(logPath, "utf8"), before);
});

test("空闲请求前按高峰保守预留，完成后按真实usage结算并持久化思考与请求参数", async () => {
  const logPath = await anonymousLogPath();
  const env = { LLM_USAGE_LOG_PATH: logPath, LLM_BUDGET_ENFORCEMENT: "true", LLM_DAILY_BUDGET_CNY: "1", LLM_MONTHLY_BUDGET_CNY: "20", LLM_MAX_OUTPUT_TOKENS: "100" };
  const reserved = await reserveUsage({ feature: "job_analysis", provider: "deepseek", model: "deepseek-flash", messages: [{ content: "anonymous" }], requestOptions: { maxOutputTokens: 100, thinkingMode: "provider_default", reasoningEffort: "not_set", jsonMode: false } }, env, new Date("2026-10-24T13:00:00Z"));
  assert.equal(reserved.accepted, true); if (!reserved.accepted) throw new Error("expected accepted");
  assert.equal(reserved.reservation.budgetPricing?.outputCnyPerMillion, 8);
  const usage = extractTokenUsage({ prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens_details: { reasoning_tokens: 12 } });
  await settleUsage(reserved.reservation, { status: "succeeded", durationMs: 1000, usage, completedAt: "2026-10-24T13:00:01Z", diagnostics: { phase: "completed", finishReason: "stop", httpStatus: 200, contentJsonValid: true } }, env);
  const lines = (await readFile(logPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines[1].reasoningTokens, 12);
  assert.equal(lines[1].nonReasoningOutputTokens, 8);
  assert.equal(lines[1].billing.startPeriod, "off_peak");
  assert.equal(lines[1].estimatedCostCny, 0.00009);
  assert.equal(lines[1].reservedCostCny, null);
  assert.equal(lines[1].requestOptions.thinkingMode, "provider_default");
});

test("日历未知不伪报精确价格，跨午休即使首尾都高峰也识别混合时段", () => {
  const usage = extractTokenUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 });
  const unknown = calculateBilling("deepseek", "deepseek-flash", "2027-01-04T02:00:00Z", "2027-01-04T02:01:00Z", usage, loadMonitoringConfig({}), {});
  assert.equal(unknown.resolution, "calendar_unknown"); assert.equal(unknown.estimatedCostCny, null);
  assert.equal(unknown.minCostCny, 0.00018); assert.equal(unknown.maxCostCny, 0.00036);
  const lunch = calculateBilling("deepseek", "deepseek-flash", "2026-10-23T03:50:00Z", "2026-10-23T06:10:00Z", usage, loadMonitoringConfig({}), {});
  assert.equal(lunch.startPeriod, "peak"); assert.equal(lunch.endPeriod, "peak"); assert.equal(lunch.crossesPeriods, true);
  assert.equal(lunch.estimatedCostCny, null);
  assert.equal(resolvePricing("deepseek", "deepseek-flash", loadMonitoringConfig({}), { LLM_INPUT_CNY_PER_M_TOKEN: "", LLM_CACHE_HIT_CNY_PER_M_TOKEN: "", LLM_OUTPUT_CNY_PER_M_TOKEN: "" }, new Date("2026-10-24T02:00:00Z"))?.inputCnyPerMillion, 1);
});

test("并发费用预算按高峰预留锁定，真实usage结算后释放差额，不与实际费用相加", async () => {
  const logPath = await anonymousLogPath(), now = new Date("2026-10-24T13:00:00Z");
  const env = { LLM_USAGE_LOG_PATH: logPath, LLM_BUDGET_ENFORCEMENT: "true", LLM_DAILY_BUDGET_CNY: "0.0015", LLM_MONTHLY_BUDGET_CNY: "20", LLM_MAX_OUTPUT_TOKENS: "100" };
  const input = { feature: "job_analysis" as const, provider: "deepseek", model: "deepseek-flash", messages: [{ content: "anonymous" }] };
  const pair = await Promise.all([reserveUsage(input, env, now), reserveUsage(input, env, now)]);
  assert.equal(pair.filter(item => item.accepted).length, 1);
  const accepted = pair.find(item => item.accepted)!; if (!accepted.accepted) throw new Error("expected accepted");
  await settleUsage(accepted.reservation, { status: "succeeded", durationMs: 1000, completedAt: "2026-10-24T13:00:01Z", usage: extractTokenUsage({ prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 }) }, env);
  assert.equal((await reserveUsage(input, env, new Date("2026-10-24T13:00:02Z"))).accepted, true);
});

test("日志仅采集白名单诊断字段，不把附带的Prompt或错误正文写入元数据", async () => {
  const logPath = await anonymousLogPath(), env = { LLM_USAGE_LOG_PATH: logPath, LLM_BUDGET_ENFORCEMENT: "false" };
  const reserved = await reserveUsage({ feature: "job_analysis", provider: "deepseek", model: "deepseek-flash", messages: [{ content: "private resume text" }], requestOptions: { maxOutputTokens: 100, thinkingMode: "provider_default", reasoningEffort: "not_set", jsonMode: false, prompt: "private prompt" } as any }, env);
  if (!reserved.accepted) throw new Error("expected accepted");
  await settleUsage(reserved.reservation, { status: "failed", durationMs: 10, errorCode: "provider echoed private key", diagnostics: { phase: "upstream_http", httpStatus: 400, providerErrorType: "invalid_request_error", message: "private JD and key", body: "private answer" } as any }, env);
  const raw = await readFile(logPath, "utf8");
  assert.doesNotMatch(raw, /private|prompt|message|body/);
  assert.match(raw, /invalid_request_error/);
});
