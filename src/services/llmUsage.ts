import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { BILLING_TIMEZONE, CALENDAR_VERSION, billingCheckpoints, deepseekPeriod, type BillingPeriod } from "./deepseekCalendar";

export const LLM_FEATURES = [
  "resume_extraction",
  "experience_extraction",
  "experience_question_generation",
  "material_organization",
  "material_summary",
  "job_analysis",
  "interview_question",
  "interview_followup",
  "interview_feedback",
  "answer_comparison",
  "other",
] as const;

export type LlmFeature = typeof LLM_FEATURES[number];
export type UsageStatus = "reserved" | "succeeded" | "failed" | "cancelled" | "timed_out" | "blocked";

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  reasoningTokens?: number | null;
  nonReasoningOutputTokens?: number | null;
};

export type Pricing = {
  inputCnyPerMillion: number;
  cacheHitCnyPerMillion: number;
  outputCnyPerMillion: number;
  basis: string;
  period?: BillingPeriod;
};

export type UsageEvent = {
  version: 1;
  requestId: string;
  timestamp: string;
  startedAt: string;
  status: UsageStatus;
  feature: LlmFeature;
  provider: string;
  model: string;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  estimatedCostCny: number | null;
  reservedCostCny: number | null;
  pricingBasis: string | null;
  errorCode: string | null;
  reasoningTokens?: number | null;
  nonReasoningOutputTokens?: number | null;
  billing?: BillingCalculation;
  budgetPricing?: Pricing | null;
  requestOptions?: RequestAccountingOptions;
  diagnostics?: UsageDiagnostics;
  firstTokenLatencyMs?: number | null;
};

export type UsageReservation = {
  requestId: string;
  startedAt: string;
  feature: LlmFeature;
  provider: string;
  model: string;
  pricing: Pricing | null;
  reservedCostCny: number | null;
  budgetPricing?: Pricing | null;
  requestOptions?: RequestAccountingOptions;
};

type BudgetBlockReason = "daily_budget" | "monthly_budget" | "daily_request_limit" | "pricing_unavailable" | "ledger_unavailable";
export type BudgetReservation = { accepted: true; reservation: UsageReservation } | { accepted: false; requestId: string; reason: BudgetBlockReason };

export type MonitoringConfig = {
  enabled: boolean;
  dailyBudgetCny: number;
  monthlyBudgetCny: number;
  dailyRequestLimit: number;
  maxOutputTokens: number;
  maxRetries: number;
  pricingMode: "auto" | "peak" | "off_peak";
  logPath: string;
};

const DEFAULT_LOG_PATH = ".local-usage/llm-usage.jsonl";
const EMPTY_USAGE: TokenUsage = { inputTokens: null, outputTokens: null, totalTokens: null, cacheHitTokens: null, cacheMissTokens: null, reasoningTokens: null, nonReasoningOutputTokens: null };

export type RequestAccountingOptions = { maxOutputTokens: number; thinkingMode: "enabled" | "disabled" | "provider_default"; reasoningEffort: "low" | "high" | "max" | "not_set"; jsonMode: boolean };
export type UsageDiagnostics = { phase: "unknown" | "pre_request" | "upstream_http" | "response_json" | "response_structure" | "output_truncated" | "content_json" | "network" | "timeout" | "cancelled" | "completed"; httpStatus?: number; providerErrorType?: string; finishReason?: string | null; contentJsonValid?: boolean | null; attempts?: number };
export type BillingCalculation = { timezone: string; calendarVersion: string; startPeriod: BillingPeriod; endPeriod: BillingPeriod; crossesPeriods: boolean; resolution: "single_period" | "cross_period_unknown" | "calendar_unknown" | "manual_override" | "pricing_unavailable" | "time_unknown"; rates: Pricing[]; estimatedCostCny: number | null; minCostCny: number | null; maxCostCny: number | null; cacheSplitKnown: boolean };

function requestMetadata(value: RequestAccountingOptions | undefined): RequestAccountingOptions | undefined {
  if (!value || !Number.isInteger(value.maxOutputTokens) || value.maxOutputTokens < 1 || value.maxOutputTokens > 393216) return undefined;
  return { maxOutputTokens: value.maxOutputTokens, thinkingMode: ["enabled", "disabled"].includes(value.thinkingMode) ? value.thinkingMode : "provider_default", reasoningEffort: ["low", "high", "max"].includes(value.reasoningEffort) ? value.reasoningEffort : "not_set", jsonMode: value.jsonMode === true };
}

function diagnosticMetadata(value: UsageDiagnostics): UsageDiagnostics {
  const phases = ["unknown", "pre_request", "upstream_http", "response_json", "response_structure", "output_truncated", "content_json", "network", "timeout", "cancelled", "completed"];
  const allowedErrors = ["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "insufficient_quota", "server_error", "invalid_api_key", "model_not_found"];
  return { phase: phases.includes(value.phase) ? value.phase : "unknown",
    ...(Number.isInteger(value.httpStatus) && value.httpStatus! >= 100 && value.httpStatus! <= 599 ? { httpStatus: value.httpStatus } : {}),
    ...(allowedErrors.includes(value.providerErrorType ?? "") ? { providerErrorType: value.providerErrorType } : {}),
    finishReason: ["stop", "length", "tool_calls", "content_filter"].includes(value.finishReason ?? "") ? value.finishReason : null,
    contentJsonValid: typeof value.contentJsonValid === "boolean" ? value.contentJsonValid : null,
    ...(safeInteger(value.attempts) !== null ? { attempts: value.attempts } : {}),
  };
}

function safeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function safeText(value: string, fallback: string): string {
  const compact = value.replace(/[\r\n\t]/g, " ").trim().slice(0, 120);
  return compact || fallback;
}

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function loadMonitoringConfig(env: NodeJS.ProcessEnv = process.env): MonitoringConfig {
  const rawPath = env.LLM_USAGE_LOG_PATH?.trim() || DEFAULT_LOG_PATH;
  return {
    enabled: env.LLM_BUDGET_ENFORCEMENT?.trim().toLowerCase() === "true",
    dailyBudgetCny: numberEnv(env, "LLM_DAILY_BUDGET_CNY", 1, 0, 1_000_000),
    monthlyBudgetCny: numberEnv(env, "LLM_MONTHLY_BUDGET_CNY", 20, 0, 10_000_000),
    dailyRequestLimit: Math.floor(numberEnv(env, "LLM_DAILY_REQUEST_LIMIT", 30, 1, 1_000_000)),
    maxOutputTokens: Math.floor(numberEnv(env, "LLM_MAX_OUTPUT_TOKENS", 16_384, 1, 393_216)),
    maxRetries: Math.floor(numberEnv(env, "LLM_MAX_RETRIES", 0, 0, 3)),
    pricingMode: ["peak", "off_peak"].includes(env.LLM_DEEPSEEK_PRICING_MODE?.trim().toLowerCase() ?? "") ? env.LLM_DEEPSEEK_PRICING_MODE!.trim().toLowerCase() as "peak" | "off_peak" : "auto",
    logPath: path.resolve(process.cwd(), rawPath),
  };
}

/** Official direct DeepSeek price table snapshot on 2026-10-22, CNY / 1M tokens. */
export function resolvePricing(provider: string, model: string, config: MonitoringConfig, env: NodeJS.ProcessEnv = process.env, at = new Date()): Pricing | null {
  const customInput = Number(env.LLM_INPUT_CNY_PER_M_TOKEN);
  const customCacheHit = Number(env.LLM_CACHE_HIT_CNY_PER_M_TOKEN);
  const customOutput = Number(env.LLM_OUTPUT_CNY_PER_M_TOKEN);
  if ([env.LLM_INPUT_CNY_PER_M_TOKEN, env.LLM_CACHE_HIT_CNY_PER_M_TOKEN, env.LLM_OUTPUT_CNY_PER_M_TOKEN].every(value => Boolean(value?.trim())) && [customInput, customCacheHit, customOutput].every(value => Number.isFinite(value) && value >= 0)) {
    return { inputCnyPerMillion: customInput, cacheHitCnyPerMillion: customCacheHit, outputCnyPerMillion: customOutput, basis: "environment override", period: "custom" };
  }
  if (provider.trim().toLowerCase() !== "deepseek") return null;
  const period = config.pricingMode === "auto" ? deepseekPeriod(at) : config.pricingMode;
  const offPeak = period === "off_peak";
  const normalizedModel = model.trim().toLowerCase();
  if (normalizedModel === "deepseek-flash" || normalizedModel === "deepseek-v4.1-flash-1017") {
    return { inputCnyPerMillion: offPeak ? 1 : 2, cacheHitCnyPerMillion: offPeak ? 0.02 : 0.04, outputCnyPerMillion: offPeak ? 4 : 8, period, basis: `DeepSeek CNY 2026-10-24; ${period}; ${config.pricingMode === "auto" ? BILLING_TIMEZONE : "manual tariff override"}` };
  }
  if (normalizedModel === "deepseek-v4-pro") {
    return { inputCnyPerMillion: offPeak ? 4.5 : 9, cacheHitCnyPerMillion: offPeak ? 0.15 : 0.3, outputCnyPerMillion: offPeak ? 13.5 : 27, period, basis: `DeepSeek CNY 2026-10-24; ${period}; ${config.pricingMode === "auto" ? BILLING_TIMEZONE : "manual tariff override"}` };
  }
  return null;
}

export function calculateBilling(provider: string, model: string, startedAt: string, completedAt: string, usage: TokenUsage, config = loadMonitoringConfig(), env: NodeJS.ProcessEnv = process.env): BillingCalculation {
  const points = billingCheckpoints(startedAt, completedAt);
  const resolved = (points ?? [new Date(startedAt)]).map(at => resolvePricing(provider, model, config, env, at));
  const rates = [...new Map(resolved.filter((rate): rate is Pricing => Boolean(rate)).map(rate => [rate.period, rate])).values()];
  const unknownCalendar = rates.some(rate => rate.period === "unknown");
  if (unknownCalendar) {
    const low = resolvePricing(provider, model, { ...config, pricingMode: "off_peak" }, env); if (low) rates.push(low);
  }
  const cacheSplitKnown = usage.inputTokens !== null && usage.cacheHitTokens !== null && usage.cacheMissTokens !== null && usage.cacheHitTokens + usage.cacheMissTokens === usage.inputTokens;
  const possibleUsages = cacheSplitKnown || usage.inputTokens === null ? [usage] : [
    { ...usage, cacheHitTokens: 0, cacheMissTokens: usage.inputTokens }, { ...usage, cacheHitTokens: usage.inputTokens, cacheMissTokens: 0 },
  ];
  const costs = rates.flatMap(rate => possibleUsages.map(tokens => estimateCostCny(tokens, rate))).filter((cost): cost is number => cost !== null);
  const minCostCny = costs.length ? Math.min(...costs) : null, maxCostCny = costs.length ? Math.max(...costs) : null;
  const crossesPeriods = new Set(resolved.map(rate => rate?.period ?? "unknown")).size > 1;
  const resolution = !points ? "time_unknown" : resolved.some(rate => !rate) ? "pricing_unavailable" : unknownCalendar ? "calendar_unknown" : config.pricingMode !== "auto" || rates.some(rate => rate.period === "custom") ? "manual_override" : crossesPeriods ? "cross_period_unknown" : "single_period";
  return { timezone: BILLING_TIMEZONE, calendarVersion: CALENDAR_VERSION, startPeriod: resolved[0]?.period ?? "unknown", endPeriod: resolved[1]?.period ?? "unknown", crossesPeriods, resolution, rates,
    estimatedCostCny: points && !unknownCalendar && minCostCny !== null && minCostCny === maxCostCny ? minCostCny : null, minCostCny, maxCostCny, cacheSplitKnown };
}

export function extractTokenUsage(usage: unknown): TokenUsage {
  const value = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const inputTokens = safeInteger(value.prompt_tokens ?? value.input_tokens);
  const outputTokens = safeInteger(value.completion_tokens ?? value.output_tokens);
  const reportedTotal = safeInteger(value.total_tokens);
  const promptDetails = value.prompt_tokens_details && typeof value.prompt_tokens_details === "object" ? value.prompt_tokens_details as Record<string, unknown> : {};
  const reportedCacheHit = safeInteger(promptDetails.cached_tokens ?? value.prompt_cache_hit_tokens);
  const reportedCacheMiss = safeInteger(value.prompt_cache_miss_tokens);
  const cacheHitTokens = reportedCacheHit ?? (inputTokens !== null && reportedCacheMiss !== null && reportedCacheMiss <= inputTokens ? inputTokens - reportedCacheMiss : null);
  const cacheMissTokens = reportedCacheMiss ?? (inputTokens !== null && cacheHitTokens !== null && cacheHitTokens <= inputTokens ? inputTokens - cacheHitTokens : null);
  const outputDetails = value.completion_tokens_details ?? value.output_tokens_details;
  const reportedReasoning = safeInteger(outputDetails && typeof outputDetails === "object" ? (outputDetails as Record<string, unknown>).reasoning_tokens : value.reasoning_tokens);
  const reasoningTokens = reportedReasoning !== null && outputTokens !== null && reportedReasoning <= outputTokens ? reportedReasoning : null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    cacheHitTokens,
    cacheMissTokens,
    reasoningTokens,
    nonReasoningOutputTokens: reasoningTokens !== null && outputTokens !== null ? outputTokens - reasoningTokens : null,
  };
}

export function estimateCostCny(usage: TokenUsage, pricing: Pricing | null): number | null {
  if (!pricing || usage.outputTokens === null) return null;
  const input = usage.inputTokens;
  if (input === null) return null;
  const cacheHit = usage.cacheHitTokens ?? 0;
  const cacheMiss = usage.cacheMissTokens ?? Math.max(0, input - cacheHit);
  if (cacheHit > input || cacheMiss < 0 || cacheHit + cacheMiss !== input) return null;
  return (cacheMiss * pricing.inputCnyPerMillion + cacheHit * pricing.cacheHitCnyPerMillion + usage.outputTokens * pricing.outputCnyPerMillion) / 1_000_000;
}

function conservativePromptReserve(messages: Array<{ content: string }>): number {
  return messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8") + 16, 0);
}

function reserveCost(messages: Array<{ content: string }>, maxOutputTokens: number, pricing: Pricing | null): number | null {
  return estimateCostCny({ ...EMPTY_USAGE, inputTokens: conservativePromptReserve(messages), outputTokens: maxOutputTokens, totalTokens: null }, pricing);
}

async function readEvents(logPath: string): Promise<UsageEvent[]> {
  let text = "";
  try { text = await readFile(logPath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return text.split(/\r?\n/).flatMap(line => {
    if (!line.trim()) return [];
    try {
      const candidate = JSON.parse(line) as Partial<UsageEvent>;
      if (candidate.version !== 1 || typeof candidate.requestId !== "string" || typeof candidate.startedAt !== "string" || typeof candidate.timestamp !== "string" || !LLM_FEATURES.includes(candidate.feature as LlmFeature)) return [];
      return [candidate as UsageEvent];
    } catch { return []; }
  });
}

async function appendEvent(logPath: string, event: UsageEvent): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

let ledgerTail = Promise.resolve();
function withLedgerLock<T>(work: () => Promise<T>): Promise<T> {
  const next = ledgerTail.then(work, work);
  ledgerTail = next.then(() => undefined, () => undefined);
  return next;
}

function latestEvents(events: UsageEvent[]): UsageEvent[] {
  const latest = new Map<string, UsageEvent>();
  for (const event of events) latest.set(event.requestId, event);
  return [...latest.values()];
}

function periodKey(iso: string, month: boolean): string {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const value = (type: string) => values.find(part => part.type === type)?.value || "00";
  return month ? `${value("year")}-${value("month")}` : `${value("year")}-${value("month")}-${value("day")}`;
}

function eventUsage(event: UsageEvent): TokenUsage {
  return { inputTokens: event.inputTokens ?? null, outputTokens: event.outputTokens ?? null, totalTokens: event.totalTokens ?? null, cacheHitTokens: event.cacheHitTokens ?? null, cacheMissTokens: event.cacheMissTokens ?? null, reasoningTokens: event.reasoningTokens ?? null, nonReasoningOutputTokens: event.nonReasoningOutputTokens ?? null };
}

function chargeForBudget(event: UsageEvent, config: MonitoringConfig, env: NodeJS.ProcessEnv): number {
  if (event.pricingBasis === "environment override" && !event.billing) return event.estimatedCostCny ?? event.reservedCostCny ?? 0;
  const bill = calculateBilling(event.provider, event.model, event.startedAt, event.timestamp, eventUsage(event), config, env);
  return bill.maxCostCny ?? event.estimatedCostCny ?? event.reservedCostCny ?? 0;
}

function budgetTotals(events: UsageEvent[], now: string, config: MonitoringConfig, env: NodeJS.ProcessEnv) {
  const day = periodKey(now, false);
  const month = periodKey(now, true);
  const items = latestEvents(events).filter(event => event.status !== "blocked");
  const sum = (subset: UsageEvent[]) => subset.reduce((total, event) => total + chargeForBudget(event, config, env), 0);
  const overlaps = (event: UsageEvent, key: string, monthly: boolean) => periodKey(event.startedAt, monthly) <= key && (event.status === "reserved" || periodKey(event.timestamp, monthly) >= key);
  return {
    dailyCalls: items.filter(event => periodKey(event.startedAt, false) === day).length,
    dailyCost: sum(items.filter(event => overlaps(event, day, false))),
    monthlyCost: sum(items.filter(event => overlaps(event, month, true))),
  };
}

function eventBase(reservation: UsageReservation, status: UsageStatus): UsageEvent {
  return {
    version: 1, requestId: reservation.requestId, timestamp: new Date().toISOString(), startedAt: reservation.startedAt,
    status, feature: reservation.feature, provider: reservation.provider, model: reservation.model,
    durationMs: null, ...EMPTY_USAGE, estimatedCostCny: null, reservedCostCny: null, pricingBasis: reservation.pricing?.basis ?? null, errorCode: null,
    budgetPricing: reservation.budgetPricing ?? null,
    billing: { timezone: BILLING_TIMEZONE, calendarVersion: CALENDAR_VERSION, startPeriod: reservation.pricing?.period ?? "unknown", endPeriod: "unknown", crossesPeriods: false, resolution: reservation.pricing ? reservation.pricing.period === "unknown" ? "calendar_unknown" : "single_period" : "pricing_unavailable", rates: reservation.pricing ? [reservation.pricing] : [], estimatedCostCny: null, minCostCny: null, maxCostCny: null, cacheSplitKnown: false },
    ...(reservation.requestOptions ? { requestOptions: reservation.requestOptions } : {}),
  };
}

export async function reserveUsage(input: { feature: LlmFeature; provider: string; model: string; messages: Array<{ content: string }>; requestOptions?: RequestAccountingOptions }, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<BudgetReservation> {
  const config = loadMonitoringConfig(env);
  const startedAt = now.toISOString();
  const pricing = resolvePricing(input.provider, input.model, config, env, now);
  const budgetPricing = resolvePricing(input.provider, input.model, { ...config, pricingMode: "peak" }, env, now);
  const requestOptions = requestMetadata(input.requestOptions);
  const reservation: UsageReservation = {
    requestId: randomUUID(), startedAt, feature: input.feature, provider: safeText(input.provider, "unknown"), model: safeText(input.model, "unknown"), pricing,
    budgetPricing, ...(requestOptions ? { requestOptions } : {}),
    reservedCostCny: reserveCost(input.messages, requestOptions?.maxOutputTokens ?? config.maxOutputTokens, budgetPricing),
  };
  return withLedgerLock(async () => {
    let events: UsageEvent[];
    try { events = await readEvents(config.logPath); } catch {
      if (config.enabled) return { accepted: false, requestId: reservation.requestId, reason: "ledger_unavailable" };
      return { accepted: true, reservation };
    }
    const block = async (reason: BudgetBlockReason): Promise<BudgetReservation> => {
      const event = eventBase(reservation, "blocked");
      event.errorCode = reason;
      event.diagnostics = { phase: "pre_request" };
      try { await appendEvent(config.logPath, event); } catch { /* A read-only disk cannot record a rejected request. */ }
      return { accepted: false, requestId: reservation.requestId, reason };
    };
    if (config.enabled) {
      if (!pricing || reservation.reservedCostCny === null) return block("pricing_unavailable");
      const totals = budgetTotals(events, startedAt, config, env);
      if (totals.dailyCalls >= config.dailyRequestLimit) return block("daily_request_limit");
      if (totals.dailyCost + reservation.reservedCostCny > config.dailyBudgetCny) return block("daily_budget");
      if (totals.monthlyCost + reservation.reservedCostCny > config.monthlyBudgetCny) return block("monthly_budget");
    }
    const event = eventBase(reservation, "reserved");
    event.reservedCostCny = reservation.reservedCostCny;
    try { await appendEvent(config.logPath, event); } catch {
      if (config.enabled) return { accepted: false, requestId: reservation.requestId, reason: "ledger_unavailable" };
    }
    return { accepted: true, reservation };
  });
}

export async function settleUsage(reservation: UsageReservation, input: { status: Exclude<UsageStatus, "reserved" | "blocked">; durationMs: number; usage?: TokenUsage; errorCode?: string; completedAt?: string; diagnostics?: UsageDiagnostics; firstTokenLatencyMs?: number | null }, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const config = loadMonitoringConfig(env);
  const usage = input.usage ?? EMPTY_USAGE;
  const event = eventBase(reservation, input.status);
  event.timestamp = input.completedAt ?? event.timestamp;
  event.durationMs = Math.max(0, Math.floor(input.durationMs));
  event.firstTokenLatencyMs = safeInteger(input.firstTokenLatencyMs);
  Object.assign(event, usage);
  event.billing = calculateBilling(reservation.provider, reservation.model, reservation.startedAt, event.timestamp, usage, config, env);
  event.estimatedCostCny = event.billing.estimatedCostCny;
  event.pricingBasis = event.billing.rates.map(rate => rate.basis).join("; ") || null;
  event.reservedCostCny = event.estimatedCostCny === null ? event.billing.maxCostCny ?? reservation.reservedCostCny : null;
  event.errorCode = input.errorCode ? (/^upstream_http_\d{3}$/.test(input.errorCode) || ["timeout", "client_cancelled", "connection_error", "invalid_response", "invalid_response_json", "stream_missing_body"].includes(input.errorCode) ? input.errorCode : "unknown_error") : null;
  if (input.diagnostics) event.diagnostics = diagnosticMetadata(input.diagnostics);
  return withLedgerLock(async () => {
    try { await appendEvent(config.logPath, event); return true; } catch { return false; }
  });
}

export type UsageReport = {
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheKnownRequests: number;
  cacheUnknownRequests: number;
  componentCostKnownRequests: number;
  cacheHitCostCny: number;
  cacheMissCostCny: number;
  outputCostCny: number;
  allMissBaselineCostCny: number;
  estimatedCacheSavingsCny: number;
  firstTokenKnownRequests: number;
  averageFirstTokenLatencyMs: number | null;
  requests: number;
  blocked: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  timedOut: number;
  knownTokenRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  knownCostCny: number;
  reservedUnknownCostCny: number;
  unpricedRequests: number;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  cacheHitRate: number | null;
  byFeature: Record<string, UsageReport>;
  recordedKnownCostCny: number;
  unknownUsageRequests: number;
  pendingRequests: number;
  inFlightReservedCostCny: number;
  unsettledReservedCostCny: number;
  reasoningKnownRequests: number;
  reasoningTokens: number;
  nonReasoningOutputTokens: number;
  reasoningTokenRatio: number | null;
  reasoningMeasuredOutputTokens: number;
  failureRate: number | null;
  truncatedRequests: number;
  invalidContentJsonRequests: number;
  finishReasonKnownRequests: number;
  contentJsonKnownRequests: number;
  recalculatedRequests: number;
  ambiguousCostRequests: number;
  ambiguousCostMinCny: number;
  ambiguousCostMaxCny: number;
  costByPeriod: Record<BillingPeriod, number>;
  failures: Array<{ requestId: string; feature: LlmFeature; startedAt: string; status: UsageStatus; phase: UsageDiagnostics["phase"] | "unknown"; httpStatus: number | null; errorCode: string | null; providerErrorType: string | null; finishReason: string | null }>;
  details: Array<UsageEvent & { recordedEstimatedCostCny: number | null; recalculated: boolean }>;
};

function emptyReport(): UsageReport {
  return { requests: 0, blocked: 0, succeeded: 0, failed: 0, cancelled: 0, timedOut: 0, knownTokenRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, knownCostCny: 0, reservedUnknownCostCny: 0, unpricedRequests: 0, averageDurationMs: null, p95DurationMs: null, cacheHitRate: null, byFeature: {},
    recordedKnownCostCny: 0, unknownUsageRequests: 0, pendingRequests: 0, inFlightReservedCostCny: 0, unsettledReservedCostCny: 0, reasoningKnownRequests: 0, reasoningTokens: 0, nonReasoningOutputTokens: 0, reasoningMeasuredOutputTokens: 0, reasoningTokenRatio: null, failureRate: null, truncatedRequests: 0, invalidContentJsonRequests: 0, finishReasonKnownRequests: 0, contentJsonKnownRequests: 0, recalculatedRequests: 0, ambiguousCostRequests: 0,
    ambiguousCostMinCny: 0, ambiguousCostMaxCny: 0, costByPeriod: { peak: 0, off_peak: 0, custom: 0, unknown: 0 }, failures: [], details: [],
    cacheHitTokens: 0, cacheMissTokens: 0, cacheKnownRequests: 0, cacheUnknownRequests: 0, componentCostKnownRequests: 0, cacheHitCostCny: 0, cacheMissCostCny: 0, outputCostCny: 0, allMissBaselineCostCny: 0, estimatedCacheSavingsCny: 0, firstTokenKnownRequests: 0, averageFirstTokenLatencyMs: null };
}

function inferredDiagnostics(event: UsageEvent): UsageDiagnostics {
  if (event.diagnostics) return event.diagnostics;
  const status = event.errorCode?.match(/^upstream_http_(\d{3})$/);
  if (status) return { phase: "upstream_http" as const, httpStatus: Number(status[1]) };
  if (event.status === "timed_out") return { phase: "timeout" as const };
  if (event.status === "cancelled") return { phase: "cancelled" as const };
  if (event.errorCode === "connection_error") return { phase: "network" as const };
  return { phase: "unknown" as const };
}

type ReportEvent = UsageReport["details"][number];
function reportEvent(event: UsageEvent, config: MonitoringConfig, env: NodeJS.ProcessEnv, recalculate: boolean): ReportEvent {
  const original = { ...event, recordedEstimatedCostCny: event.estimatedCostCny ?? null, recalculated: false };
  // An old manual price without its rates cannot be reconstructed from today's environment.
  if (!recalculate || event.status === "reserved" || event.status === "blocked" || event.pricingBasis === "environment override" && !event.billing) return original;
  const billing = calculateBilling(event.provider, event.model, event.startedAt, event.timestamp, eventUsage(event), config, env);
  if (!billing.rates.length) return original;
  return { ...original, billing, estimatedCostCny: billing.estimatedCostCny, recalculated: event.inputTokens !== null && event.outputTokens !== null,
    reservedCostCny: billing.estimatedCostCny === null ? event.reservedCostCny ?? billing.maxCostCny : null };
}

function addToReport(report: UsageReport, event: ReportEvent) {
  report.details.push(event);
  if (event.status === "blocked") { report.blocked += 1; return; }
  report.requests += 1;
  if (event.status === "succeeded") report.succeeded += 1;
  if (event.status === "failed") report.failed += 1;
  if (event.status === "cancelled") report.cancelled += 1;
  if (event.status === "timed_out") report.timedOut += 1;
  if ([event.inputTokens, event.outputTokens, event.totalTokens].every(value => safeInteger(value) !== null)) report.knownTokenRequests += 1;
  else report.unknownUsageRequests += 1;
  if (event.status === "reserved") report.pendingRequests += 1;
  report.inputTokens += event.inputTokens ?? 0;
  report.outputTokens += event.outputTokens ?? 0;
  report.totalTokens += event.totalTokens ?? 0;
  if (event.estimatedCostCny !== null) report.knownCostCny += event.estimatedCostCny;
  else if (event.reservedCostCny !== null) report.reservedUnknownCostCny += event.reservedCostCny;
  else report.unpricedRequests += 1;
  report.recordedKnownCostCny += event.recordedEstimatedCostCny ?? 0;
  if (event.reservedCostCny != null) {
    if (event.status === "reserved") report.inFlightReservedCostCny += event.reservedCostCny;
    else report.unsettledReservedCostCny += event.reservedCostCny;
  }
  if (event.reasoningTokens != null && event.nonReasoningOutputTokens != null && event.outputTokens !== null) {
    report.reasoningKnownRequests += 1; report.reasoningTokens += event.reasoningTokens;
    report.nonReasoningOutputTokens += event.nonReasoningOutputTokens; report.reasoningMeasuredOutputTokens += event.outputTokens;
  }
  if (event.recalculated) report.recalculatedRequests += 1;
  if (event.estimatedCostCny !== null) report.costByPeriod[event.billing?.startPeriod ?? "unknown"] += event.estimatedCostCny;
  else if (event.billing?.maxCostCny != null) { report.ambiguousCostRequests += 1; report.ambiguousCostMinCny += event.billing.minCostCny ?? 0; report.ambiguousCostMaxCny += event.billing.maxCostCny; }
  const diagnostics = inferredDiagnostics(event);
  if (diagnostics.finishReason != null) report.finishReasonKnownRequests += 1;
  if (diagnostics.contentJsonValid != null) report.contentJsonKnownRequests += 1;
  if (diagnostics.finishReason === "length") report.truncatedRequests += 1;
  if ("contentJsonValid" in diagnostics && diagnostics.contentJsonValid === false) report.invalidContentJsonRequests += 1;
  if (["failed", "cancelled", "timed_out"].includes(event.status) || diagnostics.finishReason === "length" || "contentJsonValid" in diagnostics && diagnostics.contentJsonValid === false) report.failures.push({ requestId: event.requestId, feature: event.feature, startedAt: event.startedAt, status: event.status,
    phase: diagnostics.phase, httpStatus: diagnostics.httpStatus ?? null, errorCode: event.errorCode, providerErrorType: "providerErrorType" in diagnostics ? diagnostics.providerErrorType ?? null : null, finishReason: diagnostics.finishReason ?? null });
}

function completeReport(report: UsageReport, events: UsageEvent[]) {
  const actual = events.filter(event => event.status !== "blocked");
  const knownCache = actual.filter(event => [event.inputTokens, event.cacheHitTokens, event.cacheMissTokens].every(value => safeInteger(value) !== null) && event.cacheHitTokens! + event.cacheMissTokens! === event.inputTokens);
  report.cacheKnownRequests = knownCache.length;
  report.cacheUnknownRequests = actual.length - knownCache.length;
  report.cacheHitTokens = knownCache.reduce((sum, event) => sum + event.cacheHitTokens!, 0);
  report.cacheMissTokens = knownCache.reduce((sum, event) => sum + event.cacheMissTokens!, 0);
  for (const event of knownCache) {
    if (event.estimatedCostCny === null || event.outputTokens === null || !event.billing || event.billing.rates.length !== 1 || ["unknown"].includes(event.billing.startPeriod)) continue;
    const rate = event.billing.rates[0];
    report.componentCostKnownRequests += 1;
    report.cacheHitCostCny += event.cacheHitTokens! * rate.cacheHitCnyPerMillion / 1e6;
    report.cacheMissCostCny += event.cacheMissTokens! * rate.inputCnyPerMillion / 1e6;
    report.outputCostCny += event.outputTokens * rate.outputCnyPerMillion / 1e6;
    report.allMissBaselineCostCny += (event.inputTokens! * rate.inputCnyPerMillion + event.outputTokens * rate.outputCnyPerMillion) / 1e6;
    report.estimatedCacheSavingsCny += event.cacheHitTokens! * (rate.inputCnyPerMillion - rate.cacheHitCnyPerMillion) / 1e6;
  }
  const firstTokens = actual.map(event => event.firstTokenLatencyMs).filter((time): time is number => safeInteger(time) !== null);
  report.firstTokenKnownRequests = firstTokens.length;
  report.averageFirstTokenLatencyMs = firstTokens.length ? firstTokens.reduce((sum, time) => sum + time, 0) / firstTokens.length : null;
  const completed = report.requests - report.pendingRequests;
  report.failureRate = completed ? (report.failed + report.cancelled + report.timedOut) / completed : null;
  report.reasoningTokenRatio = report.reasoningMeasuredOutputTokens ? report.reasoningTokens / report.reasoningMeasuredOutputTokens : report.reasoningKnownRequests ? 0 : null;
  const durations = events.filter(event => event.status !== "blocked" && event.durationMs !== null).map(event => event.durationMs as number).sort((a, b) => a - b);
  if (durations.length) {
    report.averageDurationMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
    report.p95DurationMs = durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)];
  }
  const cacheEvents = knownCache;
  const cacheHit = cacheEvents.reduce((sum, event) => sum + (event.cacheHitTokens ?? 0), 0);
  const cacheMiss = cacheEvents.reduce((sum, event) => sum + (event.cacheMissTokens ?? 0), 0);
  if (cacheHit + cacheMiss > 0) report.cacheHitRate = cacheHit / (cacheHit + cacheMiss);
}

export async function createUsageReport(logPath = loadMonitoringConfig().logPath, now = new Date().toISOString(), options: { recalculate?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const env = options.env ?? process.env, config = loadMonitoringConfig(env);
  const events = latestEvents(await readEvents(logPath)).map(event => reportEvent(event, config, env, options.recalculate !== false));
  const ranges: Record<string, ReportEvent[]> = {
    today: events.filter(event => periodKey(event.startedAt, false) === periodKey(now, false)),
    month: events.filter(event => periodKey(event.startedAt, true) === periodKey(now, true)),
    all: events,
  };
  return Object.fromEntries(Object.entries(ranges).map(([name, range]) => {
    const report = emptyReport();
    for (const event of range) {
      addToReport(report, event);
      const feature = report.byFeature[event.feature] ?? (report.byFeature[event.feature] = emptyReport());
      addToReport(feature, event);
    }
    completeReport(report, range);
    for (const feature of Object.values(report.byFeature)) completeReport(feature, range.filter(event => report.byFeature[event.feature] === feature));
    return [name, report];
  }));
}

/** Parses final DeepSeek-compatible SSE usage without summing prior chunks. */
export class SseUsageCollector {
  private buffer = "";
  private latest: TokenUsage | null = null;
  private finish: string | null = null;
  private firstToken: number | null = null;

  push(chunk: string, elapsedMs?: number): void {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    while (true) {
      const separator = this.buffer.indexOf("\n\n");
      if (separator < 0) return;
      const frame = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data) as { usage?: unknown; choices?: Array<{ finish_reason?: unknown; delta?: { content?: unknown; reasoning_content?: unknown } }> };
        const delta = payload.choices?.[0]?.delta;
        if (this.firstToken === null && safeInteger(elapsedMs) !== null && [delta?.content, delta?.reasoning_content].some(value => typeof value === "string" && value.length > 0)) this.firstToken = elapsedMs!;
        const reason = payload.choices?.[0]?.finish_reason;
        if (typeof reason === "string" && ["stop", "length", "tool_calls", "content_filter"].includes(reason)) this.finish = reason;
        if (payload.usage) this.latest = extractTokenUsage(payload.usage);
      } catch { /* Incomplete or non-JSON event: leave token accounting unchanged. */ }
    }
  }

  usage(): TokenUsage | null { return this.latest; }
  finishReason(): string | null { return this.finish; }
  firstTokenLatencyMs(): number | null { return this.firstToken; }
  flush(elapsedMs?: number): void { this.push("\n\n", elapsedMs); }
}
