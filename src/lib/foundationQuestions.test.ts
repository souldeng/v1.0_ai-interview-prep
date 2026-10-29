import assert from "node:assert/strict";
import test from "node:test";
import { foundationQuestions, foundationToPracticeQuestion } from "./foundationQuestions";

test("内置题库为六类共 60 道非重复结构化学习题", () => {
  const counts = new Map<string, number>();
  for (const item of foundationQuestions) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    assert.ok(item.id && item.question && item.whyAsked && item.knowledgePoints.length && item.answerFramework.length && item.commonFollowUps.length && item.applicableRoles.length);
    assert.equal(foundationToPracticeQuestion(item).sourceType, "foundation");
  }
  assert.equal(foundationQuestions.length, 60);
  assert.deepEqual([...counts.values()], [15, 15, 10, 10, 5, 5]);
  assert.equal(new Set(foundationQuestions.map(item => item.question)).size, 60);
});
