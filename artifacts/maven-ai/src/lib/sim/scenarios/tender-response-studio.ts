/**
 * Tender Response Studio — full scripted run.
 *
 * Day 0, 08:30. A 220-page Etimad-style mega-tender lands in the bid
 * inbox with a 14-day window. The bid-conductor runs RFP Ingestor →
 * Qualifier (Bid/No-Bid checkpoint) → 5 parallel Section Drafters →
 * Pricing Modeller (CFO checkpoint) → Partner Outreach → Legal
 * Reviewer (release checkpoint) → Packet Compiler.
 */

import type { Scenario } from "../types";

const tenderScenario: Scenario = {
  slug: "tender-response-studio",
  toolTitle: { en: "Tender Response Studio", ar: "استوديو الاستجابة للمناقصات" },
  accent: "#8A5BD6",
  description: {
    en: "A bid-conductor orchestrates RFP intake, qualifier, parallel section drafters, pricing modeller, partner outreach, legal reviewer, and packet compiler — pausing at three named human checkpoints (bid/no-bid, pricing sign-off, legal release).",
    ar: "منسّق العطاء يدير الاستلام والمُقيّم وكتّاب الأقسام بالتوازي ومحاكي التسعير وتواصل الشركاء والمراجع القانوني ومُجمّع الحزمة — مع ثلاث نقاط موافقة بشرية.",
  },
  buyer: { en: "Head of Bid Management", ar: "رئيس إدارة العطاءات" },
  trigger: { en: "Etimad-style 220-page mega-tender lands 14 days before submission.", ar: "وصول مناقصة كبرى 220 صفحة قبل 14 يوماً من التقديم." },
  agents: [
    { id: "orch", name: { en: "Bid Conductor", ar: "منسّق العطاء" }, role: { en: "Plans the response and gates every checkpoint.", ar: "يخطّط الاستجابة ويراقب النقاط." }, kind: "orchestrator", color: "#8A5BD6" },
    { id: "ingest", name: { en: "RFP Ingestor", ar: "محلّل كرّاسة الشروط" }, role: { en: "Parses the RFP into a requirement matrix.", ar: "يحلّل كرّاسة الشروط إلى مصفوفة." }, kind: "retriever", color: "#5B7CFF" },
    { id: "qualifier", name: { en: "Qualifier", ar: "المُقيّم" }, role: { en: "Recommends bid or no-bid with rationale.", ar: "يوصي بقرار التقديم." }, kind: "scorer", color: "#C45BB8" },
    { id: "drafter", name: { en: "Section Drafters (×5)", ar: "كتّاب الأقسام (×5)" }, role: { en: "Parallel lanes draft each section from precedent.", ar: "مسارات متوازية تصوغ الأقسام." }, kind: "drafter", color: "#5BA98A" },
    { id: "pricing", name: { en: "Pricing Modeller", ar: "محاكي التسعير" }, role: { en: "Builds 3 scenarios with margin sensitivity.", ar: "يبني 3 سيناريوهات مع حساسية الهامش." }, kind: "scorer", color: "#5C8CA8" },
    { id: "partner", name: { en: "Partner Outreach", ar: "تواصل الشركاء" }, role: { en: "Drafts and chases LoS letters from required partners.", ar: "يصوغ ويتابع رسائل دعم الشركاء." }, kind: "drafter", color: "#C45BB8" },
    { id: "legal", name: { en: "Legal Reviewer", ar: "المراجع القانوني" }, role: { en: "Red-teams every clause against the library.", ar: "يراجع كل بند مقابل المكتبة." }, kind: "critic", color: "#D9534F" },
    { id: "compiler", name: { en: "Packet Compiler", ar: "مُجمّع الحزمة" }, role: { en: "Stitches the final submission packet.", ar: "يجمع حزمة التقديم." }, kind: "compiler", color: "#0A1230" },
  ],
  tools: [
    { name: "parse_rfp", description: { en: "Parses RFP PDF into sections, deadlines, requirements.", ar: "يحلّل كرّاسة الشروط إلى أقسام ومتطلبات." } },
    { name: "score_fit_to_win", description: { en: "Scores capability × past performance × pricing headroom × partner fit.", ar: "يصنّف الجدارة وسابق الأعمال وهامش التسعير ومدى الشريك." } },
    { name: "draft_section", description: { en: "Drafts one RFP section from precedent + requirements.", ar: "يصوغ قسماً من السابقة والمتطلبات." } },
    { name: "model_pricing", description: { en: "Models aggressive / base / floor scenarios.", ar: "يبني سيناريوهات قاع/أساس/طموح." } },
    { name: "draft_los", description: { en: "Drafts and tracks letters of support from partners.", ar: "يصوغ ويتابع رسائل الدعم." } },
    { name: "legal_redteam", description: { en: "Runs the response clause-by-clause against the clause library.", ar: "يراجع الردّ بنداً بنداً مقابل المكتبة." } },
    { name: "compile_packet", description: { en: "Stitches the final cover, technical, financial, partner, compliance packet.", ar: "يجمع الحزمة النهائية." } },
  ],
  checkpoints: [
    {
      id: "bid-no-bid",
      human: { en: "Bid Director", ar: "مدير العطاءات" },
      question: { en: "Bid or no-bid on this 220-page RFP?", ar: "هل نُقدّم على هذه المناقصة؟" },
      rationale: {
        en: "Qualifier scores 76% fit (capability strong, partner gap on 1 of 3 LoS, pricing headroom thin). Recommend BID with caveat: secure third partner inside 4 days or fall back to a no-bid memo.",
        ar: "76% جدارة (قوة فنية، نقص شريك واحد، هامش تسعير ضيّق). يُوصى بالتقديم مع شرط: تأمين الشريك خلال 4 أيام أو الانسحاب.",
      },
      options: [
        { id: "bid", label: { en: "Bid (with the partner caveat)", ar: "تقديم (مع شرط الشريك)" }, recommended: true },
        { id: "no-bid", label: { en: "No-bid (defensible memo only)", ar: "انسحاب (مذكّرة مبرّرة)" } },
        { id: "scope-down", label: { en: "Bid only on Lots 1+2 (not Lot 3)", ar: "تقديم على الجزء 1+2 فقط" } },
      ],
    },
    {
      id: "pricing-signoff",
      human: { en: "CFO", ar: "المدير المالي" },
      question: { en: "Approve the base scenario at SAR 142M (margin 11.2%)?", ar: "هل توافق على السيناريو الأساس 142M ريال (هامش 11.2%)؟" },
      rationale: {
        en: "3 scenarios modelled. Base SAR 142M is most likely to win and meets the 10% margin floor. Aggressive (SAR 134M) wins faster but breaches the floor. Floor (SAR 151M) protects margin but rarely wins. Recommend base.",
        ar: "ثلاثة سيناريوهات. الأساس 142M هو الأرجح للفوز ويحفظ أدنى هامش 10%. الطموح يكسر الحدّ. الحدّ الأدنى يفقد الفوز. يُوصى بالأساس.",
      },
      options: [
        { id: "base", label: { en: "Approve base (SAR 142M)", ar: "موافقة على الأساس" }, recommended: true },
        { id: "aggressive", label: { en: "Approve aggressive (SAR 134M)", ar: "موافقة على الطموح" } },
        { id: "floor", label: { en: "Approve floor (SAR 151M)", ar: "موافقة على الحدّ الأدنى" } },
      ],
    },
    {
      id: "legal-release",
      human: { en: "General Counsel", ar: "المستشار العام" },
      question: { en: "Release the packet for upload to the tender portal?", ar: "هل تسمح برفع الحزمة لبوّابة المناقصات؟" },
      rationale: {
        en: "Legal reviewer flagged 2 clauses (4.2 indemnity, 7.4 IP) and the drafter resolved both with the agreed positions from the clause library. No outstanding flags. Recommend release.",
        ar: "نبّه المراجع لبندَين (4.2 و7.4) وعالجهما الكاتب. لا تنبيهات معلّقة. يُوصى بالإفراج.",
      },
      options: [
        { id: "release", label: { en: "Release for upload", ar: "إفراج للرفع" }, recommended: true },
        { id: "hold", label: { en: "Hold — second-pair-of-eyes", ar: "تأجيل — مراجعة ثانية" } },
      ],
    },
  ],
  workflows: [
    {
      id: "tender-response",
      name: { en: "Mega-tender response", ar: "استجابة مناقصة كبرى" },
      description: { en: "Intake → qualify → bid/no-bid → parallel drafting → pricing → partner → legal → compile.", ar: "استلام → تأهيل → قرار → صياغة بالتوازي → تسعير → شركاء → قانوني → تجميع." },
      trigger: { en: "RFP arrives in inbox", ar: "وصول كرّاسة الشروط" },
      steps: [
        { agentId: "ingest", label: { en: "Parse RFP", ar: "تحليل" } },
        { agentId: "qualifier", label: { en: "Score fit-to-win", ar: "تقييم الفوز" } },
        { agentId: "drafter", label: { en: "Draft 5 sections in parallel", ar: "صياغة 5 أقسام بالتوازي" } },
        { agentId: "pricing", label: { en: "Model pricing scenarios", ar: "سيناريوهات تسعير" } },
        { agentId: "partner", label: { en: "Chase LoS letters", ar: "متابعة رسائل الدعم" } },
        { agentId: "legal", label: { en: "Red-team clauses", ar: "مراجعة قانونية" } },
        { agentId: "compiler", label: { en: "Compile packet", ar: "تجميع الحزمة" } },
        { agentId: "orch", label: { en: "Three human checkpoints", ar: "ثلاث نقاط موافقة" } },
      ],
    },
  ],
  kpis: [
    { id: "win-rate", label: { en: "Bid win rate", ar: "معدّل الفوز" }, initial: "—", source: { en: "Maven advisory benchmarks, GCC bid teams, 2025.", ar: "مقاييس Maven الاستشارية للفِرق الخليجية 2025." } },
    { id: "cycle", label: { en: "RFP-to-submit cycle", ar: "زمن الاستلام إلى التقديم" }, initial: "—" },
    { id: "no-bid", label: { en: "Defensible no-bid rate", ar: "معدّل الانسحاب المبرّر" }, initial: "—" },
    { id: "los", label: { en: "Partner LoS turnaround", ar: "زمن رسائل الشركاء" }, initial: "—" },
  ],
  initialInbox: [
    {
      id: "RFP-ETM-2026-LOT3",
      source: { en: "Etimad portal · auto-fetch", ar: "بوّابة اعتماد · جلب آلي" },
      subject: { en: "RFP-ETM-2026-LOT3 · Smart-services platform · 220 pages · 14-day window", ar: "RFP-ETM-2026-LOT3 · منصّة خدمات ذكية · 220 صفحة · 14 يوماً" },
      preview: { en: "Mandatory requirements (18), evaluation criteria (6), partner LoS required (3), security: SAMA + NCA-ECC.", ar: "متطلبات إلزامية 18، معايير 6، شركاء 3، أمن: ساما + NCA-ECC." },
      receivedAt: "Day 0 · 08:30",
      status: "new",
      accent: "#8A5BD6",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "t1", kind: "think", agentId: "orch", label: { en: "Open mega-tender response workflow", ar: "فتح سير الاستجابة" }, detail: { en: "RFP matches mega-tender trigger. 14-day clock starts. Dispatch Ingestor → Qualifier (gate 1) → 5 parallel Drafters → Pricing (gate 2) → Partner → Legal (gate 3) → Compiler.", ar: "المناقصة مطابقة. عدّاد 14 يوماً. توزيع المسارات. ثلاث نقاط." } },
    { id: "t2", kind: "update-inbox", agentId: "orch", label: { en: "RFP picked up", ar: "تمّ التقاط المناقصة" }, inboxUpdate: { id: "RFP-ETM-2026-LOT3", status: "in-progress" } },
    { id: "t3", kind: "handoff", agentId: "orch", toAgentId: "ingest", label: { en: "Hand off to RFP Ingestor", ar: "تسليم إلى محلّل الكرّاسة" } },
    { id: "t4", kind: "tool-call", agentId: "ingest", toolName: "parse_rfp", label: { en: "Parse 220-page RFP", ar: "تحليل 220 صفحة" }, toolResult: { en: "Parsed: 7 sections, 18 mandatory requirements, 6 evaluation criteria, 3 partner LoS required, 14-day window, security baseline SAMA + NCA-ECC.", ar: "النتيجة: 7 أقسام، 18 إلزامي، 6 معيار، 3 شركاء، 14 يوماً." } },
    {
      id: "t5", kind: "patch-workspace", agentId: "ingest", label: { en: "Publish requirements matrix", ar: "نشر مصفوفة المتطلبات" },
      workspacePatch: {
        op: "add", widget: {
          id: "requirements", kind: "table",
          title: { en: "Mandatory requirements (sample 6 of 18)", ar: "المتطلبات (عيّنة 6 من 18)" },
          rows: [
            [{ en: "ID", ar: "المعرّف" }, { en: "Requirement", ar: "المتطلب" }, { en: "Owner section", ar: "القسم" }],
            [{ en: "M-01", ar: "M-01" }, { en: "SAMA + NCA-ECC compliance attestation", ar: "إقرار الامتثال" }, { en: "S6 Compliance", ar: "S6 الامتثال" }],
            [{ en: "M-02", ar: "M-02" }, { en: "5 named past performance references in-Kingdom", ar: "5 مراجع داخل المملكة" }, { en: "S2 Past performance", ar: "S2 سابق الأعمال" }],
            [{ en: "M-04", ar: "M-04" }, { en: "Bilingual UI (AR + EN) RTL clean", ar: "واجهة ثنائية اللغة" }, { en: "S3 Technical", ar: "S3 تقني" }],
            [{ en: "M-09", ar: "M-09" }, { en: "Data residency: in-Kingdom only", ar: "إقامة البيانات داخل المملكة" }, { en: "S4 Security", ar: "S4 أمن" }],
            [{ en: "M-12", ar: "M-12" }, { en: "Local content ≥ 40%", ar: "محتوى محلي ≥ 40%" }, { en: "S5 Commercial", ar: "S5 تجاري" }],
            [{ en: "M-15", ar: "M-15" }, { en: "Partner LoS from a Tier-1 sovereign cloud", ar: "رسالة دعم من شريك سيادي" }, { en: "S2 Partner", ar: "S2 شريك" }],
          ],
        },
      },
    },
    { id: "t6", kind: "handoff", agentId: "ingest", toAgentId: "qualifier", label: { en: "Hand off to Qualifier", ar: "تسليم إلى المُقيّم" } },
    { id: "t7", kind: "tool-call", agentId: "qualifier", toolName: "score_fit_to_win", label: { en: "Score fit-to-win", ar: "تقييم الفوز" }, toolResult: { en: "Capability: 88%. Past performance: 81%. Pricing headroom: 62%. Partner fit: 67% (gap on 1 of 3 LoS). Composite: 76%. Recommend BID with partner caveat.", ar: "الجدارة 88%، السابقة 81%، التسعير 62%، الشركاء 67%. المركّب 76%. يُوصى بالتقديم." } },
    { id: "t8", kind: "checkpoint", agentId: "orch", checkpointId: "bid-no-bid", label: { en: "Pause for Bid/No-bid", ar: "توقف لقرار التقديم" } },
    { id: "t9", kind: "think", agentId: "orch", label: { en: "Bid approved — fork 5 parallel drafters", ar: "البدء — تشعيب 5 كتّاب" }, detail: { en: "Forking section drafters for S2 Past performance, S3 Technical, S4 Security, S5 Commercial, S6 Compliance.", ar: "تشعيب الكتّاب للأقسام S2…S6." } },
    { id: "t10", kind: "tool-call", agentId: "drafter", toolName: "draft_section", label: { en: "Draft S3 Technical (lane 1/5)", ar: "صياغة S3 تقني (مسار 1/5)" }, toolResult: { en: "S3 drafted (32 pages). Pulled 14 precedent passages from Wins-Library v8.", ar: "صياغة S3 (32 صفحة). 14 مقطعاً من مكتبة الفوز ن8." } },
    { id: "t11", kind: "tool-call", agentId: "drafter", toolName: "draft_section", label: { en: "Draft S4 Security (lane 2/5)", ar: "صياغة S4 أمن (مسار 2/5)" }, toolResult: { en: "S4 drafted (18 pages). 4 SAMA + 3 NCA-ECC controls cited.", ar: "صياغة S4 (18 صفحة). 4 ضوابط ساما و3 NCA-ECC." } },
    { id: "t12", kind: "tool-call", agentId: "drafter", toolName: "draft_section", label: { en: "Draft S5 Commercial (lane 3/5)", ar: "صياغة S5 تجاري (مسار 3/5)" }, toolResult: { en: "S5 drafted (10 pages). Local-content table populated at 42%.", ar: "صياغة S5 (10 صفحات). جدول المحتوى المحلي 42%." } },
    { id: "t13", kind: "tool-call", agentId: "drafter", toolName: "draft_section", label: { en: "Draft S2 Past performance (lane 4/5)", ar: "صياغة S2 سابق الأعمال (مسار 4/5)" }, toolResult: { en: "S2 drafted (9 pages). 5 in-Kingdom references attached.", ar: "صياغة S2 (9 صفحات). 5 مراجع داخل المملكة." } },
    { id: "t14", kind: "tool-call", agentId: "drafter", toolName: "draft_section", label: { en: "Draft S6 Compliance (lane 5/5)", ar: "صياغة S6 امتثال (مسار 5/5)" }, toolResult: { en: "S6 drafted (12 pages). Conflict detected: vendor footprint claim appears in S3 §4.2 and S5 §1.1 — flagged for human reconciliation.", ar: "صياغة S6 (12 صفحة). تعارض: ادعاء البصمة في S3 §4.2 و S5 §1.1 — وُسم للمراجعة." } },
    {
      id: "t15", kind: "patch-workspace", agentId: "drafter", label: { en: "Publish drafting board", ar: "نشر لوحة الصياغة" },
      workspacePatch: {
        op: "add", widget: {
          id: "drafts", kind: "table",
          title: { en: "Section drafts", ar: "مسوّدات الأقسام" },
          rows: [
            [{ en: "Section", ar: "القسم" }, { en: "Pages", ar: "صفحات" }, { en: "State", ar: "الحالة" }],
            [{ en: "S2 Past performance", ar: "S2 سابق الأعمال" }, { en: "9", ar: "9" }, { en: "Drafted", ar: "تمّت" }],
            [{ en: "S3 Technical", ar: "S3 تقني" }, { en: "32", ar: "32" }, { en: "Drafted", ar: "تمّت" }],
            [{ en: "S4 Security", ar: "S4 أمن" }, { en: "18", ar: "18" }, { en: "Drafted", ar: "تمّت" }],
            [{ en: "S5 Commercial", ar: "S5 تجاري" }, { en: "10", ar: "10" }, { en: "Drafted", ar: "تمّت" }],
            [{ en: "S6 Compliance", ar: "S6 امتثال" }, { en: "12", ar: "12" }, { en: "Drafted · 1 conflict flagged", ar: "تمّت · تعارض" }],
          ],
        },
      },
    },
    { id: "t16", kind: "handoff", agentId: "drafter", toAgentId: "pricing", label: { en: "Hand off to Pricing Modeller", ar: "تسليم إلى محاكي التسعير" } },
    { id: "t17", kind: "tool-call", agentId: "pricing", toolName: "model_pricing", label: { en: "Model 3 pricing scenarios", ar: "نمذجة 3 سيناريوهات" }, toolResult: { en: "Aggressive SAR 134M (margin 8.4% — under floor). Base SAR 142M (margin 11.2% — recommended). Floor SAR 151M (margin 14.0%).", ar: "طموح 134M (هامش 8.4% — تحت الحدّ). أساس 142M (11.2% — موصى به). حدّ أدنى 151M (14%)." } },
    {
      id: "t18", kind: "patch-workspace", agentId: "pricing", label: { en: "Publish pricing scenarios", ar: "نشر سيناريوهات التسعير" },
      workspacePatch: {
        op: "add", widget: {
          id: "pricing", kind: "table",
          title: { en: "Pricing scenarios (SAR)", ar: "سيناريوهات التسعير (ريال)" },
          rows: [
            [{ en: "Scenario", ar: "السيناريو" }, { en: "Total", ar: "الإجمالي" }, { en: "Margin", ar: "الهامش" }, { en: "Win prob.", ar: "احتمال الفوز" }],
            [{ en: "Aggressive", ar: "طموح" }, { en: "134M", ar: "134M" }, { en: "8.4% (under floor)", ar: "8.4% (تحت الحدّ)" }, { en: "62%", ar: "62%" }],
            [{ en: "Base (recommended)", ar: "أساس (موصى به)" }, { en: "142M", ar: "142M" }, { en: "11.2%", ar: "11.2%" }, { en: "47%", ar: "47%" }],
            [{ en: "Floor", ar: "حدّ أدنى" }, { en: "151M", ar: "151M" }, { en: "14.0%", ar: "14%" }, { en: "26%", ar: "26%" }],
          ],
        },
      },
    },
    { id: "t19", kind: "checkpoint", agentId: "orch", checkpointId: "pricing-signoff", label: { en: "Pause for CFO pricing sign-off", ar: "توقف للتسعير" } },
    { id: "t20", kind: "handoff", agentId: "orch", toAgentId: "partner", label: { en: "Hand off to Partner Outreach", ar: "تسليم إلى تواصل الشركاء" } },
    { id: "t21", kind: "tool-call", agentId: "partner", toolName: "draft_los", label: { en: "Draft + chase 3 LoS", ar: "صياغة ومتابعة 3 رسائل" }, toolResult: { en: "2 partners returned LoS within 36h. 3rd partner silent — auto-escalation drafted to alternative partner. New partner committed at D+5.", ar: "ردّ شريكان خلال 36 ساعة. الثالث صامت — تصعيد آلي إلى بديل التزم في اليوم 5." } },
    { id: "t22", kind: "update-kpi", agentId: "partner", label: { en: "Partner LoS turnaround = 36h", ar: "زمن الشركاء = 36 ساعة" }, kpiPatch: { id: "los", value: "36 h", delta: "-85%" } },
    { id: "t23", kind: "handoff", agentId: "partner", toAgentId: "legal", label: { en: "Hand off to Legal Reviewer", ar: "تسليم إلى المراجع القانوني" } },
    { id: "t24", kind: "tool-call", agentId: "legal", toolName: "legal_redteam", label: { en: "Red-team clause-by-clause", ar: "مراجعة بنداً بنداً" }, toolResult: { en: "2 flags: clause 4.2 indemnity (resolved with library position 4.2c). Clause 7.4 IP (resolved with library position 7.4a). No outstanding flags.", ar: "تنبيهان: 4.2 و7.4 — حُلّا بمواقع المكتبة. لا تنبيهات معلّقة." } },
    {
      id: "t25", kind: "patch-workspace", agentId: "legal", label: { en: "Publish red-team summary", ar: "نشر ملخّص المراجعة" },
      workspacePatch: {
        op: "add", widget: {
          id: "legal-summary", kind: "list",
          title: { en: "Legal red-team", ar: "المراجعة القانونية" },
          rows: [
            [{ en: "Clause 4.2 indemnity", ar: "بند 4.2 تعويض" }, { en: "Resolved with library position 4.2c (capped at contract value).", ar: "حُلّ بموقع 4.2ج (سقف بقيمة العقد)." }],
            [{ en: "Clause 7.4 IP", ar: "بند 7.4 ملكية فكرية" }, { en: "Resolved with library position 7.4a (joint with carve-outs).", ar: "حُلّ بموقع 7.4أ (مشترك مع استثناءات)." }],
          ],
        },
      },
    },
    { id: "t26", kind: "checkpoint", agentId: "orch", checkpointId: "legal-release", label: { en: "Pause for Legal release", ar: "توقف لإفراج القانوني" } },
    { id: "t27", kind: "handoff", agentId: "orch", toAgentId: "compiler", label: { en: "Hand off to Packet Compiler", ar: "تسليم إلى مُجمّع الحزمة" } },
    { id: "t28", kind: "tool-call", agentId: "compiler", toolName: "compile_packet", label: { en: "Stitch final submission packet", ar: "تجميع الحزمة" }, toolResult: { en: "Packet built: cover (3p) + technical (60p) + financial (8p) + partner LoS (3) + compliance (12p) = 86 pages. Uploaded to Etimad portal at D+12 09:14.", ar: "الحزمة: غلاف (3) + تقني (60) + مالي (8) + شركاء (3) + امتثال (12) = 86 صفحة. رُفعت في اليوم 12 الساعة 09:14." } },
    { id: "t29", kind: "update-kpi", agentId: "compiler", label: { en: "RFP-to-submit cycle: 12 days vs 14 budget", ar: "زمن التقديم: 12 يوماً مقابل 14" }, kpiPatch: { id: "cycle", value: "12 days", delta: "-2 days" } },
    { id: "t30", kind: "update-kpi", agentId: "compiler", label: { en: "Defensible no-bid rate (rolling) → 35%", ar: "معدّل الانسحاب المبرّر → 35%" }, kpiPatch: { id: "no-bid", value: "35%", delta: "+10 pts" } },
    { id: "t31", kind: "update-kpi", agentId: "compiler", label: { en: "Bid win rate (rolling 12) → 31%", ar: "معدّل الفوز → 31%" }, kpiPatch: { id: "win-rate", value: "31%", delta: "+9 pts" } },
    { id: "t32", kind: "update-inbox", agentId: "orch", label: { en: "Mark RFP submitted", ar: "تعليم المناقصة بالتقديم" }, inboxUpdate: { id: "RFP-ETM-2026-LOT3", status: "resolved" } },
    { id: "t33", kind: "complete", agentId: "orch", label: { en: "Run complete. Packet uploaded to Etimad. Audit log closed.", ar: "اكتمل التشغيل. رُفعت الحزمة وأُغلق السجل." } },
  ],
};

export default tenderScenario;
