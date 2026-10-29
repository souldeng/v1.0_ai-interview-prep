/** Presentation only: never infer provenance from question wording or today's profile. */
export function questionSourceLabel(question: { sourceType?: string; source?: string }): string {
  switch (question.sourceType) {
    case "jd": return "JD 要求";
    case "foundation": return "内置基础题";
    case "third_party": return "第三方面经";
    case "ai_follow_up": return "AI 追问";
    case "analysis_recommendation": return "AI 分析推荐";
    case "user_recorded": return "本人记录的真实面试问题";
    case "experience_practice": return "AI 经历专项题";
    case "material_derived": return "AI 资料衍生题";
    case "resume":
      if (question.source === "本地规则基于上一回答的追问") return "本地辅助追问";
      // Only an explicit provenance marker in the existing source field supports this label.
      if (question.source?.startsWith("已确认个人经历：") || question.source?.startsWith("已确认经历：")) return "已确认个人经历";
      return "历史个人背景线索";
    default: return "来源未确认";
  }
}
