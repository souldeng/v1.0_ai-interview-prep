import cors from "cors";
import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { LLM_FEATURES, SseUsageCollector, calculateBilling, extractTokenUsage, loadMonitoringConfig, reserveUsage, settleUsage, type LlmFeature, type TokenUsage, type UsageDiagnostics, type RequestAccountingOptions } from "./src/services/llmUsage";

type ChatRequest = { messages?: Array<{ role: string; content: string }>; task?: "coach" | "interviewer"; feature?: LlmFeature; stream?: boolean };
type ModelConfig = { provider: string; apiKey: string; baseUrl: string; model: string };

function firstEnv(...names: string[]) {
  return names.map(name => process.env[name]?.trim()).find(Boolean);
}

function modelConfig(): ModelConfig | null {
  const apiKey = firstEnv("MODEL_API_KEY", "OPENAI_COMPATIBLE_API_KEY", "DEEPSEEK_API_KEY");
  const baseUrl = firstEnv("MODEL_BASE_URL", "OPENAI_COMPATIBLE_BASE_URL", "DEEPSEEK_BASE_URL");
  const model = firstEnv("MODEL_NAME", "OPENAI_COMPATIBLE_MODEL", "DEEPSEEK_MODEL");
  const provider = firstEnv("MODEL_PROVIDER", "LLM_PROVIDER") || "自定义兼容服务";
  return apiKey && baseUrl && model ? { provider, apiKey, baseUrl: baseUrl.replace(/\/$/, ""), model } : null;
}

function modelTimeouts() {
  const bounded = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 1000 && value <= 300_000 ? value : fallback;
  };
  return { coach: bounded("MODEL_COACH_TIMEOUT_MS", 150_000), interviewer: bounded("MODEL_INTERVIEW_TIMEOUT_MS", 60_000) };
}

function featureOf(value: unknown): LlmFeature {
  return LLM_FEATURES.includes(value as LlmFeature) ? value as LlmFeature : "other";
}

function budgetMessage(reason: string): string {
  if (reason === "daily_budget") return "今日 AI 预算已达到上限，原内容已保留，请明日再试或由本机管理员调整预算。";
  if (reason === "monthly_budget") return "本月 AI 预算已达到上限，原内容已保留，请下月再试或由本机管理员调整预算。";
  if (reason === "daily_request_limit") return "今日 AI 调用次数已达到上限，原内容已保留，请明日再试。";
  if (reason === "pricing_unavailable") return "当前模型缺少可核验的本地费率，已启用预算保护时不会发起请求。请配置费率或暂时关闭预算保护。";
  return "本地用量日志不可用，已启用预算保护时不会发起请求。请检查磁盘和日志目录。";
}

async function fetchWithBoundedRetries(url: string, init: RequestInit, controller: AbortController, maxRetries: number, onAttempt: () => void): Promise<Response> {
  let retry = 0;
  while (true) {
    try { onAttempt(); return await fetch(url, init); }
    catch (error) {
      if (controller.signal.aborted || retry >= maxRetries || !(error instanceof TypeError)) throw error;
      retry += 1;
      await new Promise(resolve => setTimeout(resolve, 150 * retry));
    }
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Credentials stay on the server. This route never accepts an API key from a browser request.
  app.get("/api/health", (_req, res) => {
    const config = modelConfig();
    const monitoring = loadMonitoringConfig();
    return res.json({ status: "ok", modelConfigured: Boolean(config), provider: config?.provider ?? null, model: config?.model ?? null, timeouts: modelTimeouts(), monitoring: { budgetEnforced: monitoring.enabled, dailyBudgetCny: monitoring.dailyBudgetCny, monthlyBudgetCny: monitoring.monthlyBudgetCny, dailyRequestLimit: monitoring.dailyRequestLimit, maxOutputTokens: monitoring.maxOutputTokens, maxRetries: monitoring.maxRetries } });
  });
  app.post("/api/model/chat", async (req, res) => {
    const config = modelConfig();
    const body = req.body as ChatRequest;
    if (!config) return res.status(503).json({ error: "服务端模型尚未配置。请在 .env 设置 MODEL_*，或使用 DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL 与 LLM_PROVIDER。" });
    if (!Array.isArray(body.messages) || body.messages.length === 0) return res.status(400).json({ error: "messages 必须为非空数组。" });
    if (!body.messages.every(message => message && typeof message.role === "string" && typeof message.content === "string")) return res.status(400).json({ error: "messages 必须包含文本 role 和 content。" });
    const feature = featureOf(body.feature);
    const monitoring = loadMonitoringConfig();
    const experienceQuestions = feature === "experience_question_generation";
    const deepseekQuestions = experienceQuestions && config.provider.toLowerCase() === "deepseek" && config.model === "deepseek-flash";
    const materialTask = feature === "material_organization" || feature === "material_summary";
    const deepseekMaterial = materialTask && config.provider.toLowerCase() === "deepseek" && config.model === "deepseek-flash";
    const upstreamRequest = { model: config.model, messages: body.messages, temperature: 0.2,
      max_tokens: experienceQuestions ? Math.min(monitoring.maxOutputTokens, 2048) : materialTask ? Math.min(monitoring.maxOutputTokens, 6144) : monitoring.maxOutputTokens,
      ...(deepseekQuestions || deepseekMaterial ? { thinking: { type: "disabled" }, response_format: { type: "json_object" } } : {}),
      ...(body.stream ? { stream: true, stream_options: { include_usage: true } } : {}) };
    const requestOptions: RequestAccountingOptions = { maxOutputTokens: upstreamRequest.max_tokens, thinkingMode: deepseekQuestions || deepseekMaterial ? "disabled" : "provider_default", reasoningEffort: "not_set", jsonMode: deepseekQuestions || deepseekMaterial };
    const reserved = await reserveUsage({ feature, provider: config.provider, model: config.model, messages: body.messages, requestOptions });
    if (reserved.accepted === false) return res.status(429).json({ error: budgetMessage(reserved.reason), code: "llm_budget_blocked", reason: reserved.reason, requestId: reserved.requestId });
    const controller = new AbortController();
    let timedOut = false;
    const limits = modelTimeouts();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, body.task === "interviewer" ? limits.interviewer : limits.coach);
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnected);
    req.on("aborted", disconnected);
    const startedAt = Date.now();
    let settled = false;
    let observedUsage: TokenUsage | undefined;
    let firstTokenLatencyMs: number | null = null;
    const diagnostics: UsageDiagnostics = { phase: "network", attempts: 0, finishReason: null, contentJsonValid: null };
    const settle = async (status: "succeeded" | "failed" | "cancelled" | "timed_out", usage?: TokenUsage, errorCode?: string, completedAt = new Date().toISOString()) => {
      if (settled) return true;
      settled = true;
      if (status === "timed_out") diagnostics.phase = "timeout";
      if (status === "cancelled") diagnostics.phase = "cancelled";
      const saved = await settleUsage(reserved.reservation, { status, usage: usage ?? observedUsage, errorCode, durationMs: Date.now() - startedAt, completedAt, diagnostics, firstTokenLatencyMs });
      if (!saved) console.warn("[llm-usage] metadata could not be persisted", { requestId: reserved.reservation.requestId, status });
      return saved;
    };
    try {
      const response = await fetchWithBoundedRetries(`${config.baseUrl}/chat/completions`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(upstreamRequest) }, controller, monitoring.maxRetries, () => { diagnostics.attempts = (diagnostics.attempts ?? 0) + 1; });
      diagnostics.httpStatus = response.status;
      if (body.stream && response.ok) {
        if (!response.body) {
          diagnostics.phase = "response_structure";
          await settle("failed", undefined, "stream_missing_body");
          return res.status(502).json({ error: "模型流式响应无正文。" });
        }
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const collector = new SseUsageCollector();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          collector.push(chunk, Date.now() - startedAt);
          firstTokenLatencyMs = collector.firstTokenLatencyMs();
          observedUsage = collector.usage() ?? undefined; diagnostics.finishReason = collector.finishReason();
          if (!res.destroyed) res.write(chunk);
        }
        const trailing = decoder.decode();
        if (trailing) { collector.push(trailing, Date.now() - startedAt); firstTokenLatencyMs = collector.firstTokenLatencyMs(); if (!res.destroyed) res.write(trailing); }
        collector.flush(Date.now() - startedAt);
        firstTokenLatencyMs = collector.firstTokenLatencyMs();
        observedUsage = collector.usage() ?? undefined; diagnostics.finishReason = collector.finishReason();
        if (controller.signal.aborted || res.destroyed) { await settle(timedOut ? "timed_out" : "cancelled", collector.usage() ?? undefined, timedOut ? "timeout" : "client_cancelled"); return; }
        diagnostics.phase = diagnostics.finishReason === "length" ? "output_truncated" : "completed";
        await settle("succeeded", collector.usage() ?? undefined);
        return res.end();
      }
      let invalidEnvelope = false;
      const data = await response.json().catch(() => { invalidEnvelope = true; return null; });
      const usage = extractTokenUsage(data?.usage);
      observedUsage = usage;
      if (controller.signal.aborted || res.destroyed) { await settle(timedOut ? "timed_out" : "cancelled", usage, timedOut ? "timeout" : "client_cancelled"); return; }
      if (!response.ok) {
        diagnostics.phase = "upstream_http";
        const errorType = data?.error?.type ?? data?.error?.code;
        if (["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "insufficient_quota", "server_error", "invalid_api_key", "model_not_found"].includes(errorType)) diagnostics.providerErrorType = errorType;
        await settle("failed", usage, `upstream_http_${response.status}`); return res.status(response.status).json({ error: `上游模型服务调用失败（${response.status}），请检查服务配置或稍后主动重试。` });
      }
      if (invalidEnvelope) { diagnostics.phase = "response_json"; await settle("failed", usage, "invalid_response_json"); return res.status(502).json({ error: "模型服务返回格式无效" }); }
      const content = data?.choices?.[0]?.message?.content;
      diagnostics.finishReason = ["stop", "length", "tool_calls", "content_filter"].includes(data?.choices?.[0]?.finish_reason) ? data.choices[0].finish_reason : null;
      const metrics = {
        durationMs: Date.now() - startedAt,
        requestId: reserved.reservation.requestId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cacheHitTokens: usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens,
        estimatedCostCny: null as number | null,
        reasoningTokens: usage.reasoningTokens ?? null,
        nonReasoningOutputTokens: usage.nonReasoningOutputTokens ?? null,
        finishReason: diagnostics.finishReason,
      };
      if (typeof content !== "string") { diagnostics.phase = "response_structure"; await settle("failed", usage, "invalid_response"); return res.status(502).json({ error: "模型服务返回格式无效" }); }
      try { JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()); diagnostics.contentJsonValid = true; }
      catch { diagnostics.contentJsonValid = false; }
      diagnostics.phase = diagnostics.finishReason === "length" ? "output_truncated" : diagnostics.contentJsonValid ? "completed" : "content_json";
      const completedAt = new Date().toISOString();
      metrics.estimatedCostCny = calculateBilling(config.provider, config.model, reserved.reservation.startedAt, completedAt, usage, monitoring).estimatedCostCny;
      const monitoringSaved = await settle("succeeded", usage, undefined, completedAt);
      return res.json({ content, metrics: { ...metrics, monitoringSaved } });
    } catch {
      const status = timedOut ? "timed_out" : controller.signal.aborted ? "cancelled" : "failed";
      await settle(status, undefined, timedOut ? "timeout" : controller.signal.aborted ? "client_cancelled" : "connection_error");
      if (!res.destroyed) return res.status(timedOut ? 504 : 502).json({ error: timedOut ? "模型服务等待超时，原回答保留，可主动重试。" : "无法连接到配置的模型服务" });
    }
    finally { clearTimeout(timeout); res.off("close", disconnected); req.off("aborted", disconnected); }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(port, "0.0.0.0", () => console.log(`Server running on http://localhost:${port}`));
  return app;
}

export const appPromise = startServer();
export default appPromise;
