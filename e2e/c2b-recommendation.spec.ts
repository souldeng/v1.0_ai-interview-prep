import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { attachCoachReview, reviseTurn, saveFinalAnswer } from "../src/lib/coaching";
import { emptyUserProfile } from "../src/lib/profileStorage";
import { buildAnalysisBasis } from "../src/lib/jobAnalysis";
import { readFileSync } from "node:fs";

const projectKey = "ai-interview-projects-v1", historyKey = "ai-interview-prep-history-v1", draftKey = "ai-interview-drafts-v1";
const chosen = "请说明一次真实需求访谈经历；如何界定本人职责？";
const now = "2026-10-18T00:00:00.000Z";
const oldBadFeedback = JSON.parse(JSON.parse(readFileSync(new URL("../test-fixtures/public-coach/experience-semantic-expansion.json", import.meta.url), "utf8")).requests[0].body.content);
function fixture(id = "anonymous-c2b-A", active = false) {
  const input = { company: "匿名企业", jobTitle: id, jobDescription: "整理客户需求，准备AI应用方案。", candidateBackground: "旧背景不能作为已确认事实。", concerns: "" };
  const prepared = createPreparation(input.candidateBackground, input.jobDescription);
  prepared.questions = [
    { id: "old-main", text: "旧训练：介绍个人贡献。", category: "经历复盘", technical: false, sourceType: "resume", source: "历史个人背景" },
    { id: "old-next", text: "旧训练：如何评测系统？", category: "技术理解", technical: true, sourceType: "foundation", source: "内置学习题" },
  ];
  let item = { ...createInterviewProject(input, prepared), id };
  if (active) {
    let session = nextTurn(startSession(prepared), "原答：本人访谈客户并形成需求清单。", { action: "next" });
    session = reviseTurn(session, 0, "重答：本人整理需求，没有负责模型研发。");
    session = saveFinalAnswer(session, 0, "旧最终思路：本人访谈客户并形成需求清单。");
    session = attachCoachReview(session, 0, 2, session.turns[0].revisions![0].answer, { strengths: ["旧点评原文"], issues: [], suggestions: [], factRisks: [], studyTopics: [], answerStructure: "旧职责与边界", optimizedExample: "", generatedAt: now });
    item = updateProjectFromSession(item, session);
  }
  return { ...item, aiAnalyses: [{ id: "saved-analysis-1", generatedAt: now, rows: [
    { requirement: "另一项要求", status: "unknown" as const, evidenceQuote: "", reason: "匿名参考", studyTopic: "", practiceQuestion: "另一道题，不应被选中。" },
    { requirement: "需求访谈与职责边界", status: "unknown" as const, evidenceQuote: "", reason: "匿名参考", studyTopic: "需求核对", practiceQuestion: chosen },
  ] }] };
}
async function seed(page: Page, jobs = [fixture()]) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名Mock" } }));
  await page.addInitScript(({ jobs, profile }) => {
    if (!localStorage.getItem("ai-interview-projects-v1")) {
      localStorage.setItem("ai-interview-projects-v1", JSON.stringify(jobs));
      localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile));
      const current = jobs[0].session;
      if (current) localStorage.setItem("ai-interview-drafts-v1", JSON.stringify({ [`answer:${current.id}:${current.questions[current.currentQuestionIndex].id}`]: "旧首答草稿：需要继续完善。", [`retry:${current.id}:0`]: "旧重答草稿：补充职责边界。" }));
    }
  }, { jobs, profile: emptyUserProfile(new Date(now)) });
  await page.goto("/");
  await page.getByRole("button", { name: "查看岗位", exact: true }).first().click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
}
const row = (page: Page) => page.getByRole("region", { name: "已保存的 AI 分析" }).locator("article").filter({ has: page.getByRole("heading", { name: "需求访谈与职责边界", exact: true }) });
async function snapshot(page: Page) { return page.evaluate(({ projectKey, historyKey, draftKey }) => [projectKey, historyKey, draftKey].map(key => localStorage.getItem(key)), { projectKey, historyKey, draftKey }); }
async function primary(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: /AI 面试题库/ }).first().click();
  await libraryArea(page, "job");
}

test("C2-B 指定推荐题原文直达既有训练，不调用选题或重新生成，刷新保留来源", async ({ page }, info) => {
  let calls = 0;
  await page.route("**/api/model/chat", route => { calls++; return route.fulfill({ status: 503 }); });
  const item = fixture();
  await seed(page, [item]);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await expect(page.getByRole("heading", { name: chosen, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("");
  await expect(page.getByText("AI 分析推荐", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/问题依据：.*anonymous-c2b-A.*saved-analysis-1/)).toBeVisible();
  expect(calls).toBe(0);
  await page.screenshot({ path: info.outputPath("recommendation-training.png"), fullPage: true });
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: chosen, exact: true })).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!)[0], projectKey);
  expect(saved.preparation).toEqual(item.preparation);
  expect(saved.aiAnalyses).toEqual(item.aiAnalyses);
  expect(saved.session.questions).toHaveLength(1);
  expect(saved.session.preparation.questions[0].source).toContain("非企业面试原题");
  expect(calls).toBe(0);
});

test("C2-B 取消新轮次不改旧记录，用户可明确继续当前训练", async ({ page }, info) => {
  const item = fixture("anonymous-c2b-A", true);
  await seed(page, [item]);
  const before = await snapshot(page);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  await expect(dialog).toContainText("仅练习你选择的 AI 分析推荐题");
  await dialog.getByRole("button", { name: "保留当前训练", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await dialog.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "旧训练：如何评测系统？", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("旧首答草稿：需要继续完善。");
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue(item.session!.turns[0].finalAnswer!);
  expect(await snapshot(page)).toEqual(before);
  await page.screenshot({ path: info.outputPath("cancel-continue-old.png"), fullPage: true });
});

test("C2-B 推荐题回答追问点评保存刷新后返回原分析而非最近分析，P1-F仍生效", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const item = fixture();
  item.aiAnalyses.push({ id: "newer-analysis-2", generatedAt: "2026-10-19T00:00:00.000Z", rows: [{ ...item.aiAnalyses[0].rows[1], practiceQuestion: "最近分析的另一道题。" }] });
  let interviewer = 0, coaches = 0;
  const followUp = "你如何确认需求清单来自客户原话？";
  await page.route("**/api/model/chat", route => {
    const task = route.request().postDataJSON().task;
    if (task === "interviewer") { interviewer++; return route.fulfill({ json: { content: JSON.stringify(interviewer === 1 ? { action: "follow_up", followUpQuestion: followUp } : { action: "next" }) } }); }
    if (task === "coach") { coaches++; return route.fulfill({ json: { content: JSON.stringify(oldBadFeedback) } }); }
    throw new Error("推荐题不应请求选题或重新分析");
  });
  await seed(page, [item]);
  await page.getByText("查看其他已保存分析（2 次）", { exact: true }).click();
  await page.getByRole("combobox", { name: "选择已保存分析" }).selectOption("saved-analysis-1");
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("原答：本人负责需求访谈并形成需求清单，没有负责模型研发或上线。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("heading", { name: followUp, exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("追问回答：只说明我已确认的访谈和清单，尚未核实的步骤暂不补写。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await page.getByRole("combobox", { name: "选择已回答的问题" }).selectOption("0");
  await expect(page.getByRole("region", { name: "当前回答反馈" }).getByText(/先说明本人已确认的职责与行动/)).toBeVisible();
  await expect(page.getByRole("button", { name: "复制到待确认答案草稿", includeHidden: true })).toHaveCount(0);
  const final = "本人负责需求访谈并形成需求清单，没有负责模型研发或上线。";
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill(final);
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "最终确认答案已保存" })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  const back = page.getByRole("button", { name: "返回原岗位分析", exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(row(page).getByText(`建议准备：${chosen}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "选择已保存分析", includeHidden: true })).toHaveValue("saved-analysis-1");
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!)[0], projectKey);
  expect(saved.aiAnalyses).toEqual(item.aiAnalyses);
  expect(saved.session.turns.map((turn: any) => turn.question)).toEqual([chosen, followUp]);
  expect(saved.session.turns[0].finalAnswer).toBe(final);
  expect(saved.session.turns.map((turn: any) => turn.coachReviews[0].answerVersion)).toEqual([1, 1]);
  expect(interviewer).toBe(2); expect(coaches).toBe(2); expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("returned-original-analysis.png"), fullPage: true });
});

test("C2-B 确认新轮次归档原答重答点评最终版及草稿，旧会话仍可查看", async ({ page }, info) => {
  const item = fixture("anonymous-c2b-A", true);
  await seed(page, [item]);
  const before = await snapshot(page);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("heading", { name: chosen, exact: true })).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!)[0], projectKey);
  expect(saved.session.id).not.toBe(item.session!.id);
  expect(saved.preparation).toEqual(item.preparation);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), historyKey)).toEqual([item.session]);
  expect((await snapshot(page))[2]).toBe(before[2]);
  await primary(page); await page.getByRole("button", { name: "整理训练记录", exact: true }).click();
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("旧首答草稿：需要继续完善。");
  await expect(page.getByRole("textbox", { name: "同题重答", exact: true })).toHaveValue("旧重答草稿：补充职责边界。");
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue(item.session!.turns[0].finalAnswer!);
  await openDetails(page, "历史回答与点评");
  await page.getByText("版本 1 · 原回答", { exact: true }).click();
  await expect(page.getByText(item.session!.turns[0].answer, { exact: true })).toBeVisible();
  await expect(page.getByText("旧点评原文", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("archived-old-training.png"), fullPage: true });
});

test("C2-B 首答尚未提交也须确认，取消后旧会话和首答草稿完整保留", async ({ page }) => {
  const item = fixture(); item.session = startSession(item.preparation!);
  await seed(page, [item]); const before = await snapshot(page);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保留当前训练", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});

for (const kind of ["new-project", "archive", "existing-project"] as const) test(`C2-B ${kind} 保存失败不能假启动，旧岗位草稿和历史保持可恢复`, async ({ page }) => {
  const item = fixture("anonymous-c2b-A", kind !== "new-project");
  await seed(page, [item]); const before = await snapshot(page);
  await page.evaluate(({ failKey }) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === failKey) throw new DOMException("匿名启动写入失败", "QuotaExceededError"); original.call(this, key, value); };
  }, { failKey: kind === "archive" ? historyKey : projectKey });
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  if (kind !== "new-project") await page.getByRole("dialog", { name: "开始新一轮训练" }).getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "匿名启动写入失败" })).toBeVisible();
  await expect(page.getByRole("heading", { name: chosen, exact: true })).toHaveCount(0);
  const after = await snapshot(page);
  expect(after[0]).toBe(before[0]); expect(after[2]).toBe(before[2]);
  if (kind !== "existing-project") expect(after[1]).toBe(before[1]);
  else expect(JSON.parse(after[1]!)).toEqual([item.session]); // C1: archive may succeed before the job write fails.
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  if (kind !== "new-project") {
    await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
    await expect(page.getByRole("heading", { name: "旧训练：如何评测系统？", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("旧首答草稿：需要继续完善。");
  }
});

test("C2-B 陈旧分析明确提示但仍可练习，未知依据不标为真实题源", async ({ page }, info) => {
  const item = fixture();
  const basis = await buildAnalysisBasis(item, emptyUserProfile(new Date(now)));
  const saved = { ...item, aiAnalyses: [{ ...item.aiAnalyses[0], basis }], jobDescription: "已修改JD：增加新的验收要求。" };
  await seed(page, [saved]);
  await expect(page.getByText("岗位资料已有变化，建议重新分析", { exact: true })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "练习这道题", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("stale-analysis-practice.png"), fullPage: true });
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await expect(page.getByRole("heading", { name: chosen, exact: true })).toBeVisible();
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!)[0], projectKey)).aiAnalyses).toEqual(saved.aiAnalyses);
});

test("C2-B 两岗位相同推荐文字仍隔离题目ID、会话和回答草稿", async ({ page }) => {
  await page.route("**/api/model/chat", () => { throw new Error("仅选题和切换不应调用模型"); });
  await seed(page, [fixture(), fixture("anonymous-c2b-B")]);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("岗位A草稿：本人需求访谈的职责。");
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "anonymous-c2b-B", exact: true }) }).getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "岗位分析", exact: true }).click();
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("");
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("岗位B草稿：不同岗位的独立思路。");
  const jobs = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), projectKey);
  expect(jobs[0].session.id).not.toBe(jobs[1].session.id);
  expect(jobs[0].session.preparation.questions[0].id).not.toBe(jobs[1].session.preparation.questions[0].id);
  await page.getByRole("button", { name: "返回岗位列表", exact: true }).click();
  await page.locator("article").filter({ has: page.getByRole("heading", { name: "anonymous-c2b-A", exact: true }) }).getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("岗位A草稿：本人需求访谈的职责。");
});

test("C2-B 首答草稿返回可恢复，点评等待和草稿保存失败仍锁定原分析入口", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/model/chat", async route => {
    if (route.request().postDataJSON().task === "interviewer") return route.fulfill({ json: { content: JSON.stringify({ action: "next" }) } });
    await gate; return route.fulfill({ json: { content: JSON.stringify(oldBadFeedback) } });
  });
  await seed(page);
  await row(page).getByRole("button", { name: "练习这道题", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("本人需求访谈的首答草稿，没有负责模型研发。");
  await page.getByRole("button", { name: "返回原岗位分析", exact: true }).click();
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue("本人需求访谈的首答草稿，没有负责模型研发。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("button", { name: "返回原岗位分析", exact: true })).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "岗位准备模块" }).getByRole("button", { name: "岗位分析", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("heading", { name: "AI 教练反馈", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-drafts-v1") throw new DOMException("匿名草稿保存失败", "QuotaExceededError"); original.call(this, key, value); };
  });
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("未能保存的最终思路：本人实际访谈和清单。");
  await expect(page.getByRole("button", { name: "返回原岗位分析", exact: true })).toBeDisabled();
  await openDetails(page, "保存我的回答思路");
  await expect(page.getByRole("textbox", { name: "最终确认答案", exact: true })).toHaveValue("未能保存的最终思路：本人实际访谈和清单。");
});
