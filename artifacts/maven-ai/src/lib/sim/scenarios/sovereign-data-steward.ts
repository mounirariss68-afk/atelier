/**
 * Sovereign Data Steward — full scripted run.
 *
 * A new "Citizen Sentiment Dashboard" data-product request is dropped
 * into the sovereign enclave landing zone. The steward-conductor runs
 * Schema Explorer → Arabic NER → Pipeline Drafter → Lineage Compiler
 * → Quality Contract Drafter, blocks one sink that violates residency,
 * and pauses for the data engineer (merge) and data owner (sign).
 */

import type { Scenario } from "../types";

const sovereignDataScenario: Scenario = {
  slug: "sovereign-data-steward",
  toolTitle: { en: "Sovereign Data Steward", ar: "حارس البيانات السيادي" },
  accent: "#0A1230",
  description: {
    en: "An on-prem orchestrator runs a data run inside an air-gapped enclave: Schema Explorer, Arabic NER, Pipeline Drafter, Lineage Compiler, and Quality Contract Drafter coordinate to land a clean, mastered, regulator-defensible data product — blocking sinks that violate residency.",
    ar: "منسّق محلّي يدير جولة داخل بيئة معزولة: مستكشف البنية، وأداة الكيانات العربية، وكاتب التدفق، ومسجّل النسب، وكاتب عقد الجودة، يتعاونون لإصدار منتج بيانات نظيف ومضبوط وقابل للدفاع — مع حجب أيّ مصبّ يخالف الإقامة.",
  },
  buyer: { en: "CDO + Head of AI Foundations", ar: "المدير الرقمي ورئيس أُسس الذكاء الاصطناعي" },
  trigger: { en: "New 'Citizen Sentiment Dashboard' request lands in the enclave landing zone.", ar: "طلب 'لوحة مشاعر المواطنين' وصل إلى منطقة الإدخال السيادية." },
  agents: [
    { id: "orch", name: { en: "Steward Conductor", ar: "منسّق الحارس" }, role: { en: "Plans the run and gates publish.", ar: "يخطّط الجولة ويراقب النشر." }, kind: "orchestrator", color: "#0A1230" },
    { id: "schema", name: { en: "Schema Explorer", ar: "مستكشف البنية" }, role: { en: "Profiles each source schema and distributions.", ar: "يحلّل البنية والتوزيعات لكل مصدر." }, kind: "specialist", color: "#5B7CFF" },
    { id: "ner", name: { en: "Arabic NER", ar: "كيانات عربية" }, role: { en: "Tags Arabic free-text sources.", ar: "يصنّف الكيانات في النصوص العربية." }, kind: "specialist", color: "#5C8CA8" },
    { id: "pipeline", name: { en: "Pipeline Drafter", ar: "كاتب التدفق" }, role: { en: "Composes the transform DAG.", ar: "يصوغ مخطط التحويل." }, kind: "drafter", color: "#C45BB8" },
    { id: "lineage", name: { en: "Lineage Compiler", ar: "مسجّل النسب" }, role: { en: "Validates each sink against the obligation register.", ar: "يدقّق كل مصبّ مقابل سجل الالتزامات." }, kind: "critic", color: "#D9534F" },
    { id: "contract", name: { en: "Quality Contract Drafter", ar: "كاتب عقد الجودة" }, role: { en: "Drafts the data-product quality contract.", ar: "يصوغ عقد جودة المنتج." }, kind: "drafter", color: "#8A5BD6" },
  ],
  tools: [
    { name: "profile_schemas", description: { en: "Profiles every source schema and distribution.", ar: "يحلّل بنية وتوزيع كل مصدر." } },
    { name: "ner_arabic", description: { en: "Runs Arabic NER on free-text columns.", ar: "يطبّق الكيانات العربية على الأعمدة النصية." } },
    { name: "compose_dag", description: { en: "Composes the transform DAG.", ar: "يصوغ المخطط." } },
    { name: "match_obligations", description: { en: "Matches each sink against PDPL / NDMO / SDAIA register.", ar: "يدقّق كل مصبّ مقابل السجل." } },
    { name: "draft_contract", description: { en: "Drafts the data-product quality contract.", ar: "يصوغ عقد الجودة." } },
    { name: "merge_pipeline", description: { en: "Merges the approved pipeline into the enclave.", ar: "يدمج التدفق في البيئة." } },
    { name: "publish_product", description: { en: "Publishes the data product after both sign-offs.", ar: "ينشر المنتج بعد التوقيعَين." } },
  ],
  checkpoints: [
    {
      id: "engineer-merge",
      human: { en: "Data Engineer", ar: "مهندس البيانات" },
      question: { en: "Merge the proposed transform DAG into the enclave?", ar: "هل تدمج المخطط في البيئة؟" },
      rationale: {
        en: "DAG has 4 sources → 6 transforms → 2 sinks. One sink (sink-2: external BI) is blocked by Lineage Compiler on PDPL Article 13 (citizen sentiment is sensitive). Merge the rest; sink-2 stays blocked.",
        ar: "المخطط: 4 مصادر → 6 تحويلات → 2 مصبّ. المصبّ الثاني محجوب وفق المادة 13 PDPL (مشاعر المواطن حسّاسة). دمج البقيّة وإبقاء الحجب.",
      },
      options: [
        { id: "merge", label: { en: "Merge (sink-2 stays blocked)", ar: "دمج (المصبّ الثاني محجوب)" }, recommended: true },
        { id: "request-exception", label: { en: "Request residency exception for sink-2", ar: "طلب استثناء إقامة للمصبّ الثاني" } },
        { id: "send-back", label: { en: "Send back — re-design pipeline", ar: "إعادة — تصميم آخر" } },
      ],
    },
    {
      id: "owner-sign",
      human: { en: "Data Owner (Ministry CX)", ar: "مالك البيانات (CX الوزارة)" },
      question: { en: "Sign the quality contract and publish the data product?", ar: "هل توقّع عقد الجودة وتنشر المنتج؟" },
      rationale: {
        en: "Contract names: refresh cadence (15 min), classification (sensitive · citizen-PII), retention (90 days hot, 2 years archive), residency (in-Kingdom only), and a 99% completeness SLA. Recommend sign.",
        ar: "العقد يحدّد: تواتر 15 دقيقة، تصنيف حسّاس، احتفاظ 90 يوماً حار وسنتان أرشيف، إقامة داخل المملكة، اكتمال 99%. يُوصى بالتوقيع.",
      },
      options: [
        { id: "sign", label: { en: "Sign & publish", ar: "توقيع ونشر" }, recommended: true },
        { id: "tighten-sla", label: { en: "Tighten SLA to 99.5%, then publish", ar: "رفع SLA إلى 99.5% ثم النشر" } },
      ],
    },
  ],
  workflows: [
    {
      id: "onboard",
      name: { en: "Dataset onboarding", ar: "إدخال مجموعة بيانات" },
      description: { en: "Profile → NER → DAG → lineage → contract → engineer + owner.", ar: "تحليل → كيانات → مخطط → نسب → عقد → نقاط الموافقة." },
      trigger: { en: "New dataset in landing zone", ar: "مجموعة بيانات جديدة" },
      steps: [
        { agentId: "schema", label: { en: "Profile schemas", ar: "تحليل البنية" } },
        { agentId: "ner", label: { en: "NER Arabic", ar: "كيانات عربية" } },
        { agentId: "pipeline", label: { en: "Compose DAG", ar: "صياغة المخطط" } },
        { agentId: "lineage", label: { en: "Lineage + obligations", ar: "نسب وحجب" } },
        { agentId: "contract", label: { en: "Quality contract", ar: "عقد الجودة" } },
        { agentId: "orch", label: { en: "Engineer + owner sign", ar: "مهندس + مالك" } },
      ],
    },
  ],
  kpis: [
    { id: "ttp", label: { en: "Time to first approved product", ar: "زمن أول منتج معتمد" }, initial: "—", source: { en: "Cognirise advisory engagements, 3 GCC sovereign pilots, 2025.", ar: "تجارب Cognirise الاستشارية، 3 برامج خليجية، 2025." } },
    { id: "lineage-cov", label: { en: "Lineage coverage", ar: "تغطية النسب" }, initial: "—" },
    { id: "pdpl-pass", label: { en: "PDPL controls passed", ar: "ضوابط PDPL المُجتازة" }, initial: "—" },
    { id: "blocked-sinks", label: { en: "Blocked sinks named", ar: "المصبّات المحجوبة المُسمّاة" }, initial: "—" },
  ],
  initialInbox: [
    {
      id: "REQ-CITZ-SENT-01",
      source: { en: "Enclave landing zone", ar: "منطقة الإدخال السيادية" },
      subject: { en: "New product request: Citizen Sentiment Dashboard", ar: "طلب منتج جديد: لوحة مشاعر المواطنين" },
      preview: { en: "4 sources (CRM, contact-centre transcripts AR, social listening, complaints), 2 sinks (internal Looker + external BI partner).", ar: "4 مصادر و2 مصبّ (Looker داخلي وشريك BI خارجي)." },
      receivedAt: "Mon 09:30",
      status: "new",
      accent: "#0A1230",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "d1", kind: "think", agentId: "orch", label: { en: "Open dataset onboarding", ar: "فتح إدخال مجموعة البيانات" }, detail: { en: "New product request matches onboarding trigger. Air-gap mode active. Dispatch schema → NER → pipeline → lineage → contract. Two human gates.", ar: "الطلب مطابق. وضع الأمان النشط. توزيع المسارات." } },
    { id: "d2", kind: "update-inbox", agentId: "orch", label: { en: "Request picked up", ar: "تمّ التقاط الطلب" }, inboxUpdate: { id: "REQ-CITZ-SENT-01", status: "in-progress" } },
    { id: "d3", kind: "handoff", agentId: "orch", toAgentId: "schema", label: { en: "Hand off to Schema Explorer", ar: "تسليم إلى المستكشف" } },
    { id: "d4", kind: "tool-call", agentId: "schema", toolName: "profile_schemas", label: { en: "Profile 4 sources", ar: "تحليل 4 مصادر" }, toolResult: { en: "4 sources profiled. 142 columns total. 1 stale classification on contact-centre transcripts (last reviewed 2023).", ar: "تحليل 4 مصادر. 142 عموداً. تصنيف قديم على مكالمات الاتصال (2023)." } },
    {
      id: "d5", kind: "patch-workspace", agentId: "schema", label: { en: "Publish source inventory", ar: "نشر جرد المصادر" },
      workspacePatch: {
        op: "add", widget: {
          id: "sources", kind: "table",
          title: { en: "Sources", ar: "المصادر" },
          rows: [
            [{ en: "Source", ar: "المصدر" }, { en: "Cols", ar: "أعمدة" }, { en: "Classification", ar: "التصنيف" }],
            [{ en: "CRM", ar: "CRM" }, { en: "48", ar: "48" }, { en: "Sensitive · in-Kingdom", ar: "حسّاس · داخل المملكة" }],
            [{ en: "Contact-centre transcripts (AR)", ar: "مكالمات الاتصال (عربي)" }, { en: "22", ar: "22" }, { en: "Sensitive (stale 2023)", ar: "حسّاس (قديم 2023)" }],
            [{ en: "Social listening", ar: "الاستماع الاجتماعي" }, { en: "31", ar: "31" }, { en: "Public", ar: "عام" }],
            [{ en: "Complaints", ar: "الشكاوى" }, { en: "41", ar: "41" }, { en: "Sensitive · in-Kingdom", ar: "حسّاس · داخل المملكة" }],
          ],
        },
      },
    },
    { id: "d6", kind: "handoff", agentId: "schema", toAgentId: "ner", label: { en: "Hand off to Arabic NER", ar: "تسليم إلى الكيانات" } },
    { id: "d7", kind: "tool-call", agentId: "ner", toolName: "ner_arabic", label: { en: "NER on contact-centre transcripts", ar: "كيانات على مكالمات الاتصال" }, toolResult: { en: "12 entity types tagged. PII density: 4.1% (national IDs, MSISDN, names). Recommend sensitive classification refresh.", ar: "12 نوعاً من الكيانات. كثافة بيانات شخصية 4.1%. يُوصى بتحديث التصنيف." } },
    { id: "d8", kind: "handoff", agentId: "ner", toAgentId: "pipeline", label: { en: "Hand off to Pipeline Drafter", ar: "تسليم إلى كاتب التدفق" } },
    { id: "d9", kind: "tool-call", agentId: "pipeline", toolName: "compose_dag", label: { en: "Compose 6-step transform DAG", ar: "صياغة مخطط من 6 خطوات" }, toolResult: { en: "DAG: clean → de-dupe → AR-translate → sentiment → aggregate → publish. 2 sinks proposed: sink-1 (internal Looker, in-Kingdom), sink-2 (external BI partner, Frankfurt region).", ar: "المخطط: تنظيف → إزالة تكرار → ترجمة عربية → مشاعر → تجميع → نشر. مصبّان مقترحان." } },
    {
      id: "d10", kind: "patch-workspace", agentId: "pipeline", label: { en: "Publish DAG visual", ar: "نشر المخطط" },
      workspacePatch: {
        op: "add", widget: {
          id: "dag", kind: "list",
          title: { en: "Transform DAG", ar: "مخطط التحويل" },
          rows: [
            [{ en: "1. clean", ar: "1. تنظيف" }, { en: "Strip control chars + dedupe by hash.", ar: "إزالة الرموز والتكرار." }],
            [{ en: "2. AR-translate", ar: "2. ترجمة" }, { en: "Translate transcripts AR→EN for embedding.", ar: "ترجمة المكالمات للتضمين." }],
            [{ en: "3. sentiment", ar: "3. مشاعر" }, { en: "Per-message sentiment + topic.", ar: "مشاعر وموضوع لكل رسالة." }],
            [{ en: "4. aggregate", ar: "4. تجميع" }, { en: "Daily by service line.", ar: "يومي لكل خدمة." }],
            [{ en: "Sink-1 → internal Looker (in-Kingdom)", ar: "مصبّ 1 → Looker داخلي" }, { en: "ALLOWED", ar: "مسموح" }],
            [{ en: "Sink-2 → external BI partner (Frankfurt)", ar: "مصبّ 2 → شريك BI خارجي (فرانكفورت)" }, { en: "BLOCKED · pending lineage", ar: "محجوب مبدئياً" }],
          ],
        },
      },
    },
    { id: "d11", kind: "handoff", agentId: "pipeline", toAgentId: "lineage", label: { en: "Hand off to Lineage Compiler", ar: "تسليم إلى مسجّل النسب" } },
    { id: "d12", kind: "tool-call", agentId: "lineage", toolName: "match_obligations", label: { en: "Match sinks against obligation register", ar: "تدقيق المصبّات" }, toolResult: { en: "Sink-1: PASS. Sink-2: BLOCKED — PDPL Article 13 (sensitive citizen data must remain in-Kingdom). Named obligation surfaced.", ar: "الأول: مسموح. الثاني: محجوب — المادة 13 PDPL." } },
    {
      id: "d13", kind: "patch-workspace", agentId: "lineage", label: { en: "Publish lineage + blocked-sink reason", ar: "نشر النسب وسبب الحجب" },
      workspacePatch: {
        op: "add", widget: {
          id: "blocked", kind: "list",
          title: { en: "Blocked sinks (with named obligation)", ar: "المصبّات المحجوبة مع البند" },
          rows: [
            [{ en: "Sink-2 · external BI partner (Frankfurt)", ar: "مصبّ 2 · شريك BI خارجي" }, { en: "PDPL Article 13 — sensitive citizen data must remain in-Kingdom. Mitigation: anonymise + ship aggregates only.", ar: "المادة 13 PDPL — تبقى البيانات الحسّاسة داخل المملكة. التخفيف: تجهيل وإرسال تجميعات فقط." }],
          ],
        },
      },
    },
    { id: "d14", kind: "update-kpi", agentId: "lineage", label: { en: "Lineage coverage = 100% (every column traced)", ar: "تغطية النسب = 100%" }, kpiPatch: { id: "lineage-cov", value: "100%", delta: "+45 pts" } },
    { id: "d15", kind: "update-kpi", agentId: "lineage", label: { en: "Blocked sinks named = 1", ar: "المصبّات المحجوبة = 1" }, kpiPatch: { id: "blocked-sinks", value: "1", delta: "+1" } },
    { id: "d16", kind: "update-kpi", agentId: "lineage", label: { en: "PDPL controls passed = 14 / 14", ar: "ضوابط PDPL = 14/14" }, kpiPatch: { id: "pdpl-pass", value: "14 / 14", delta: "+14" } },
    { id: "d17", kind: "handoff", agentId: "lineage", toAgentId: "contract", label: { en: "Hand off to Quality Contract Drafter", ar: "تسليم إلى كاتب العقد" } },
    { id: "d18", kind: "tool-call", agentId: "contract", toolName: "draft_contract", label: { en: "Draft data-product quality contract", ar: "صياغة العقد" } },
    {
      id: "d19", kind: "patch-workspace", agentId: "contract", label: { en: "Publish quality contract draft", ar: "نشر العقد" },
      workspacePatch: {
        op: "add", widget: {
          id: "contract-doc", kind: "doc",
          title: { en: "Quality contract (draft)", ar: "عقد الجودة (مسوّدة)" },
          rows: [
            [{ en: "Refresh cadence: 15 minutes. Completeness SLA: 99%. Latency SLA: < 5 min.", ar: "تواتر: 15 دقيقة. اكتمال: 99%. زمن: أقل من 5 دقائق." }],
            [{ en: "Classification: sensitive · citizen-PII. Retention: 90 days hot, 2 years archive. Residency: in-Kingdom only.", ar: "تصنيف حسّاس. احتفاظ 90 يوماً حار وسنتان أرشيف. الإقامة داخل المملكة." }],
            [{ en: "On-call owner: Ministry CX data steward. Breach protocol: PDPL incident playbook v3.", ar: "المسؤول: حارس بيانات وزارة CX. بروتوكول الخرق: دليل حوادث PDPL ن3." }],
          ],
        },
      },
    },
    { id: "d20", kind: "checkpoint", agentId: "orch", checkpointId: "engineer-merge", label: { en: "Pause for Data Engineer merge", ar: "توقف لمهندس البيانات" } },
    { id: "d21", kind: "tool-call", agentId: "orch", toolName: "merge_pipeline", label: { en: "Merge approved DAG (sink-2 stays blocked)", ar: "دمج المخطط (المصبّ الثاني محجوب)" }, toolResult: { en: "Pipeline merged into enclave. First run successful at 11:18; 14,031 rows produced; sink-1 populated.", ar: "تمّ الدمج. الجولة الأولى ناجحة 11:18 و14,031 صفّاً." } },
    { id: "d22", kind: "checkpoint", agentId: "orch", checkpointId: "owner-sign", label: { en: "Pause for Data Owner sign", ar: "توقف لمالك البيانات" } },
    { id: "d23", kind: "tool-call", agentId: "orch", toolName: "publish_product", label: { en: "Publish data product", ar: "نشر المنتج" }, toolResult: { en: "Product 'citizen-sentiment-dashboard' v1.0 published in catalogue at 11:54. Visible to ministry CX persona only.", ar: "نُشر المنتج النسخة 1.0 في الكتالوج 11:54. مرئي لشخصية CX فقط." } },
    { id: "d24", kind: "update-kpi", agentId: "orch", label: { en: "Time to first product: 2h 24m vs 6-week baseline", ar: "زمن أول منتج: 2س24د مقابل 6 أسابيع" }, kpiPatch: { id: "ttp", value: "2h 24m", delta: "-99%" } },
    { id: "d25", kind: "update-inbox", agentId: "orch", label: { en: "Mark request resolved", ar: "تعليم الطلب مغلق" }, inboxUpdate: { id: "REQ-CITZ-SENT-01", status: "resolved" } },
    { id: "d26", kind: "complete", agentId: "orch", label: { en: "Run complete. Product live, contract signed, audit log closed.", ar: "اكتمل التشغيل. المنتج فاعل والعقد موقّع." } },
  ],
};

export default sovereignDataScenario;
