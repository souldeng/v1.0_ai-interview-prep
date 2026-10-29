import assert from "node:assert/strict";
import { test } from "node:test";
import { createExperienceSet, currentExperienceSet, experiencePracticeContext } from "./experiencePractice";
import { emptyQuestionLibrary, loadQuestionLibrary, saveQuestionLibrary } from "./questionLibrary";
import { emptyUserProfile } from "./profileStorage";
import type { ExperienceCard } from "./domain";
import { exportBackup, importBackup } from "./backup";
import { PROFILE_KEY, saveUserProfile, loadUserProfile } from "./profileStorage";
import { nextTurn, startSession } from "./interview";
import { trustedPreparation } from "./trustedPreparation";

export const card: ExperienceCard = { id: "experience-anonymous", title: "客户需求访谈", situation: "了解客户需求", action: "本人访谈客户并整理需求清单", result: "形成需求清单，没有负责模型研发或上线", reflection: "区分需求与方案", confirmed: true, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" };
const questions = ["你如何开展客户需求访谈？", "你如何整理需求清单？", "这次经历中你的职责边界是什么？"].map(text => ({ text, basisQuote: "本人访谈客户并整理需求清单" }));

test("已确认经历题组读回后复用同内容版本，其他经历或撤销确认不复用旧事实", () => {
  const data = new Map<string,string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key,value); }, removeItem: (key: string) => { data.delete(key); } };
  const set = createExperienceSet(card, questions);
  saveQuestionLibrary({ ...emptyQuestionLibrary(), experienceSets: [set] }, storage);
  const restored = loadQuestionLibrary(storage);
  assert.equal(currentExperienceSet(restored, { ...card, updatedAt: "2026-10-25T00:00:00Z" })?.id, set.id);
  assert.equal(currentExperienceSet(restored, { ...card, id: "another" }), undefined);
  assert.equal(currentExperienceSet(restored, { ...card, action: "不同的行动" }), undefined);
  const profile = { ...emptyUserProfile(), experiences: [card, { ...card, id: "other", title: "其他秘密项目" }] };
  assert.equal(experiencePracticeContext(profile, set.questions[1]).confirmedUserFacts.length, 1);
  assert.doesNotMatch(JSON.stringify(experiencePracticeContext(profile, set.questions[1])), /其他秘密项目/);
  assert.deepEqual(experiencePracticeContext({ ...profile, experiences: [{ ...card, confirmed: false }] }, set.questions[1]).confirmedUserFacts, []);
  assert.deepEqual(experiencePracticeContext({ ...profile, experiences: [{ ...card, action: "已改的新事实" }] }, set.questions[1]).confirmedUserFacts, []);
  assert.deepEqual(experiencePracticeContext(emptyUserProfile(), set.questions[1]).confirmedUserFacts, []);
  assert.throws(() => createExperienceSet({ ...card, confirmed: false }, questions), /确认/);
});

test("专项点评保留所选经历末尾责任边界，不因前段较长而截掉否定事实", () => {
  const long = { ...card, situation: "匿名业务背景。".repeat(200) };
  const set = createExperienceSet(long, questions);
  assert.match(experiencePracticeContext({ ...emptyUserProfile(), experiences: [long] }, set.questions[0]).confirmedUserFacts.join("\n"), /没有负责模型研发或上线/);
});

test("题组随原备份恢复为独立副本且训练指向副本经历；损坏题组拒绝覆盖", () => {
  const data = new Map<string,string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key,value); }, removeItem: (key: string) => { data.delete(key); } };
  const set = createExperienceSet(card, questions);
  saveQuestionLibrary({ ...emptyQuestionLibrary(), experienceSets: [set] }, storage);
  saveUserProfile({ ...emptyUserProfile(), experiences: [card] }, storage);
  const session = nextTurn(startSession(trustedPreparation(experiencePracticeContext(loadUserProfile(storage), set.questions[0]), [set.questions[0]])), "原回答不能丢失", { action: "next" });
  storage.setItem("ai-interview-prep-history-v1", JSON.stringify([session]));
  const before = storage.getItem("ai-interview-question-library-v1");
  assert.throws(() => saveQuestionLibrary({ ...emptyQuestionLibrary(), experienceSets: [{ ...set, questions: [] }] }, storage), /无效/);
  assert.equal(storage.getItem("ai-interview-question-library-v1"), before);
  importBackup(exportBackup(storage), storage);
  const sets = loadQuestionLibrary(storage).experienceSets!;
  assert.equal(sets.length, 2);
  const copy = sets.find(item => item.id !== set.id)!;
  assert.notEqual(copy.experienceId, card.id);
  const profile = loadUserProfile(storage);
  assert.equal(profile.experiences.find(item => item.id === copy.experienceId)?.title, card.title);
  const history = JSON.parse(storage.getItem("ai-interview-prep-history-v1")!);
  assert.equal(history[1].preparation.questions[0].experienceOrigin.setId, copy.id);
  assert.equal(history[1].turns[0].questionId, copy.questions[0].id);
  assert.equal(history[1].turns[0].answer, "原回答不能丢失");
  assert.equal(experiencePracticeContext(profile, copy.questions[0]).confirmedUserFacts.length, 1);
  importBackup(JSON.stringify({ format: "ai-interview-prep-backup", version: 1, projects: [], history: [], drafts: {} }), storage);
  assert.equal(loadQuestionLibrary(storage).experienceSets!.length, 2);
  assert.ok(storage.getItem(PROFILE_KEY));
});
