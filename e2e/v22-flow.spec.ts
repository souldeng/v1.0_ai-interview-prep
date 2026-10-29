import { libraryArea, openDetails } from "./uiActions";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function openNavigation(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  if (name === "AI 面试题库") await libraryArea(page, "foundation");
}

async function createJob(page: Page) {
  await openNavigation(page, "我的岗位");
  await page.getByRole("button", { name: /创建岗位/ }).first().click();
  await page.getByPlaceholder("例如：AI 产品经理").fill("匿名 V2.2 岗位");
  await page.getByPlaceholder("粘贴完整的岗位职责与任职要求").fill("负责 AI 产品需求分析与客户沟通。");
  await page.getByRole("button", { name: "创建岗位准备方案" }).click();
  await page.getByRole("button", { name: "岗位资料", exact: true }).click();
}

async function image(browser: Browser, text: string) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 850, height: 220 });
  await page.setContent(`<html lang="zh"><body style="margin:20px;background:white;font:36px sans-serif">${text}</body></html>`);
  const buffer = await page.screenshot({ type: "png" });
  await page.close();
  return buffer;
}

test.describe("V2.2 匿名隔离流程", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "批量 OCR/语音隔离检查只在桌面 Chromium 执行");
    await page.goto("/");
  });

  test("多图分组核对、分类与 IndexedDB 原件刷新恢复", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await createJob(page);
    await page.route(/cdn\.jsdelivr\.net/, route => route.abort());
    const input = page.locator('input[type="file"][aria-label="选择岗位资料文件"]');
    await input.setInputFiles([
      { name: "一.png", mimeType: "image/png", buffer: await image(browser, "匿名岗位要求") },
      { name: "二.png", mimeType: "image/png", buffer: await image(browser, "他人的面试经历") },
      { name: "三.png", mimeType: "image/png", buffer: await image(browser, "面经第二张") },
    ]);
    await expect(page.getByRole("heading", { name: "集中核对" })).toBeVisible();
    for (const name of ["一.png", "二.png", "三.png"]) {
      await expect(page.getByRole("button", { name: new RegExp(name) }).first()).toBeVisible();
      // This scenario exercises manual recovery AFTER OCR fails, not editing during an active OCR task.
      await expect(page.getByRole("button", { name: new RegExp(name) }).first().locator("../..")).toContainText("OCR 失败");
    }
    await page.getByRole("button", { name: "上移 三.png" }).click();
    await expect(page.getByRole("button", { name: /2\. 三\.png/ })).toBeVisible();
    for (const [name, value] of [["一.png", "需要 AI 产品经验"], ["二.png", "他人落地 20 个项目"], ["三.png", "曾被问及 RAG 评测"]] as const) {
      await page.getByRole("button", { name: new RegExp(name) }).first().click();
      await page.getByRole("textbox", { name: "当前文件核对文字" }).fill(value);
      await page.getByRole("button", { name: "确认当前文字" }).click();
    }
    await page.getByRole("checkbox", { name: "选择 二.png" }).uncheck();
    await page.getByRole("checkbox", { name: "选择 三.png" }).uncheck();
    await page.getByRole("textbox", { name: "资料名称" }).fill("匿名 JD 截图");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failOnce = true;
      Storage.prototype.setItem = function (key, value) {
        if (key === "ai-interview-projects-v1" && failOnce) { failOnce = false; throw new DOMException("匿名容量失败", "QuotaExceededError"); }
        return original.call(this, key, value);
      };
    });
    await page.getByRole("button", { name: "保存所选 1 项为一份资料" }).click();
    await expect(page.getByRole("status")).toContainText("匿名容量失败");
    await expect(page.getByRole("textbox", { name: "当前文件核对文字" })).toHaveValue("曾被问及 RAG 评测");
    await expect(page.getByRole("checkbox", { name: "选择 一.png" })).toBeChecked();
    await page.getByRole("button", { name: "保存所选 1 项为一份资料" }).click();
    await expect(page.getByRole("heading", { name: "匿名 JD 截图" })).toBeVisible();
    await page.getByRole("checkbox", { name: "选择 二.png" }).check();
    await page.getByRole("checkbox", { name: "选择 三.png" }).check();
    await page.getByRole("textbox", { name: "资料名称" }).fill("匿名长面经");
    await page.getByRole("combobox", { name: "保存分类" }).selectOption("interview_experience");
    await page.getByRole("button", { name: "保存所选 2 项为一份资料" }).click();
    await expect(page.getByRole("heading", { name: "匿名长面经" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "匿名 V2.2 岗位" }).first()).toBeVisible();
    await page.getByRole("button", { name: "查看岗位" }).click();
    await page.getByRole("button", { name: "岗位资料", exact: true }).click();
    await page.getByRole("heading", { name: "匿名长面经" }).locator("../..").getByRole("button", { name: "查看 / 编辑" }).click();
    await expect(page.getByRole("textbox", { name: "核对文字" }).first()).toHaveValue("曾被问及 RAG 评测");
    await expect(page.getByRole("img", { name: "三.png 原图" })).toBeVisible();
    const ids = await page.evaluate(async () => {
      const opened = indexedDB.open("ai-interview-material-files-v1", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { const request = db.transaction("files").objectStore("files").getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close(); return keys;
    });
    expect(ids).toHaveLength(3);
    await page.getByRole("button", { name: "岗位分析", exact: true }).click();
    const userFacts = page.locator("section").filter({ has: page.getByRole("heading", { name: "基于已确认经历的分析" }) }).first();
    await expect(userFacts.locator("table")).toHaveCount(0);
    await page.getByText("岗位来源范围", { exact: true }).click();
    await expect(page.getByText("已确认经历卡：0 张", { exact: true })).toBeVisible();
    await expect(userFacts).not.toContainText("他人落地 20 个项目");
    await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "第三方面经：仅作准备参考" }) })).toContainText("他人落地 20 个项目");
    await page.evaluate(async () => {
      const opened = indexedDB.open("ai-interview-material-files-v1", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ id: "personal-anonymous-original", blob: new Blob(["personal"]), name: "personal.txt", type: "text/plain", size: 8, createdAt: new Date().toISOString() });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.getByRole("button", { name: "岗位资料", exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("heading", { name: "匿名 JD 截图" }).locator("../..").getByRole("button", { name: "删除" }).click();
    await expect(page.getByRole("heading", { name: "匿名 JD 截图" })).toHaveCount(0);
    const remainingIds = await page.evaluate(async () => {
      const opened = indexedDB.open("ai-interview-material-files-v1", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { const request = db.transaction("files").objectStore("files").getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close(); return keys;
    });
    expect(remainingIds).toHaveLength(3);
    expect(remainingIds).toContain("personal-anonymous-original");
  });

  test("旧岗位资料缺少 Blob 时提示重传，旧版 data URL 图片副本仍可预览", async ({ page, browser }) => {
    await createJob(page);
    const legacyImage = `data:image/png;base64,${(await image(browser, "旧版图片副本")).toString("base64")}`;
    await page.evaluate(dataUrl => {
      const projects = JSON.parse(localStorage.getItem("ai-interview-projects-v1") || "[]");
      const project = projects[0];
      const now = new Date().toISOString();
      project.materials = [
        { id: "legacy-text", kind: "interview_experience", title: "旧资料仅文字", content: "他人面经原文", source: "manual_text", createdAt: now, updatedAt: now },
        { id: "legacy-image", kind: "interview_experience", title: "旧版截图", content: "旧 OCR 文字", source: "screenshot", sourceDataUrl: dataUrl, sourceFileName: "旧图.png", sourceMimeType: "image/png", createdAt: now, updatedAt: now },
      ];
      localStorage.setItem("ai-interview-projects-v1", JSON.stringify(projects));
    }, legacyImage);
    await page.reload();
    await page.getByRole("button", { name: "查看岗位" }).click();
    await page.getByRole("button", { name: "岗位资料", exact: true }).click();
    await expect(page.getByText("原文件未保存，可继续使用已有文字；如需查看原件，请重新上传。")).toBeVisible();
    await page.getByRole("heading", { name: "旧版截图" }).locator("../..").getByRole("button", { name: "查看 / 编辑" }).click();
    await expect(page.getByRole("img", { name: "旧图.png 旧版图片副本" })).toBeVisible();
  });

  test("无 JD 时内置题先学习、隐藏提示并练习保存最终答案", async ({ page }) => {
    await openNavigation(page, "AI 面试题库");
    await expect(page.getByText("60 道内置学习与练习题")).toBeVisible();
    await page.getByRole("textbox", { name: "搜索内置题" }).fill("RAG");
    await expect(page.getByText("为什么问：")).toBeVisible();
    await page.getByRole("button", { name: "开始回答", exact: true }).click();
    await expect(page.getByText("答案提示已隐藏")).toBeVisible();
    await page.getByRole("button", { name: "进入回答练习" }).click();
    await expect(page.getByRole("textbox", { name: "本轮回答" })).toBeVisible();
    await page.getByRole("textbox", { name: "本轮回答" }).fill("我会先明确问题和知识范围，再说明检索、生成与评测的基本流程。");
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByRole("heading", { name: "点评 → 重答 → 对比" })).toBeVisible();
  await openDetails(page, "保存我的回答思路");
    await page.getByRole("textbox", { name: "最终确认答案" }).fill("RAG 应先有可信知识来源，再评估检索命中和生成回答的准确性。");
    await page.getByRole("button", { name: "保存最终答案" }).click();
    await expect(page.getByText("最终确认答案已保存；原回答和重答未被覆盖。")).toBeVisible();
    await page.reload();
    await openNavigation(page, "AI 面试题库");
  await openDetails(page, "保存我的回答思路");
    await expect(page.getByRole("textbox", { name: "最终确认答案" })).toHaveValue("RAG 应先有可信知识来源，再评估检索命中和生成回答的准确性。");
  });

  test("语音识别不可用时保留文字输入和题目朗读入口", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true }); Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true }); });
    await page.reload();
    await openNavigation(page, "AI 面试题库");
    await page.getByRole("button", { name: "开始回答", exact: true }).click();
    await page.getByRole("button", { name: "进入回答练习" }).click();
    await page.getByRole("button", { name: /语音输入/ }).click();
    await expect(page.getByRole("status")).toContainText("此浏览器不支持语音识别");
    await page.getByRole("textbox", { name: "本轮回答" }).fill("语音不可用时仍可正常输入文字作答。");
    await expect(page.getByRole("textbox", { name: "本轮回答" })).toHaveValue("语音不可用时仍可正常输入文字作答。");
    await expect(page.getByRole("button", { name: /朗读问题/ })).toBeVisible();
  });

  test("模拟语音识别只插入可编辑文字，不自动提交", async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition {
        onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
        onerror = null;
        onend: (() => void) | null = null;
        start() { window.setTimeout(() => { this.onresult?.({ results: [{ 0: { transcript: "匿名语音回答" } }] }); this.onend?.(); }, 0); }
        stop() { this.onend?.(); }
      }
      Object.defineProperty(window, "SpeechRecognition", { value: FakeRecognition, configurable: true });
      Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeRecognition, configurable: true });
    });
    await page.reload();
    await openNavigation(page, "AI 面试题库");
    await page.getByRole("button", { name: "开始回答", exact: true }).click();
    await page.getByRole("button", { name: "进入回答练习" }).click();
    await page.getByRole("textbox", { name: "本轮回答" }).fill("已有文字草稿");
    await page.getByRole("button", { name: /语音输入/ }).click();
    await expect(page.getByRole("textbox", { name: "本轮回答" })).toHaveValue("已有文字草稿\n匿名语音回答");
    await expect(page.getByRole("button", { name: "提交回答" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "点评 → 重答 → 对比" })).toHaveCount(0);
  });
});
