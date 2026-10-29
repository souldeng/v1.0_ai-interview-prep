import { expect, test, type Page } from "@playwright/test";
import { openDetails } from "./uiActions";
import { createExperienceSet } from "../src/lib/experiencePractice";
import { emptyQuestionLibrary } from "../src/lib/questionLibrary";
import { emptyUserProfile } from "../src/lib/profileStorage";
import { experiencePracticeContext } from "../src/lib/experiencePractice";
import { trustedPreparation } from "../src/lib/trustedPreparation";
import { nextTurn, startSession } from "../src/lib/interview";
import { saveFinalAnswer } from "../src/lib/coaching";

const now = "2026-10-24T00:00:00Z";
const card = { id: "experience-anonymous", title: "匿名客户需求访谈", situation: "了解客户需求", action: "本人访谈客户并整理需求清单", result: "形成需求清单，没有负责模型研发或上线", reflection: "区分需求与方案", confirmed: true, createdAt: now, updatedAt: now };
const questions = ["你如何开展客户需求访谈？", "你如何整理需求清单？", "这次经历中你的职责边界是什么？"];
async function nav(page: Page, name: RegExp | string) {
  const menu = page.getByRole("button", { name: "打开导航" }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name }).first().click();
}
async function seed(page: Page) {
  await page.addInitScript(profile => {
    if (!localStorage.getItem("ai-interview-profile-v1")) localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile));
  }, { version: 1, supplementaryInfo: "", resumes: [], experiences: [card, { ...card, id: "another", title: "其他项目不可混入" }, { ...card, id: "unconfirmed", title: "待确认项目", confirmed: false }], updatedAt: now });
  await page.route("**/api/health", route => route.fulfill({ json: { modelConfigured: true, provider: "匿名模拟" } }));
}
test("经历入口生成题组、任意选题、保存刷新并返回复用，点评仅含所选事实", async ({ page }, info) => {
  await seed(page);
  let generated = 0;
  await page.route("**/api/model/chat", route => {
    const request = route.request().postDataJSON();
    const text = JSON.stringify(request.messages);
    expect(text).not.toContain("其他项目不可混入");
    expect(text).not.toContain("待确认项目");
    if (request.feature === "experience_question_generation") { generated++; return route.fulfill({ json: { content: JSON.stringify({ questions: questions.map(text => ({ text, basisQuote: card.action })) }) } }); }
    if (request.feature === "interview_followup") return route.fulfill({ json: { content: '{"action":"next"}' } });
    if (request.feature === "interview_feedback") return route.fulfill({ json: { content: JSON.stringify({ strengths: ["说明了整理步骤"], issues: ["可以说明判断依据"], suggestions: ["只说明本人职责"], factRisks: [], studyTopics: [], answerStructure: "说明行动和产物", optimizedExample: "模型研发和上线由同事负责。" }) } });
    throw new Error("专项练习不得重新调用选题模型");
  });
  await page.goto("/"); await nav(page, "个人资料 简历与经历");
  await page.getByRole("tab", { name: "我的经历" }).click();
  await page.screenshot({ path: info.outputPath("experience-before-or-entry.png"), fullPage: true });
  await page.locator("article").filter({ has: page.getByRole("heading", { name: card.title, exact: true }) }).getByRole("button", { name: "练习这段经历" }).click();
  await page.getByRole("button", { name: "生成专项题", exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[1], exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("experience-question-set.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("article").filter({ has: page.getByRole("heading", { name: questions[1], exact: true }) }).getByRole("button", { name: "开始练习", exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[1], exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("本人整理访谈记录并形成需求清单，没有负责模型研发或上线。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByText("说明了整理步骤", { exact: true })).toBeVisible();
  await expect(page.getByText("模型研发和上线由同事负责。", { exact: true })).toHaveCount(0);
  await openDetails(page, "保存我的回答思路");
  await page.getByRole("textbox", { name: "最终确认答案", exact: true }).fill("先说明本人整理动作，再说明需求清单和边界。");
  await page.getByRole("button", { name: "保存最终答案", exact: true }).click();
  await page.screenshot({ path: info.outputPath("experience-training.png"), fullPage: true });
  await page.getByRole("button", { name: "返回经历题组", exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[2], exact: true })).toBeVisible();
  await page.reload(); await nav(page, /AI 面试题库/);
  await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: card.title, exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[1], exact: true })).toBeVisible();
  expect(generated).toBe(1);
  await openDetails(page, "我的专项回答与复习");
  await expect(page.getByText("先说明本人整理动作，再说明需求清单和边界。", { exact: true })).toBeVisible();
});

test("已有训练取消不变，保存失败不启动，归档后原答最终思路和草稿仍可读", async ({ page }, info) => {
  await seed(page);
  const set = createExperienceSet(card, questions.map(text => ({ text, basisQuote: card.action })));
  const prep = trustedPreparation(experiencePracticeContext({ ...emptyUserProfile(), experiences: [card] }, set.questions[0]), [set.questions[0]]);
  const original = saveFinalAnswer(nextTurn(startSession(prep), "本人访谈客户并整理清单。", { action: "follow_up", followUpQuestion: "请说明职责边界。" }), 0, "本人确认的原思路");
  const draftKey = `answer:${original.id}:${original.questions[0].id}`;
  await page.addInitScript(({ set, original, draftKey }) => {
    if (!localStorage.getItem("ai-interview-question-library-v1")) {
      localStorage.setItem("ai-interview-question-library-v1", JSON.stringify({ version: 1, favorites: [], reuseDrafts: [], experienceSets: [set] }));
      localStorage.setItem("ai-interview-prep-history-v1", JSON.stringify([original]));
      localStorage.setItem("ai-interview-drafts-v1", JSON.stringify({ [draftKey]: "尚未提交的职责边界草稿" }));
    }
  }, { set, original, draftKey });
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: card.title, exact: true }).click();
  const before = await page.evaluate(() => [localStorage.getItem("ai-interview-prep-history-v1"), localStorage.getItem("ai-interview-drafts-v1")]);
  await page.getByRole("button", { name: "开始练习", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "保留当前训练", exact: true }).click();
  expect(await page.evaluate(() => [localStorage.getItem("ai-interview-prep-history-v1"), localStorage.getItem("ai-interview-drafts-v1")])).toEqual(before);
  await page.getByRole("button", { name: "开始练习", exact: true }).nth(1).click();
  await page.evaluate(() => { const saved = Storage.prototype.setItem; (window as any).restoreStorage = () => { Storage.prototype.setItem = saved; }; Storage.prototype.setItem = function(key, value) { if (key === "ai-interview-prep-history-v1") throw new Error("匿名训练保存失败"); saved.call(this,key,value); }; });
  const dialog = page.getByRole("dialog", { name: "开始新一轮训练" });
  await dialog.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  expect(await page.evaluate(() => localStorage.getItem("ai-interview-prep-history-v1"))).toBe(before[0]);
  await page.screenshot({ path: info.outputPath("experience-save-failure.png"), fullPage: true });
  await page.evaluate(() => (window as any).restoreStorage());
  await dialog.getByRole("button", { name: "保存旧轮次并开始", exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[1], exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-prep-history-v1")!));
  expect(saved).toHaveLength(2); expect(saved.find((s: any) => s.id === original.id)).toEqual(original);
  await page.getByRole("button", { name: "返回经历题组" }).click();
  await page.getByRole("button", { name: "开始练习", exact: true }).first().click();
  await page.getByRole("button", { name: "继续当前训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[1], exact: true })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem("ai-interview-drafts-v1")!)[key], draftKey)).toBe("尚未提交的职责边界草稿");
});

test("经历变更后生成失败保留旧题组，撤销确认后复练与点评不混入旧卡或其他卡", async ({ page }, info) => {
  await seed(page);
  const set = createExperienceSet(card, questions.map(text => ({ text, basisQuote: card.action })));
  await page.addInitScript(set => { if (!localStorage.getItem("ai-interview-question-library-v1")) localStorage.setItem("ai-interview-question-library-v1", JSON.stringify({ version: 1, favorites: [], reuseDrafts: [], experienceSets: [set] })); }, set);
  let generation = 0, feedback = 0;
  await page.route("**/api/model/chat", route => {
    const request = route.request().postDataJSON();
    if (request.feature === "experience_question_generation") { generation++; return route.fulfill({ status: 503, json: { error: "anonymous unavailable" } }); }
    const text = JSON.stringify(request.messages);
    // The question can mention the experience; the confirmed facts section must be empty.
    expect(text).toContain('A_用户本人已确认事实\\\":[]');
    expect(text).not.toContain("其他项目不可混入");
    if (request.feature === "interview_followup") return route.fulfill({ json: { content: '{"action":"next"}' } });
    feedback++; return route.fulfill({ status: 503, json: { error: "anonymous unavailable" } });
  });
  await page.goto("/");
  await page.evaluate(() => { const profile = JSON.parse(localStorage.getItem("ai-interview-profile-v1")!); profile.experiences[0].action = "修改后的访谈方法"; localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile)); });
  await page.reload(); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: card.title, exact: true }).click();
  await page.getByRole("button", { name: "生成专项题", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "503" })).toBeVisible();
  expect(generation).toBe(1);
  await openDetails(page, "历史题组"); await page.getByRole("button", { name: new RegExp(`${card.title} ·`) }).click();
  await expect(page.getByText(/旧事实不会进入/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("experience-old-set.png"), fullPage: true });
  await page.evaluate(() => { const profile = JSON.parse(localStorage.getItem("ai-interview-profile-v1")!); profile.experiences[0].confirmed = false; localStorage.setItem("ai-interview-profile-v1", JSON.stringify(profile)); });
  await page.getByRole("button", { name: "开始练习", exact: true }).nth(2).click();
  await page.getByRole("textbox", { name: "本轮回答", exact: true }).fill("我只说明本人职责，其他内容待确认。"); await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByText(/AI 点评未完成/).first()).toBeVisible();
  expect(feedback).toBe(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!));
  expect(saved.experienceSets).toEqual([set]);
});

test("题组写入失败原地重试保存，不重复生成且不覆盖既有题组", async ({ page }) => {
  await seed(page);
  const existing = createExperienceSet({ ...card, id: "another", title: "其他项目不可混入" }, questions.map(text => ({ text, basisQuote: card.action })));
  await page.addInitScript(state => { if (!localStorage.getItem("ai-interview-question-library-v1")) localStorage.setItem("ai-interview-question-library-v1", JSON.stringify(state)); }, { ...emptyQuestionLibrary(), experienceSets: [existing] });
  let requests = 0;
  await page.route("**/api/model/chat", route => { requests++; return route.fulfill({ json: { content: JSON.stringify({ questions: questions.map(text => ({ text, basisQuote: card.action })) }) } }); });
  await page.goto("/"); await nav(page, /AI 面试题库/); await page.getByRole("button", { name: "简历专项", exact: true }).click();
  await page.getByRole("button", { name: card.title, exact: true }).click();
  await page.evaluate(() => { const saved = Storage.prototype.setItem; (window as any).restoreStorage = () => { Storage.prototype.setItem = saved; }; Storage.prototype.setItem = function(key,value) { if (key === "ai-interview-question-library-v1") throw new Error("匿名题库配额失败"); saved.call(this,key,value); }; });
  await page.getByRole("button", { name: "生成专项题", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "配额失败" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试保存题组", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).experienceSets)).toEqual([existing]);
  await page.evaluate(() => (window as any).restoreStorage());
  await page.getByRole("button", { name: "重试保存题组", exact: true }).click();
  await expect(page.getByRole("heading", { name: questions[0], exact: true })).toBeVisible();
  expect(requests).toBe(1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).experienceSets);
  expect(stored).toHaveLength(2); expect(stored[0]).toEqual(existing);
});
