import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Page } from "@playwright/test";
import { createPreparation, nextTurn, startSession } from "../src/lib/interview";
import { createInterviewProject, updateProjectFromSession } from "../src/lib/projects";

function fixture() {
  const input = { company: "匿名企业", jobTitle: "匿名可用性岗位", jobDescription: "理解AI应用", candidateBackground: "", concerns: "" };
  const preparation = createPreparation("", input.jobDescription);
  preparation.questions = [{ id: "availability-main", text: "RAG 与 Agent 有什么区别？", technical: true, category: "技术理解", sourceType: "foundation", source: "匿名测试" }];
  return updateProjectFromSession(createInterviewProject(input, preparation), startSession(preparation));
}
const feedback = (label: string) => ({ strengths: [label], issues: ["请解释边界"], factRisks: [], suggestions: [], studyTopics: [], answerStructure: "概念→差异→应用", optimizedExample: "" });
async function open(page: Page, timeouts?: { coach: number; interviewer: number }, project = fixture()) {
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名测试", timeouts } }));
  await page.addInitScript(value => { if (!localStorage.getItem("ai-interview-projects-v1")) localStorage.setItem("ai-interview-projects-v1", JSON.stringify([value])); }, project);
  await page.goto("/"); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(page.getByText(/匿名测试/, { exact: false }).first()).toBeVisible();
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-projects-v1")!)[0].session);
const review = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "点评 → 重答 → 对比", exact: true }) }).last();

test("取消首次AI等待保留原回答，迟到结果不能成为当前点评且可主动重试", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  let cancelled = false;
  let lateReturned = false;
  await page.route("**/api/model/chat", async route => {
    if (route.request().postDataJSON().task === "interviewer") return route.fulfill({ json: { content: '{"action":"next"}' } });
    received = true;
    const first = !cancelled;
    if (first) await pending;
    await route.fulfill({ json: { content: JSON.stringify(feedback(first ? "不应显示的迟到点评" : "主动重试的新点评")) } }).catch(() => {});
    if (first) lateReturned = true;
  });
  await open(page);
  const answer = "匿名原回答：RAG检索外部知识，Agent我还不清楚。";
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(answer);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect.poll(() => received).toBe(true);
  await page.getByRole("button", { name: "取消AI等待", exact: true }).click({ timeout: 5000 });
  await expect(page.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
  expect((await saved(page)).turns[0].answer).toBe(answer);
  cancelled = true; release();
  await expect.poll(() => lateReturned).toBe(true);
  await expect(review(page).getByRole("heading", { name: "AI 教练反馈", exact: true })).toHaveCount(0);
  await review(page).getByRole("button", { name: "重试 AI 点评", exact: true }).click();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("主动重试的新点评");
  const session = await saved(page);
  expect(session.turns).toHaveLength(1); expect(session.turns[0].answer).toBe(answer);
  expect(session.turns[0].coachReviews).toHaveLength(1);
});

test("服务端配置的较短等待到期保留原答，主动重试不重复提交", async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  let retry = false;
  await page.route("**/api/model/chat", async route => {
    if (route.request().postDataJSON().task === "interviewer") return route.fulfill({ json: { content: '{"action":"next"}' } });
    received = true;
    if (!retry) await delayed;
    await route.fulfill({ json: { content: JSON.stringify(feedback("重试后完成点评")) } }).catch(() => {});
  });
  await page.clock.install(); await open(page, { coach: 5000, interviewer: 2000 });
  const original = "配置上限测试：RAG依赖检索提供知识。";
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(original);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect.poll(() => received).toBe(true);
  await page.clock.fastForward(6000);
  await expect(page.getByText("AI 点评未完成，目前显示的是本地辅助提示", { exact: true })).toBeVisible();
  expect((await saved(page)).turns[0].answer).toBe(original);
  await expect(review(page).getByText(/AI 请求超时/)).toBeVisible();
  retry = true; release();
  await review(page).getByRole("button", { name: "重试 AI 点评", exact: true }).click();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("重试后完成点评");
  expect((await saved(page)).turns).toHaveLength(1);
});

test("45秒反馈保存刷新、主问题与追问及重答点评精确隔离", async ({ page }, testInfo) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let firstCoach = false;
  await page.route("**/api/model/chat", async route => {
    const request = route.request().postDataJSON();
    const text = request.messages[1].content as string;
    if (request.task === "interviewer") return route.fulfill({ json: { content: JSON.stringify({ action: text.includes("追问原答") ? "next" : "follow_up", followUpQuestion: "Agent 可以怎样使用检索工具？" }) } });
    if (!firstCoach) { firstCoach = true; await delayed; }
    const label = text.includes("重答新版") ? "新版主问题点评" : text.includes("追问原答") ? "独立追问点评" : "主问题原版点评";
    await route.fulfill({ json: { content: JSON.stringify(feedback(label)) } });
  });
  await page.clock.install();
  await open(page);
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("主问题原答：RAG检索知识，Agent还不理解。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect.poll(() => firstCoach).toBe(true);
  await page.clock.fastForward(45_000); release();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("主问题原版点评");
  await openDetails(page, "保存我的回答思路");
  await review(page).getByRole("textbox", { name: "最终确认答案", exact: true }).fill("手工最终答案：检索获取知识，Agent根据目标调用工具。");
  await review(page).getByRole("button", { name: "保存最终答案", exact: true }).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("追问原答：Agent可以把检索作为获取知识的工具。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("独立追问点评");
  await review(page).getByRole("combobox", { name: "选择已回答的问题" }).selectOption("0");
  await review(page).getByRole("textbox", { name: "同题重答", exact: true }).fill("重答新版：RAG获取外部知识，Agent围绕任务动态调用工具。");
  await review(page).getByRole("button", { name: "保存重答并对比", exact: true }).click();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).not.toContainText("主问题原版点评");
  await review(page).getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("新版主问题点评");
  const before = await saved(page);
  expect(before.turns).toHaveLength(2);
  expect(before.turns[0].coachReviews.map((r: any) => r.answerVersion)).toEqual([1, 2]);
  expect(before.turns[1].coachReviews[0].feedback.strengths).toEqual(["独立追问点评"]);
  expect(before.turns[0].finalAnswer).toBe("手工最终答案：检索获取知识，Agent根据目标调用工具。");
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await review(page).getByRole("combobox", { name: "选择已回答的问题" }).selectOption("0");
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("新版主问题点评");
  expect(await saved(page)).toEqual(before);
  await review(page).getByRole("region", { name: "当前回答反馈" }).screenshot({ path: testInfo.outputPath("saved-after-45s-mock.png") });
});

test("已保存回答取消点评后可重答，旧请求不覆盖新版本或手工最终答案", async ({ page }) => {
  let item = fixture();
  item = updateProjectFromSession(item, nextTurn(item.session!, "原始已保存回答：检索知识后生成内容。", { action: "next" }));
  item.session!.turns[0].finalAnswer = "已有手工最终答案：保留个人确认内容。";
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  let lateReturned = false;
  let fresh = false;
  await page.route("**/api/model/chat", async route => {
    const first = !fresh;
    started = true;
    if (first) await delayed;
    await route.fulfill({ json: { content: JSON.stringify(feedback(first ? "旧版本迟到点评" : "新版本正确点评")) } }).catch(() => {});
    if (first) lateReturned = true;
  });
  await open(page, undefined, item);
  await review(page).getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await openDetails(page, "保存我的回答思路");
  await review(page).getByRole("textbox", { name: "最终确认答案", exact: true }).fill("等待时更新的手工最终答案：不得被AI覆盖。");
  await review(page).getByRole("button", { name: "保存最终答案", exact: true }).click();
  await page.getByRole("button", { name: "取消AI等待", exact: true }).click();
  await expect(review(page).getByText(/AI 请求已取消/)).toBeVisible();
  await review(page).getByRole("textbox", { name: "同题重答", exact: true }).fill("新的重答内容：检索外部知识辅助生成，并检查证据。");
  await review(page).getByRole("button", { name: "保存重答并对比", exact: true }).click();
  fresh = true; release(); await expect.poll(() => lateReturned).toBe(true);
  await expect(review(page).getByRole("heading", { name: "AI 教练反馈", exact: true })).toHaveCount(0);
  await review(page).getByRole("button", { name: "请求 AI 点评", exact: true }).click();
  await expect(review(page).getByRole("region", { name: "当前回答反馈" })).toContainText("新版本正确点评");
  const session = await saved(page);
  expect(session.turns[0].coachReviews).toHaveLength(1);
  expect(session.turns[0].coachReviews[0].answerVersion).toBe(2);
  expect(session.turns[0].finalAnswer).toBe("等待时更新的手工最终答案：不得被AI覆盖。");
});

test("等待时刷新恢复未完成回答草稿，不自动重试或保存迟到点评", async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let sent = 0;
  let lateReturned = false;
  await page.route("**/api/model/chat", async route => {
    sent++;
    if (route.request().postDataJSON().task === "interviewer") return route.fulfill({ json: { content: '{"action":"next"}' } });
    await delayed;
    await route.fulfill({ json: { content: JSON.stringify(feedback("刷新前旧结果")) } }).catch(() => {});
    lateReturned = true;
  });
  await open(page);
  const original = "刷新保留原文字：RAG检索资料，Agent还需要学习。";
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill(original);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect.poll(() => sent).toBe(2);
  await page.reload(); await page.getByRole("button", { name: "查看岗位", exact: true }).click(); await page.getByRole("button", { name: "面试训练", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本轮回答", exact: true })).toHaveValue(original);
  release(); await expect.poll(() => lateReturned).toBe(true);
  expect(sent).toBe(2);
  expect((await saved(page)).turns).toHaveLength(0);
  await expect(page.getByRole("heading", { name: "AI 教练反馈", exact: true })).toHaveCount(0);
});
