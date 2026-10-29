import assert from "node:assert/strict";
import test from "node:test";
import type { JobMaterialPart } from "./domain";
import { combinedMaterialText, createReviewedJobMaterial, usableMaterial } from "./jobMaterialFlow";
import { validJobMaterial } from "./validation";

const now = "2026-10-12T00:00:00.000Z";
const part = (name: string, text: string): JobMaterialPart => ({ id: name, fileId: `job-${name}`, fileName: name, mimeType: "image/png", size: 100, initialText: `初始${name}`, reviewedText: text, originalSaved: true });

test("多图按用户调整后的顺序合并，保留逐图初始与核对文字", () => {
  const parts = [part("2.png", "第二页修改"), part("1.png", "第一页修改")];
  const material = createReviewedJobMaterial({ id: "material-1", projectId: "job-1", title: "长面经", kind: "interview_experience", parts, now });
  assert.equal(material.projectId, "job-1");
  assert.equal(material.parts?.[0].initialText, "初始2.png");
  assert.equal(material.content, combinedMaterialText(parts));
  assert.ok(material.content.indexOf("第二页修改") < material.content.indexOf("第一页修改"));
  assert.equal(validJobMaterial(material), true);
});

test("未核对的新旧资料都不进入正式使用范围，旧文字仍可读取", () => {
  const material = createReviewedJobMaterial({ id: "material-2", projectId: "job-1", title: "JD", kind: "job_description", parts: [part("jd.png", "需要 3 年 AI 项目经验")], now });
  assert.equal(usableMaterial(material), true);
  assert.equal(usableMaterial({ ...material, reviewedAt: undefined }), false);
  assert.equal(usableMaterial({ ...material, parts: undefined, reviewedAt: undefined }), false);
  assert.throws(() => createReviewedJobMaterial({ id: "m", projectId: "j", title: "", kind: "reference", parts: [part("x", "文本")], now }));
});
