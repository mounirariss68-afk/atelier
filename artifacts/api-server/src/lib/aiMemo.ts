import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AssessmentDefinition, ProfileInput, ScoreResult } from "@workspace/assessments";
import { TIER_INTERPRETATION } from "@workspace/assessments";
import { logger } from "./logger";

interface MemoArgs {
  def: AssessmentDefinition;
  profile: ProfileInput;
  result: ScoreResult;
}

function buildSystemPrompt(args: MemoArgs): string {
  const { def, profile, result } = args;
  return `You are writing a 1-page executive memo signed by the two founders of Cognirise — a boutique GCC AI advisory and engineering firm.

Tone: senior, McKinsey-grade, direct, candid. No fluff. No bullet-list filler. Numbers where possible. Speak like a partner who has run 20 of these engagements.

Audience: ${profile.role} at ${profile.company} (${profile.industry}, ${profile.country}).

Assessment: ${def.code} — ${def.title.en}.
Overall score: ${result.overallScore}/5 (Tier: ${result.tier}). Sovereign sub-score: ${result.sovereignSubScore.score}/5.
Tier interpretation: ${TIER_INTERPRETATION[result.tier].en}

Strengths (where they lead): ${result.strengths.join(", ") || "none flagged"}
Gaps (where they need to focus): ${result.gaps.join(", ") || "none flagged"}
Anti-patterns detected: ${result.antiPatterns.map((p) => p.label.en).join(" | ") || "none"}
Cost-of-inaction estimate: $${result.costOfInaction.ebitDeltaUsd.toLocaleString()} EBIT lift forfeited + $${result.costOfInaction.costDeltaUsd.toLocaleString()} avoidable cost in the next 12 months.
Anti-vendor honesty point we always say: ${def.antiVendor.en[0] ?? ""}

Specific framing for this assessment: ${def.memoPromptHint}

Write 4 short paragraphs (~80 words each):
1) The candid headline — where they actually stand vs. their GCC peers, and the one thing the score is really telling them.
2) The 90-day move — the single specific action with the highest leverage now, and why we'd pick it.
3) The 6-12 month strategic shift — what changes structurally if they take this seriously.
4) The honesty paragraph — the trade-off, the risk, or the thing a vendor would not tell them.

End with: "— The Cognirise partnership"

Output PLAIN TEXT only. No markdown, no headers, no asterisks. Each paragraph separated by a blank line. Maximum 380 words total.`;
}

export async function generateExecutiveMemo(args: MemoArgs, language: "en" | "ar" | "tr" = "en"): Promise<string> {
  const prompt = buildSystemPrompt(args);
  const userInstr =
    language === "ar"
      ? "Write the memo in modern standard Arabic (فصحى), executive register, fully translated."
      : language === "tr"
        ? "Write the memo in formal executive Turkish (Türkçe), fully translated. Use a senior, candid partner register."
        : "Write the memo in English.";

  try {
    const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
    const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
    if (baseURL && apiKey) {
      const anth = new Anthropic({ baseURL, apiKey });
      const resp = await anth.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1200,
        system: prompt,
        messages: [{ role: "user", content: userInstr }],
      });
      const text = resp.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      if (text) return text;
    }
  } catch (err) {
    logger.warn({ err }, "Anthropic memo generation failed; falling back to OpenAI");
  }

  try {
    const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
    const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
    if (baseURL && apiKey) {
      const oa = new OpenAI({ baseURL, apiKey });
      const resp = await oa.chat.completions.create({
        model: "gpt-5",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userInstr },
        ],
      });
      const text = resp.choices[0]?.message?.content?.trim() ?? "";
      if (text) return text;
    }
  } catch (err) {
    logger.warn({ err }, "OpenAI memo fallback failed; using template");
  }

  return buildTemplateMemo(args, language);
}

function buildTemplateMemo(args: MemoArgs, language: "en" | "ar" | "tr"): string {
  const { def, profile, result } = args;
  if (language === "ar") {
    return [
      `الموقع الصريح: نتيجة ${profile.company} الإجمالية في ${def.title.ar} هي ${result.overallScore}/5 (مستوى: ${result.tier}). هذا يضعكم في الموقع المتوسط بين أقران الخليج، مع نقاط ضعف مرئية في ${result.gaps.join("، ") || "لا شيء بارز"}.`,
      `أهم تحرك خلال 90 يوماً: ${result.recommendations.quickWins90d[0]?.ar ?? "تحديد راعٍ تنفيذي بصلاحية P&L."}. هذا التحرك يفك أكبر اختناق في وضعكم الحالي بأقل تكلفة.`,
      `التحول الاستراتيجي خلال 6–12 شهراً: ${result.recommendations.strategic12m[0]?.ar ?? "نقل القدرة من المختبر إلى الإنتاج."} يفعل ${"$" + result.costOfInaction.ebitDeltaUsd.toLocaleString()} من القيمة المتروكة على الطاولة.`,
      `الحقيقة التي لن يخبركم بها مزود: ${def.antiVendor.ar[0] ?? "نتائجكم ليست مشكلة تقنية، بل مشكلة نموذج تشغيل وحوكمة."}`,
      "— شراكة Cognirise",
    ].join("\n\n");
  }
  if (language === "tr") {
    const trTitle = def.title.tr ?? def.title.en;
    const trQuick = result.recommendations.quickWins90d[0]?.tr ?? result.recommendations.quickWins90d[0]?.en ?? "P&L yetkisine sahip bir üst düzey sponsor belirleyin.";
    const trStrategic = result.recommendations.strategic12m[0]?.tr ?? result.recommendations.strategic12m[0]?.en ?? "Ajansal yeteneği laboratuvardan üretime taşıyın.";
    const trAntiVendor = def.antiVendor.tr?.[0] ?? def.antiVendor.en[0] ?? "Skorunuz teknoloji sorunu değil, operasyonel model ve yönetişim sorununu yansıtıyor.";
    return [
      `Net duruşunuz: ${profile.company} şirketinin ${trTitle} genel skoru ${result.overallScore}/5 (Seviye: ${result.tier}). Bu sizi Körfez emsal bandının ortasına yerleştiriyor; belirgin zayıflıklar: ${result.gaps.join(", ") || "öne çıkan bir boyut yok"}.`,
      `90 günlük hamle: ${trQuick} Bu, mevcut işletim modelinizdeki en büyük kısıtı en düşük maliyetle açar.`,
      `6–12 aylık dönüşüm: ${trStrategic} Bu, şu anda masada bırakılan ${"$" + result.costOfInaction.ebitDeltaUsd.toLocaleString()} değerini harekete geçirir.`,
      `Dürüst paragraf: ${trAntiVendor}`,
      "— Cognirise ortaklığı",
    ].join("\n\n");
  }
  return [
    `Where you actually stand: ${profile.company}'s overall ${def.code} score is ${result.overallScore}/5 (Tier: ${result.tier}). That places you in the middle of the GCC peer band, with visible weakness in ${result.gaps.join(", ") || "no specific dimension flagged"}.`,
    `The 90-day move: ${result.recommendations.quickWins90d[0]?.en ?? "Name an executive sponsor with P&L authority for one priority use case."} This unlocks the biggest constraint in your current operating model at the lowest cost.`,
    `The 6–12 month shift: ${result.recommendations.strategic12m[0]?.en ?? "Move agentic capability from lab to production."} This is what activates the ${"$" + result.costOfInaction.ebitDeltaUsd.toLocaleString()} of value currently left on the table.`,
    `The honesty paragraph: ${def.antiVendor.en[0] ?? "Your scores reflect an operating-model problem, not a technology problem. No platform purchase will move this number."}`,
    "— The Cognirise partnership",
  ].join("\n\n");
}
