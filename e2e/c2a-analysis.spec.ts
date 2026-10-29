import { expect, test, type Page } from "@playwright/test";
import { openDetails } from "./uiActions";
import { createPreparation } from "../src/lib/interview";
import { createInterviewProject } from "../src/lib/projects";
import { emptyUserProfile, PROFILE_KEY } from "../src/lib/profileStorage";

const now = "2026-10-14T00:00:00.000Z";
const row = { requirement: "匿名JD要求：客户需求分析", status: "direct", evidenceQuote: "我负责需求访谈", reason: "确认经历中有访谈依据", studyTopic: "验收方法", practiceQuestion: "如何核对客户需求？" };
function fixture(id = "anonymous-analysis-A") {
  const input = { company: "匿名企业", jobTitle: id, jobDescription: "负责客户需求分析和 AI 应用方案。", candidateBackground: "旧个人背景，不应进入确认事实区。", concerns: "" };
  return { ...createInterviewProject(input, createPreparation(input.candidateBackground, input.jobDescription)), id };
}
function profile() {
  const value = emptyUserProfile(new Date(now));
  value.experiences = [{ id: "anonymous-confirmed-card", title: "本人需求访谈", situation: "需求整理", action: "我负责需求访谈", result: "形成需求清单", reflection: "没有负责研发", confirmed: true, createdAt: now, updatedAt: now }];
  return value;
}
async function seed(page: Page, items = [fixture()]) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名 Mock" } }));
  await page.addInitScript(({ jobs, user, key }) => {
    if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify(jobs));
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(user));
  }, { jobs: items, user: profile(), key: PROFILE_KEY });
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).first().click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
}
async function primary(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
}

test("AI 分析成功后切换模块和刷新仍可查看，依据详情默认收起", async ({ page }, info) => {
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ requirements: [row] }) } }));
  await seed(page);
  await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).first().click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await expect(page.getByText("生成时使用的资料", { exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath("analysis-saved.png"), fullPage: true });
});

test("离开分析页后保存失败仍明确指出原岗位，不能静默丢失错误提示", async ({ page }) => {
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/api/model/chat", async route => { requested = true; await ready; await route.fulfill({ json: { content: JSON.stringify({ requirements: [row] }) } }); });
  await seed(page, [fixture(), fixture("anonymous-analysis-B")]);
  await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click(); await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "anonymous-analysis-B", exact: true }) }).getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-projects-v1") throw new DOMException("匿名离页容量不足", "QuotaExceededError"); original.call(this, key, value); }; });
  release();
  await expect(page.getByRole("alert").filter({ hasText: "anonymous-analysis-A" })).toContainText("匿名离页容量不足");
  await expect(page.getByText(/AI 分析已保存/)).toHaveCount(0);
});

test("缺少依据的保存记录标未知，刷新或展开不能变成当前有效", async ({ page }) => {
  const item = fixture(); item.aiAnalyses = [{ id: "anonymous-no-basis", generatedAt: now, rows: [{ ...row, status: "direct" }] }];
  await seed(page, [item]);
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await expect(page.getByText("分析依据未知，无法判断是否对应当前资料", { exact: true })).toBeVisible();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toHaveCount(0);
  await page.getByText("查看分析依据", { exact: true }).click(); await expect(page.getByText("未记录依据；不能推断旧分析仍然有效。", { exact: true })).toBeVisible();
});

test("请求途中离开并修改 JD，迟到分析保存到原岗位且不覆盖新资料或其他岗位", async ({ page }) => {
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/api/model/chat", async route => { requested = true; await ready; await route.fulfill({ json: { content: JSON.stringify({ requirements: [row] }) } }); });
  await seed(page, [fixture(), fixture("anonymous-analysis-B")]);
  await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click(); await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  const card = (name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card("anonymous-analysis-A").getByRole("button", { name: "编辑岗位", exact: true }).click();
  await page.getByRole("textbox", { name: /岗位 JD/ }).fill("请求等待期间保存的新 JD：要求知识库评测。");
  await page.getByRole("button", { name: "保存新版本准备方案", exact: true }).click();
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await card("anonymous-analysis-B").getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  release();
  await expect(page.getByRole("heading", { name: "已保存的 AI 分析", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await card("anonymous-analysis-A").getByRole("button", { name: "查看岗位", exact: true }).click();
  await openDetails(page, "原始岗位 JD");
  await expect(page.getByText("请求等待期间保存的新 JD：要求知识库评测。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
});

test("不同岗位的分析严格隔离，无关查看和切页不误报陈旧", async ({ page }) => {
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ requirements: [row] }) } }));
  await seed(page, [fixture(), fixture("anonymous-analysis-B")]);
  await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await page.getByText("查看分析依据", { exact: true }).click();
  await expect(page.getByText("生成时使用的资料", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  const card = (name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card("anonymous-analysis-B").getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await card("anonymous-analysis-A").getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
});

test("用户编辑并重新确认经历后分析陈旧，企业参考资料核对文字变化也能识别", async ({ page }) => {
  const item = fixture();
  item.materials = [{ id: "anonymous-company-reference", title: "匿名企业业务资料", kind: "reference", content: "企业提供客服工具。", source: "manual_text", reviewedAt: now, createdAt: now, updatedAt: now }];
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ requirements: [row] }) } }));
  await seed(page, [item]); await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await primary(page, "个人资料"); await page.getByRole("tab", { name: "我的经历", exact: true }).click();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "本人需求访谈", exact: true }) }).getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("textbox", { name: "本人行动", exact: true }).fill("我负责需求访谈，并增加需求核对步骤。");
  await page.getByRole("checkbox", { name: /我确认这张卡/ }).check(); await page.getByRole("button", { name: "保存经历卡", exact: true }).click();
  await primary(page, "我的岗位"); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新分析", exact: true }).click(); await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
  const material = page.locator("article").filter({ has: page.getByRole("heading", { name: "匿名企业业务资料", exact: true }) });
  await material.getByRole("button", { name: "查看 / 编辑", exact: true }).click();
  await material.getByRole("textbox", { name: "核对文字", exact: true }).fill("企业新业务是知识库助手与客服工单工具。");
  await material.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
});

test("存储失败与无效模型响应不伪报保存成功，旧结果刷新保留", async ({ page }, info) => {
  let phase = 0;
  await page.route("**/api/model/chat", route => route.fulfill({ json: { content: JSON.stringify({ requirements: phase === 2 ? [] : [{ ...row, requirement: phase ? "不应假装已保存的新结果" : row.requirement }] }) } }));
  await seed(page); await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as any).c2aNativeSetItem = original; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-projects-v1") throw new DOMException("匿名容量不足", "QuotaExceededError"); original.call(this, key, value); }; });
  phase = 1; await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await expect(page.getByText(/分析保存失败：匿名容量不足/)).toBeVisible();
  await expect(page.getByText(/AI 分析已保存/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "不应假装已保存的新结果", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("analysis-save-failed.png"), fullPage: true });
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  phase = 2; await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await expect(page.getByText(/AI 未返回可保存的有效分析/)).toBeVisible();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
});

test("旧岗位没有新字段仍能打开，旧分析明确依据未知而不推断当前有效", async ({ page }) => {
  await seed(page);
  await expect(page.getByRole("heading", { name: "已保存的 AI 分析", exact: true })).toHaveCount(0);
  await page.getByText("历史分析与旧材料（兼容查看）", { exact: true }).click();
  await expect(page.getByText("旧分析未记录可校验的生成依据，不能判断是否对应当前资料。", { exact: true })).toBeVisible();
});

test("JD 改变保留陈旧结果，重新分析失败仍可查看，成功追加而非删除旧分析", async ({ page }, info) => {
  let fail = false; let version = 0;
  await page.route("**/api/model/chat", route => {
    if (fail) return route.fulfill({ status: 503, json: { error: "匿名服务暂不可用" } });
    version++;
    return route.fulfill({ json: { content: JSON.stringify({ requirements: [{ ...row, requirement: version === 1 ? row.requirement : "更新分析：新增知识库评测要求" }] }) } });
  });
  await seed(page); await page.getByRole("button", { name: "AI 分析岗位", exact: true }).click();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.getByRole("button", { name: "编辑岗位", exact: true }).click();
  await page.getByRole("textbox", { name: /岗位 JD/ }).fill("岗位 JD 改为要求知识库评测与客户需求分析。");
  await page.getByRole("button", { name: "保存新版本准备方案", exact: true }).click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("analysis-stale.png"), fullPage: true });
  fail = true; await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await expect(page.getByText(/模型服务调用失败/)).toBeVisible();
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("analysis-retry-failed.png"), fullPage: true });
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).first().click(); await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  fail = false; await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "更新分析：新增知识库评测要求", exact: true })).toBeVisible();
  await expect(page.getByText("分析依据与当前资料一致", { exact: true })).toBeVisible();
  await page.getByText("查看其他已保存分析（2 次）", { exact: true }).click();
  await page.getByRole("combobox", { name: "选择已保存分析" }).selectOption({ index: 0 });
  await expect(page.getByRole("heading", { name: row.requirement, exact: true })).toBeVisible();
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
});
