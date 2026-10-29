import assert from "node:assert/strict";
import { test } from "node:test";
import { appendExperienceQuestions, createExperienceSet, currentExperienceSet, visibleExperienceQuestions, setExperienceQuestionHidden } from "./experiencePractice";
import { emptyQuestionLibrary, saveQuestionLibrary, loadQuestionLibrary } from "./questionLibrary";

const card = { id: "exp", title: "匿名访谈", situation: "了解需求", action: "访谈客户并形成清单", result: "未负责上线", reflection: "明确职责", confirmed: true, createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z" };
const inputs = ["如何访谈客户？", "如何整理清单？", "如何明确职责？"].map(text => ({ text, basisQuote: card.action }));
test("同版本重新生成优先展示新组；追加去重、删除撤销和刷新不改旧题", () => {
  const old = createExperienceSet(card, inputs), newer = createExperienceSet(card, inputs);
  assert.equal(currentExperienceSet({ ...emptyQuestionLibrary(), experienceSets: [old, newer] }, card)?.id, newer.id);
  const appended = appendExperienceQuestions(newer, card, [inputs[0], { text: "访谈遇到什么困难？", basisQuote: card.action }]);
  assert.equal(appended.added, 1);
  assert.equal(appended.set.questions.length, 4);
  assert.deepEqual(appended.set.questions.slice(0, 3), newer.questions);
  const removed = setExperienceQuestionHidden(appended.set, newer.questions[0].id, true);
  assert.equal(visibleExperienceQuestions(removed).length, 3);
  assert.equal(removed.questions[0].id, newer.questions[0].id);
  const data = new Map<string, string>(); const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k,v); }, removeItem: (k: string) => { data.delete(k); } };
  saveQuestionLibrary({ ...emptyQuestionLibrary(), experienceSets: [old, removed] }, storage);
  const restored = loadQuestionLibrary(storage).experienceSets!;
  assert.deepEqual(restored[0], old);
  assert.equal(visibleExperienceQuestions(restored[1]).length, 3);
  assert.equal(visibleExperienceQuestions(setExperienceQuestionHidden(restored[1], newer.questions[0].id, false)).length, 4);
  assert.throws(() => appendExperienceQuestions(newer, { ...card, confirmed: false }, inputs), /确认|变化/);
});
test("当前题组20题上限不静默删除旧题；撤销确认与不同内容不能追加", () => {
  let set = createExperienceSet(card,inputs);
  for(let i=0;i<4;i++)set=appendExperienceQuestions(set,card,Array.from({length:5},(_,j)=>({text:`访谈步骤${i}-${j}如何判断？`,basisQuote:card.action}))).set;
  assert.equal(visibleExperienceQuestions(set).length,20);
  assert.throws(()=>appendExperienceQuestions(set,card,[{text:"新的问法？",basisQuote:card.action}]),/20/);
  assert.equal(set.questions.length,20);
  assert.throws(()=>appendExperienceQuestions(createExperienceSet(card,inputs),{...card,action:"已变更"},inputs),/变化/);
  const base=createExperienceSet(card,inputs);
  const historical=Array.from({length:196},(_,i)=>({...base.questions[0],id:`old-${i}`,text:`旧问题${i}？`}));
  const nearHistoryLimit={...base,questions:[...base.questions,...historical],hiddenQuestionIds:historical.map(q=>q.id)};
  const last=appendExperienceQuestions(nearHistoryLimit,card,["新判断甲？","新判断乙？","新判断丙？"].map(text=>({text,basisQuote:card.action})));
  assert.equal(last.added,1);assert.equal(last.set.questions.length,200);
});
