import "dotenv/config";
import { createUsageReport, loadMonitoringConfig, type UsageReport } from "../src/services/llmUsage";

function cny(value: number) { return `¥${value.toFixed(6)}`; }
function ms(value: number | null) { return value === null ? "未知" : `${Math.round(value)}ms`; }
function percent(value: number | null) { return value === null ? "未知" : `${(value * 100).toFixed(1)}%`; }

function cacheMetrics(report: UsageReport, indent = "") {
  console.log(`${indent}缓存已知样本：命中 ${report.cacheKnownRequests ? report.cacheHitTokens : "未知"} / 未命中 ${report.cacheKnownRequests ? report.cacheMissTokens : "未知"} Token；已知命中率 ${percent(report.cacheHitRate)}（明细覆盖${report.cacheKnownRequests}/${report.requests}，未知${report.cacheUnknownRequests}请求）`);
  console.log(`${indent}可拆分计费样本${report.componentCostKnownRequests}：命中输入 ${report.componentCostKnownRequests ? cny(report.cacheHitCostCny) : "未知"} / 未命中输入 ${report.componentCostKnownRequests ? cny(report.cacheMissCostCny) : "未知"} / 输出 ${report.componentCostKnownRequests ? cny(report.outputCostCny) : "未知"}；同样本全未命中基线 ${report.componentCostKnownRequests ? cny(report.allMissBaselineCostCny) : "未知"}，估算节省 ${report.componentCostKnownRequests ? cny(report.estimatedCacheSavingsCny) : "未知"}`);
  console.log(`${indent}首片段平均延迟 ${ms(report.averageFirstTokenLatencyMs)}（流式文本/思考片段，覆盖${report.firstTokenKnownRequests}/${report.requests}；非流式未知）`);
}

function printScope(label: string, report: UsageReport) {
  console.log(`\n${label}`);
  console.log(`请求 ${report.requests}（代理成功 ${report.succeeded} / 失败 ${report.failed} / 取消 ${report.cancelled} / 超时 ${report.timedOut} / 等待结算 ${report.pendingRequests} / 预算拦截 ${report.blocked}）；失败率 ${percent(report.failureRate)}`);
  console.log(`已返回usage：输入 ${report.inputTokens} / 输出 ${report.outputTokens} / 总计 ${report.totalTokens} Token（完整用量 ${report.knownTokenRequests}，用量未知 ${report.unknownUsageRequests}）`);
  console.log(`真实usage费用估算 ${cny(report.knownCostCny)}；日志原记估算 ${cny(report.recordedKnownCostCny)}；只读复算 ${report.recalculatedRequests} 条`);
  console.log(`未结算/未释放预算预留 ${cny(report.reservedUnknownCostCny)}（在途 ${cny(report.inFlightReservedCostCny)}，结束后仍待核对 ${cny(report.unsettledReservedCostCny)}）；预留不是实际花费`);
  console.log(`时段费用：高峰 ${cny(report.costByPeriod.peak)} / 空闲 ${cny(report.costByPeriod.off_peak)} / 自定义 ${cny(report.costByPeriod.custom)} / 依据未知 ${cny(report.costByPeriod.unknown)}`);
  if (report.ambiguousCostRequests) console.log(`另有 ${report.ambiguousCostRequests} 条费用仅可给范围 ${cny(report.ambiguousCostMinCny)}–${cny(report.ambiguousCostMaxCny)}（跨时段/日历或缓存拆分不足，未伪造Token分摊；未纳入上方点估算）`);
  console.log(`思考Token ${report.reasoningKnownRequests ? report.reasoningTokens : "未知"} / 其他输出 ${report.reasoningKnownRequests ? report.nonReasoningOutputTokens : "未知"}；已返回明细样本思考占比 ${percent(report.reasoningTokenRatio)}（覆盖 ${report.reasoningKnownRequests}/${report.requests} 请求）`);
  console.log(`已记录截断 ${report.truncatedRequests}（结束原因覆盖${report.finishReasonKnownRequests}/${report.requests}）/ 非JSON ${report.invalidContentJsonRequests}（内容检查覆盖${report.contentJsonKnownRequests}/${report.requests}）；缺失不代表没有异常；代理成功不代表业务校验成功；无定价记录 ${report.unpricedRequests}`);
  console.log(`耗时 平均 ${ms(report.averageDurationMs)} / P95 ${ms(report.p95DurationMs)}；缓存命中率 ${percent(report.cacheHitRate)}`);
  cacheMetrics(report);
  const entries = Object.entries(report.byFeature).filter(([, item]) => item.requests || item.blocked);
  if (!entries.length) { console.log("按功能：暂无记录"); return; }
  console.log("按功能：");
  for (const [feature, item] of entries) { console.log(`  ${feature}: ${item.requests} 请求；已返回usage输入/输出 ${item.knownTokenRequests ? `${item.inputTokens}/${item.outputTokens}` : "未知/未知"}（用量未知${item.unknownUsageRequests}）;平均 ${item.knownTokenRequests ? Math.round(item.totalTokens / item.knownTokenRequests) : "未知"} Token/已返回usage请求；${!item.knownTokenRequests && item.unknownUsageRequests ? "费用未知" : cny(item.knownCostCny) + " 已知部分估算"}；平均/P95 ${ms(item.averageDurationMs)}/${ms(item.p95DurationMs)}；失败 ${item.failed + item.cancelled + item.timedOut} (${percent(item.failureRate)})；思考 ${item.reasoningKnownRequests ? item.reasoningTokens : "未知"} (${percent(item.reasoningTokenRatio)}，明细覆盖${item.reasoningKnownRequests}/${item.requests})`); cacheMetrics(item, "    "); }
}

const config = loadMonitoringConfig();
const flags = process.argv.slice(2);
const report = await createUsageReport(config.logPath, new Date().toISOString(), { recalculate: !flags.includes("--recorded") });
if (flags.includes("--json")) { console.log(JSON.stringify(report, null, 2)); }
else {
console.log("AI 面试通本地模型用量报告");
console.log(`日志：${config.logPath}`);
console.log(`预算保护：${config.enabled ? "已开启（全局本机）" : "关闭"}；默认不会代表单用户额度。`);
console.log(`计价：${config.pricingMode}；${flags.includes("--recorded") ? "显示日志原记金额" : "按当前费率快照只读复算历史，不修改日志"}；金额是估算，不是DeepSeek账单。`);
console.log("按请求开始时间归属今日/本月；跨时段Token分布和客户端业务校验结果未被旧日志记录，无法追溯。思考缺失显示未知，不从输出长度估算。");
printScope("今日（Asia/Shanghai）", report.today);
printScope("本月（Asia/Shanghai）", report.month);
printScope("累计", report.all);
if (report.all.failures.length) {
  console.log("\n失败/异常明细（仅监控元数据；旧记录缺失的错误正文无法恢复）：");
  for (const item of report.all.failures) console.log(`  ${item.requestId} ${item.feature} ${item.status} 阶段=${item.phase} HTTP=${item.httpStatus ?? "未知"} 原因=${item.errorCode ?? "未知"} 上游类型=${item.providerErrorType ?? "未知"} 结束=${item.finishReason ?? "未知"}`);
}
if (flags.includes("--details")) console.log("\n逐请求元数据（含原记/复算费用、费率、时段、请求参数及已返回思考明细）：\n" + JSON.stringify(report.all.details, null, 2));
}
