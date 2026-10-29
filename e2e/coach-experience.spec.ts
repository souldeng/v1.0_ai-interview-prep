import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page, type Locator, type TestInfo } from "@playwright/test";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";
import { emptyUserProfile, PROFILE_KEY } from "../src/lib/profileStorage";

async function feedbackEvidence(review: Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name);
  const feedback = review.getByRole("region", { name: "当前回答反馈" });
  // Center short panels before capturing so the existing sticky header does not obscure their title.
  await feedback.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await feedback.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function project(technical = true) {
  const input = { company: "匿名公司", jobTitle: "匿名教练岗位", jobDescription: "理解 AI 应用。", candidateBackground: "我负责需求访谈。", concerns: "" };
  const preparation = createPreparation(input.candidateBackground, input.jobDescription);
  preparation.questions = [{ id: "anonymous-coach-question", text: technical ? "RAG 与 Agent 有什么区别？" : "请介绍一个真实项目，说明个人贡献。", category: technical ? "技术理解" : "经历复盘", technical, source: "匿名测试", sourceType: technical ? "foundation" : "resume" }];
  const session = nextTurn(startSession(preparation), technical ? "RAG 结合检索与生成，Agent 涉及任务与工具，评测部分我还不知道。" : "我负责需求访谈，形成需求清单，没有负责研发。", { action: "next" });
  return updateProjectFromSession({ ...createInterviewProject(input, preparation), id: "anonymous-coach-job" }, session);
}

async function openReview(page: Page, item = project(), configured = false) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: configured, provider: "匿名测试模型" } }));
  await page.addInitScript(value => { if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify([value])); }, item);
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click();
  await page.getByRole("button", { name: "面试训练", exact: true }).click();
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "点评 → 重答 → 对比", exact: true }) }).last();
}

test("知识题默认简洁反馈，规则按需展开且备份说明准确", async ({ page }, testInfo) => {
  const review = await openReview(page);
  await expect(review.getByRole("heading", { name: "本地辅助提示", exact: true })).toBeVisible();
  for (const name of ["已经做得好的地方", "需要改进的地方", "建议回答思路"]) await expect(review.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(review.getByRole("heading", { name: "回答依据核对 · 本地规则" })).not.toBeVisible();
  await review.getByText("事实依据与规则检测详情", { exact: true }).click();
  await expect(review.getByRole("heading", { name: "回答依据核对 · 本地规则" })).toBeVisible();
  await expect(review.getByText(/个人行动 ·/)).toHaveCount(0);
  await expect(page.getByText("资料保存在当前浏览器。数据备份不包含原始附件，请另外保存原文件。")).toHaveCount(1);
  await review.getByText("事实依据与规则检测详情", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("knowledge-local.png"), fullPage: true });
  await feedbackEvidence(review, testInfo, "knowledge-local-feedback.png");
});

test("教练重试请求分开已确认事实、岗位 JD 和第三方面经，不改个人资料", async ({ page }) => {
  const item = project();
  const profile = emptyUserProfile(new Date("2026-10-14T00:00:00.000Z"));
  profile.experiences = [
    { id: "anonymous-confirmed", title: "本人访谈", situation: "客户需求", action: "我负责访谈", result: "形成需求记录", reflection: "", confirmed: true, createdAt: profile.updatedAt, updatedAt: profile.updatedAt },
    { id: "anonymous-unconfirmed", title: "未确认经历", situation: "", action: "我完成 50 个 AI 项目", result: "", reflection: "", confirmed: false, createdAt: profile.updatedAt, updatedAt: profile.updatedAt },
  ];
  item.jobDescription = "需要 3 年 AI 项目经验。";
  item.materials = [{ id: "anonymous-third", kind: "interview_experience", title: "第三方面经", content: "我在上一家公司落地了 20 个 AI 项目。", source: "manual_text", reviewedAt: profile.updatedAt, createdAt: profile.updatedAt, updatedAt: profile.updatedAt }];
  await page.addInitScript(({ key, data }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data)); }, { key: PROFILE_KEY, data: profile });
  let requestContext: Record<string, any> | undefined;
  await page.route("**/api/model/chat", route => {
    const prompt = route.request().postDataJSON().messages[1].content as string;
    requestContext = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
    return route.fulfill({ json: { content: JSON.stringify({ strengths: [], issues: ["尚未解释区别"], factRisks: [], suggestions: [], answerStructure: "定义→逻辑→应用", studyTopics: [], optimizedExample: "" }) } });
  });
  const review = await openReview(page, item, true);
  await review.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review.getByRole("heading", { name: "AI 教练反馈", exact: true })).toBeVisible();
  expect(requestContext!["A_用户本人已确认事实"].join(" ")).toContain("我负责访谈");
  expect(requestContext!["A_用户本人已确认事实"].join(" ")).not.toMatch(/3 年|20 个|50 个/);
  expect(requestContext!["B_当前岗位JD"].jd).toContain("3 年");
  expect(requestContext!["C_第三方面经_绝非当前用户经历"][0].text).toContain("20 个");
  expect(requestContext!["当前问题"]).toBe("RAG 与 Agent 有什么区别？");
  expect(requestContext!["用户本轮原回答"]).toBe("RAG 结合检索与生成，Agent 涉及任务与工具，评测部分我还不知道。");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PROFILE_KEY)).toEqual(profile);
});

test("无版本的旧 AI 建议只供历史查看，重大事实风险不被折叠掩盖", async ({ page }) => {
  const item = project(false);
  item.session!.turns[0].aiCoach = { strengths: ["旧回答建议"], issues: [], suggestions: [], studyTopics: [], factRisks: ["历史成果资料中没有依据，请确认或删除。"], answerStructure: "旧版思路", optimizedExample: "", generatedAt: "2026-10-13T00:00:00.000Z" };
  const review = await openReview(page, item);
  await expect(review.getByRole("heading", { name: "本地辅助提示", exact: true })).toBeVisible();
  await expect(review.getByRole("region", { name: "当前回答反馈" }).getByText("旧回答建议", { exact: true })).toHaveCount(0);
  await expect(review.getByText("旧版 AI 点评 · 未记录关联版本，不能视为当前点评", { exact: true })).toBeVisible();
  await expect(review.getByRole("alert").filter({ hasText: "历史成果资料中没有依据" })).toBeVisible();
});

test("经历题的当前 AI 反馈、事实风险与重答历史严格分开", async ({ page }, testInfo) => {
  const item = project(false);
  const answer = item.session!.turns[0].answer;
  let requests = 0;
  await page.route("**/api/model/chat", route => {
    requests++;
    return route.fulfill({ json: { content: JSON.stringify({ strengths: [requests === 1 ? "原版：说明了本人访谈职责" : "新版：补充了访谈步骤"], issues: ["可解释如何形成需求清单"], factRisks: ["资料中没有依据，请确认或删除。"], suggestions: ["区分个人和团队行动"], answerStructure: "背景→本人职责→访谈行动→产物与边界", studyTopics: [], optimizedExample: "" }) } });
  });
  const review = await openReview(page, item, true);
  await review.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review.getByRole("region", { name: "当前回答反馈" }).getByText("原版：说明了本人访谈职责", { exact: true })).toBeVisible();
  await expect(review.getByRole("heading", { name: "事实风险 · 请核对" })).toBeVisible();
  await expect(review.getByRole("heading", { name: "回答依据核对 · 本地规则" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("experience-ai.png"), fullPage: true });
  await feedbackEvidence(review, testInfo, "experience-ai-feedback.png");
  await review.getByRole("textbox", { name: "同题重答", exact: true }).fill("重答：我负责访谈客户，整理诉求并形成需求清单，没有负责研发。");
  await review.getByRole("button", { name: "保存重答并对比", exact: true }).click();
  await expect(review.getByRole("heading", { name: "本地辅助提示", exact: true })).toBeVisible();
  await expect(review.getByRole("region", { name: "当前回答反馈" }).getByText(/原版：/)).toHaveCount(0);
  await openDetails(page, "历史回答与点评");
  await review.getByText("历史 AI 点评 · 回答版本 1", { exact: true }).click();
  await expect(review.getByText("原版：说明了本人访谈职责", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review.getByRole("region", { name: "当前回答反馈" }).getByText("新版：补充了访谈步骤", { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(review.getByRole("region", { name: "当前回答反馈" }).getByText("新版：补充了访谈步骤", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.turns[0]);
  expect(saved.answer).toBe(answer); expect(saved.revisions).toHaveLength(1); expect(saved.coachReviews).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath("rewritten-version.png"), fullPage: true });
  await feedbackEvidence(review, testInfo, "rewritten-version-feedback.png");
});

for (const kind of ["503", "invalid", "timeout"] as const) test(`初次提交的 ${kind} 点评失败仍保存原回答且不伪装成功`, async ({ page }) => {
  const item = project(); item.session = startSession(item.preparation!);
  const revised = updateProjectFromSession(item, item.session);
  let coachCalled = false;
  await page.route("**/api/model/chat", async route => {
    const prompt = route.request().postDataJSON().messages[1].content as string;
    if (!prompt.includes("任务 D")) return route.fulfill({ json: { content: JSON.stringify({ action: "next" }) } });
    coachCalled = true;
    if (kind === "timeout") return; // Leave the network request unanswered; the client must abort it.
    if (kind === "503") return route.fulfill({ status: 503, json: { error: "匿名不可用" } });
    return route.fulfill({ json: { content: JSON.stringify({ strengths: [], issues: [], answerStructure: "", optimizedExample: "" }) } });
  });
  if (kind === "timeout") await page.clock.install();
  await openReview(page, revised, true);
  const raw = "匿名原回答：RAG 依赖检索知识，Agent 涉及任务工具，其他部分暂不理解。";
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(raw);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect.poll(() => coachCalled).toBe(true);
  if (kind === "timeout") await page.clock.fastForward(151_000);
  await expect(page.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 教练反馈", exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session);
  expect(saved.turns).toHaveLength(1); expect(saved.turns[0].answer).toBe(raw); expect(saved.turns[0].coachReviews).toBeUndefined();
  await expect(page.getByRole("button", { name: "重试 AI 点评", exact: true })).toBeEnabled();
});

test("点评等待期间保存的最终答案不被迟到结果覆盖，点评保存失败也不改原记录", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/model/chat", async route => {
    await ready;
    await route.fulfill({ json: { content: JSON.stringify({ strengths: ["说明检索"], issues: [], factRisks: [], suggestions: [], answerStructure: "定义→流程", studyTopics: [], optimizedExample: "" }) } });
  });
  const review = await openReview(page, project(), true);
  await review.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review.getByRole("button", { name: "AI 点评中…", exact: true })).toBeDisabled();
  await openDetails(page, "保存我的回答思路");
  await review.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("等待期间本人确认的最终答案：保留检索与任务执行的区别。");
  await review.getByRole("button", { name: "保存最终答案", exact: true }).click();
  release();
  await expect(review.getByRole("heading", { name: "AI 教练反馈", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session.turns[0]);
  expect(saved.finalAnswer).toBe("等待期间本人确认的最终答案：保留检索与任务执行的区别。");
  // Begin a new answer version, then simulate quota failure at the browser storage boundary.
  await review.getByRole("textbox", { name: "同题重答", exact: true }).fill("新版本回答：检索提供知识，任务执行需要工具调用。");
  await review.getByRole("button", { name: "保存重答并对比", exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"));
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-projects-v1") throw new DOMException("匿名测试容量不足", "QuotaExceededError"); return original.call(this, key, value); }; });
  await review.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review.getByRole("status")).toContainText("点评未保存");
  await expect(review.getByRole("heading", { name: "AI 教练反馈", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-projects-v1"))).toBe(before);
});

test("503 明示本地提示，主动重试仅点评且原回答与最终答案不变", async ({ page }, testInfo) => {
  const item = project();
  item.session!.turns[0].finalAnswer = "本人最终答案：检索与任务工具调用不是同一概念。";
  const originalAnswer = item.session!.turns[0].answer;
  let requests = 0;
  await page.route("**/api/model/chat", route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, json: { error: "匿名不可用" } });
    return route.fulfill({ json: { content: JSON.stringify({ strengths: ["提到了检索与任务工具"], issues: ["需要解释 Agent 的决策循环"], factRisks: [], suggestions: ["区分知识增强与任务执行"], answerStructure: "定义→流程差异→局限", studyTopics: ["工具调用"], optimizedExample: "" }) } });
  });
  const review = await openReview(page, item, true);
  await review.getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
  await expect(review.getByText(/503/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ai-failure.png"), fullPage: true });
  await feedbackEvidence(review, testInfo, "ai-failure-feedback.png");
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(review.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "重试 AI 点评", exact: true }).click();
  await expect(review.getByRole("heading", { name: "AI 教练反馈", exact: true })).toBeVisible();
  await expect(review.getByRole("region", { name: "当前回答反馈" }).getByText("提到了检索与任务工具", { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session);
  expect(saved.turns).toHaveLength(1); expect(saved.turns[0].revisions).toBeUndefined();
  expect(saved.turns[0].answer).toBe(originalAnswer);
  expect(saved.turns[0].finalAnswer).toBe("本人最终答案：检索与任务工具调用不是同一概念。");
  expect(saved.turns[0].coachReviews).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("ai-success.png"), fullPage: true });
  await feedbackEvidence(review, testInfo, "ai-success-feedback.png");
});
