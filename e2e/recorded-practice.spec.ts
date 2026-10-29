import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { saveFinalAnswer } from "../src/lib/coaching";

function job(id: string, active = false) {
  const prep = createPreparation("", "");
  prep.questions = ["已回答的旧题", "正在练习的旧题"].map((text, index) => ({ id: `${id}-old-${index}`, text: `${id}：${text}`, category: "经历复盘" as const, technical: false, sourceType: "jd" as const, source: "旧岗位要求" }));
  const item = { ...createInterviewProject({ company: "匿名企业", jobTitle: id, jobDescription: "", candidateBackground: "", concerns: "" }, prep), id };
  if (!active) return item;
  const session = saveFinalAnswer(nextTurn(startSession(prep), `${id}旧原答：本人只负责需求访谈。`, { action: "next" }), 0, `${id}旧最终思路：如实说明职责边界。`);
  return updateProjectFromSession(item, session);
}
async function seedJobs(page: Page, jobs: ReturnType<typeof job>[]) {
  await page.addInitScript(jobs => { if (!localStorage.getItem("ai-interview-projects-v1")) {
    localStorage.setItem("ai-interview-projects-v1", JSON.stringify(jobs));
    localStorage.setItem("ai-interview-drafts-v1", JSON.stringify(Object.fromEntries(jobs.filter(item => item.session).map(item => [`answer:${item.session!.id}:${item.session!.questions[item.session!.currentQuestionIndex].id}`, `${item.id}旧首答草稿`]))));
  } }, jobs);
}

const question = "请讲述本人如何开展客户需求访谈，并说明职责边界。";
async function library(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "recorded");
}
async function empty(page: Page) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.goto("/"); await library(page);
}

test("真实题无JD录入后直达原训练，来源不冒充认证，刷新后仍可查看与复练", async ({ page }, info) => {
  await empty(page);
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("recorded-input.png"), fullPage: false });
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
  await expect(page.getByText("本人记录的真实面试问题", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("");
  await expect(page.getByText(/平台未独立验证/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("recorded-training.png"), fullPage: true });
  await page.reload(); await library(page);
  await expect(page.getByRole("heading", { name: question, exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "再次练习这道题", exact: true }).click();
  await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("");
});

test("关联极旧岗位没有准备快照时拒绝覆盖，题目已保存可保留，旧岗位不变", async ({ page }) => {
  const legacy = job("匿名极旧岗位"); delete legacy.preparation;
  await seedJobs(page, [legacy]); await empty(page);
  const before = await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"));
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  await page.getByRole("combobox", { name: "关联岗位（可选）", exact: true }).selectOption(legacy.id);
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "缺少训练准备快照" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"))).toBe(before);
  await expect(page.getByRole("heading", { name: "记录一道真实面试题", exact: true })).toBeVisible();
});

test("真实题点评追问重答最终思路刷新后可复练，题库编辑的最终版不能被旧内存会话覆盖", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const bad = JSON.parse(JSON.parse(readFileSync(new URL("../test-fixtures/public-coach/experience-semantic-expansion.json", import.meta.url), "utf8")).requests[0].body.content);
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名Mock" } }));
  let interviewer = 0;
  const followUp = "请说明你形成的产物及没有承担的职责。";
  await page.route("**/api/model/chat", route => {
    const task = route.request().postDataJSON().task;
    if (task === "interviewer") return route.fulfill({ json: { content: JSON.stringify(++interviewer === 1 ? { action: "follow_up", followUpQuestion: followUp } : { action: "next" }) } });
    if (task === "coach") return route.fulfill({ json: { content: JSON.stringify(bad) } });
    throw new Error("真实题不应请求选题或岗位分析");
  });
  await page.goto("/"); await library(page);
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("原答：本人访谈客户并形成需求清单，没有负责模型研发或上线。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: followUp, exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("追问回答：我的产物是需求清单，不补充未知团队职责。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await page.getByRole("combobox", { name: "选择已回答的问题" }).selectOption("0");
  await expect(page.getByRole("region", { name: "当前回答反馈" }).getByText(/先说明本人已确认的职责与行动/)).toBeVisible();
  await expect(page.getByRole("button", { name: "复制到待确认答案草稿", includeHidden: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "同题重答", exact: true }).fill("重答：只说本人访谈行动、清单与责任边界。");
  await page.getByRole("button", { name: "保存重答并对比", exact: true }).click();
  await page.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前回答反馈" }).getByText(/先说明本人已确认的职责与行动/)).toBeVisible();
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("本人确认：职责、行动、产物与边界。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await library(page);
  const final = "本人在题库确认的成熟思路：只说明访谈、需求清单及责任边界。";
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill(final);
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!)[0]);
  await page.getByRole("button", { name: "再次练习这道题", exact: true }).click();
  await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("");
  const old = await page.evaluate(id => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!).find((item: any) => item.id === id), before.id);
  expect(old).toEqual(before);
  expect(old.turns[0].finalAnswer).toBe(final);
  expect(old.turns[0].coachReviews.map((review: any) => review.answerVersion)).toEqual([1, 2]);
  expect(old.turns[1].coachReviews[0].answerVersion).toBe(1);
  await page.reload(); await library(page);
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue(final);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("recorded-final-refreshed.png"), fullPage: true });
});

test("独立训练未提交草稿时，录入新题须确认，取消后可继续原题且不改变旧会话", async ({ page }, info) => {
  await empty(page);
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("旧题首答草稿：本人只负责需求访谈。");
  const before = await page.evaluate(() => ({ history: localStorage.getItem("ai-interview-prep-history-v1"), drafts: JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!) }));
  await library(page);
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill("第二道真实题：如何核对客户需求？");
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "保留当前训练", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-prep-history-v1"))).toBe(before.history);
  await page.getByRole("button", { name: "再次练习这道题", exact: true }).click();
  await dialog.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("旧题首答草稿：本人只负责需求访谈。");
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!));
  for (const [key, value] of Object.entries(before.drafts)) if (key.startsWith("answer:")) expect(after[key]).toBe(value);
  await page.screenshot({ path: info.outputPath("recorded-cancel-continue.png"), fullPage: true });
});

test("录题保存失败保留输入，重试可保存；刷新可恢复未提交的题目文字草稿", async ({ page }) => {
  await empty(page);
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  await page.reload(); await library(page);
  await expect(page.getByRole("textbox", { name: "真实面试问题", exact: true })).toHaveValue(question);
  await page.evaluate(() => { let fail = true; const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-question-library-v1" && fail) { fail = false; throw new DOMException("匿名录题写入失败", "QuotaExceededError"); } original.call(this, key, value); }; });
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await expect(page.getByRole("region", { name: "记录真实面试题" }).getByRole("status")).toContainText("匿名录题写入失败");
  await expect(page.getByRole("textbox", { name: "真实面试问题", exact: true })).toHaveValue(question);
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-prep-history-v1"))).toBeNull();
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
});

test("刷新后仍有同题未完成独立训练时先确认，可继续旧会话及首答草稿而不新建记录", async ({ page }) => {
  await empty(page);
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("刷新前未提交的真实题草稿。");
  const before = await page.evaluate(() => localStorage.getItem("ai-interview-prep-history-v1"));
  await page.reload(); await library(page);
  await page.getByRole("button", { name: "再次练习这道题", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("刷新前未提交的真实题草稿。");
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-prep-history-v1"))).toBe(before);
});

for (const kind of ["archive", "project", "independent"] as const) test(`真实题${kind}写入失败不假启动，原岗位/原答/最终版/草稿仍在`, async ({ page }) => {
  const a = job("匿名岗位A", true); await seedJobs(page, [a]);
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: false } }));
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await library(page);
  const before = await page.evaluate(() => ({ projects: localStorage.getItem("ai-interview-projects-v1"), drafts: JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!) }));
  await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
  if (kind !== "independent") await page.getByRole("combobox", { name: "关联岗位（可选）", exact: true }).selectOption(a.id);
  await page.evaluate(kind => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    const fail = kind === "project" ? key === "ai-interview-projects-v1" : key === "ai-interview-prep-history-v1" && (kind === "archive" || JSON.parse(value).some((session: any) => session.preparation.questions[0]?.sourceType === "user_recorded"));
    if (fail) throw new DOMException("匿名启动写入失败", "QuotaExceededError"); original.call(this, key, value);
  }; }, kind);
  await page.getByRole("button", { name: "保存并练习", exact: true }).click();
  await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "匿名启动写入失败" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"))).toBe(before.projects);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!));
  for (const [key, value] of Object.entries(before.drafts)) if (key.startsWith("answer:")) expect(after[key]).toBe(value);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1") || "[]"));
  if (kind === "archive") expect(history).toEqual([]); else expect(history).toEqual([JSON.parse(before.projects!)[0].session]);
});

test("两岗位无JD同一问句分别保存，确认新轮次归档旧回答且A/B会话不串联", async ({ page }, info) => {
  const a = job("匿名岗位A", true), b = job("匿名岗位B", true); await seedJobs(page, [a, b]); await empty(page);
  for (const item of [a, b]) {
    await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
    await page.getByRole("combobox", { name: "关联岗位（可选）", exact: true }).selectOption(item.id);
    await page.getByRole("button", { name: "保存并练习", exact: true }).click();
    await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
    await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(`${item.id}新回答草稿`);
    await library(page);
  }
  const saved = await page.evaluate(() => ({ jobs: JSON.parse(localStorage.getItem("ai-interview-projects-v1")!), history: JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!), library: JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!), drafts: JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!) }));
  const qa = saved.library.recordedQuestions.find((item: any) => item.projectId === a.id), qb = saved.library.recordedQuestions.find((item: any) => item.projectId === b.id);
  expect(qa.id).not.toBe(qb.id);
  expect(saved.jobs.find((item: any) => item.id === a.id).session.preparation.questions[0].id).toBe(qa.id);
  expect(saved.jobs.find((item: any) => item.id === b.id).session.preparation.questions[0].id).toBe(qb.id);
  for (const item of [a, b]) expect(saved.history.find((session: any) => session.id === item.session!.id)).toEqual(JSON.parse(JSON.stringify(item.session)));
  for (const item of [a, b]) expect(Object.values(saved.drafts)).toContain(`${item.id}新回答草稿`);
  await page.getByRole("combobox", { name: "按岗位筛选", exact: true }).selectOption(b.id);
  await page.getByRole("button", { name: "再次练习这道题", exact: true }).click();
  await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保留当前训练", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!))).toEqual(saved.jobs);
  await page.screenshot({ path: info.outputPath("recorded-two-jobs.png"), fullPage: true });
});

test("真实题等待点评锁定导航，取消保留原答；未确认最终思路离开后恢复但不自动确认", async ({ page }, info) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名Mock" } }));
  await page.route("**/api/model/chat", async route => {
    if (route.request().postDataJSON().task === "interviewer") return route.fulfill({ json: { content: JSON.stringify({ action: "next" }) } });
    await gate; await route.fulfill({ status: 503 }).catch(() => {});
  });
  try {
    await page.goto("/"); await library(page);
    await page.getByRole("textbox", { name: "真实面试问题", exact: true }).fill(question);
    await page.getByRole("button", { name: "保存并练习", exact: true }).click();
    const answer = "本人独立原答：我负责客户访谈并整理需求清单。";
    await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(answer);
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(page.getByRole("region", { name: "AI请求等待状态" })).toBeVisible();
    // Opening the drawer remains allowed; the actual navigation action is disabled.
    await expect(page.getByRole("button", { name: /AI 面试题库/, includeHidden: true }).first()).toBeDisabled();
    await page.getByRole("button", { name: "取消AI等待", exact: true }).click(); release();
    await expect(page.getByRole("region", { name: "AI请求等待状态" })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!)[0].turns[0].answer)).toBe(answer);
    const final = "未保存思路：只使用本人确认的职责和边界。";
  await openDetails(page, "保存我的回答思路");
    await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill(final);
    await library(page);
    await page.getByRole("button", { name: "整理训练记录", exact: true }).click();
    await page.getByRole("button", { name: "查看", exact: true }).click();
  await openDetails(page, "保存我的回答思路");
    await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue(final);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!)[0].turns[0].finalAnswer)).toBeUndefined();
    await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
    await page.screenshot({ path: info.outputPath("recorded-cancel-ai.png"), fullPage: true });
  } finally { release(); }
});
