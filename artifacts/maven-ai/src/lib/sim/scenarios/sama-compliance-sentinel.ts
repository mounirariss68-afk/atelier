/**
 * SAMA Compliance Sentinel — full scripted run.
 *
 * SAMA publishes Cyber Resilience Update CRU-2026-04 at 09:00. The
 * sentinel-conductor runs Regulator Monitor → Policy Retriever →
 * Impact Memo Drafter → Evidence Compiler, exposes 9 affected
 * controls with 3 newly-degraded ones, drafts the CRO impact memo,
 * stages the audit-ready evidence pack, and pauses for the CRO and
 * Internal Audit before any filing.
 */

import type { Scenario } from "../types";

const samaScenario: Scenario = {
  slug: "sama-compliance-sentinel",
  toolTitle: { en: "SAMA Compliance Sentinel", ar: "حارس الامتثال لمؤسسة النقد" },
  accent: "#C45BB8",
  description: {
    en: "A compliance orchestrator monitors regulator updates, retrieves the affected controls, drafts the CRO-grade impact memo, and stages the audit-ready evidence pack — pausing for the CRO and Internal Audit before any filing leaves the building.",
    ar: "منسّق امتثال يراقب تحديثات المنظّم، ويسترجع الضوابط المتأثّرة، ويصوغ مذكّرة أثر بمستوى مدير المخاطر، ويُعدّ حزمة أدلّة جاهزة للتدقيق — مع توقف لمدير المخاطر والتدقيق الداخلي.",
  },
  buyer: { en: "CRO + Head of Compliance", ar: "مدير المخاطر ورئيس الامتثال" },
  trigger: { en: "SAMA publishes Cyber Resilience Update CRU-2026-04 at 09:00.", ar: "نشر مؤسسة النقد تحديث المرونة السيبرانية CRU-2026-04 الساعة 09:00." },
  agents: [
    { id: "orch", name: { en: "Sentinel Conductor", ar: "منسّق الحارس" }, role: { en: "Plans the response and gates filings.", ar: "يخطّط الاستجابة ويراقب الإيداع." }, kind: "orchestrator", color: "#C45BB8" },
    { id: "monitor", name: { en: "Regulator Monitor", ar: "مراقب المنظّم" }, role: { en: "Watches SAMA / PDPL / CMA bulletins.", ar: "يراقب نشرات ساما والبيانات والسوق." }, kind: "monitor", color: "#5B7CFF" },
    { id: "policy", name: { en: "Policy Retriever", ar: "مسترجِع السياسات" }, role: { en: "Pulls all affected internal controls.", ar: "يجلب الضوابط الداخلية المتأثّرة." }, kind: "retriever", color: "#5C8CA8" },
    { id: "memo", name: { en: "Impact Memo Drafter", ar: "كاتب مذكّرة الأثر" }, role: { en: "Drafts the CRO impact memo and remediation plan.", ar: "يصوغ مذكّرة الأثر وخطة المعالجة." }, kind: "drafter", color: "#5BA98A" },
    { id: "evidence", name: { en: "Evidence Compiler", ar: "مُجمّع الأدلة" }, role: { en: "Stages the audit-ready evidence pack.", ar: "يُعدّ حزمة الأدلّة." }, kind: "compiler", color: "#8A5BD6" },
  ],
  tools: [
    { name: "watch_regulator", description: { en: "Polls SAMA / PDPL / CMA bulletin feeds.", ar: "يجلب نشرات ساما والبيانات والسوق." } },
    { name: "retrieve_controls", description: { en: "Maps the bulletin to the internal control register.", ar: "يربط النشرة بسجلّ الضوابط الداخلية." } },
    { name: "draft_impact_memo", description: { en: "Drafts the CRO impact memo and remediation plan.", ar: "يصوغ المذكّرة وخطة المعالجة." } },
    { name: "stage_evidence", description: { en: "Stages every artefact required for the inspection pack.", ar: "يُعدّ كل قطعة مطلوبة لحزمة التفتيش." } },
    { name: "file_attestation", description: { en: "Files the cleared attestation back to SAMA.", ar: "يُودع الإقرار المعتمد لدى ساما." } },
  ],
  checkpoints: [
    {
      id: "cro-signoff",
      human: { en: "CRO", ar: "مدير المخاطر" },
      question: { en: "Approve the impact memo and the 21-day remediation plan?", ar: "هل توافق على المذكّرة وخطة المعالجة (21 يوماً)؟" },
      rationale: {
        en: "9 controls touched, 3 newly degraded (CR-014, CR-027, CR-082). Memo names owners, ETA, and the residual risk for each. Recommend approve and let Internal Audit clear the evidence pack.",
        ar: "9 ضوابط متأثّرة، 3 منها جديدة (CR-014 و CR-027 و CR-082). المذكّرة تُسمّي المسؤولين والمخاطر المتبقّية. يُوصى بالموافقة.",
      },
      options: [
        { id: "approve", label: { en: "Approve memo & plan", ar: "موافقة على المذكّرة والخطة" }, recommended: true },
        { id: "extend", label: { en: "Extend remediation to 35 days", ar: "تمديد المعالجة لـ 35 يوماً" } },
        { id: "send-back", label: { en: "Send back — strengthen CR-082 mitigation", ar: "إعادة — تقوية تخفيف CR-082" } },
      ],
    },
    {
      id: "audit-clear",
      human: { en: "Internal Audit", ar: "التدقيق الداخلي" },
      question: { en: "Clear the evidence pack for SAMA filing?", ar: "هل تُجيز حزمة الأدلّة للإيداع لدى ساما؟" },
      rationale: {
        en: "Evidence pack contains 47 artefacts, all dated within the 30-day window, hashed and stored on the WORM bucket. Coverage: 9/9 controls. Recommend clear.",
        ar: "تضمّ الحزمة 47 قطعة كلها ضمن نافذة 30 يوماً، مجزّأة ومحفوظة على تخزين WORM. التغطية: 9/9. يُوصى بالإجازة.",
      },
      options: [
        { id: "clear", label: { en: "Clear & file", ar: "إجازة وإيداع" }, recommended: true },
        { id: "spot-check", label: { en: "Hold for spot-check on CR-027", ar: "تأجيل لفحص CR-027" } },
      ],
    },
  ],
  workflows: [
    {
      id: "regulator-update",
      name: { en: "Regulator update response", ar: "الاستجابة لتحديث المنظّم" },
      description: { en: "Bulletin → controls → impact memo → evidence pack → CRO + Internal Audit checkpoints.", ar: "نشرة → ضوابط → مذكّرة → أدلّة → نقاط الموافقة." },
      trigger: { en: "Regulator publishes a circular", ar: "نشر المنظّم لتعميم" },
      steps: [
        { agentId: "monitor", label: { en: "Detect bulletin", ar: "رصد النشرة" } },
        { agentId: "policy", label: { en: "Retrieve controls", ar: "استرجاع الضوابط" } },
        { agentId: "memo", label: { en: "Draft impact memo", ar: "صياغة المذكّرة" } },
        { agentId: "evidence", label: { en: "Stage evidence", ar: "تجهيز الأدلّة" } },
        { agentId: "orch", label: { en: "CRO + Internal Audit", ar: "نقاط CRO والتدقيق" } },
      ],
    },
  ],
  kpis: [
    { id: "lead-time", label: { en: "Time to impact memo", ar: "زمن المذكّرة" }, initial: "—" },
    { id: "controls-touched", label: { en: "Controls cross-referenced", ar: "الضوابط المُراجعة" }, initial: "—" },
    { id: "evidence-cov", label: { en: "Evidence coverage", ar: "تغطية الأدلّة" }, initial: "—" },
    { id: "stale-flag", label: { en: "Stale-evidence detection lag", ar: "زمن رصد تقادم الأدلّة" }, initial: "—", source: { en: "ServiceNow IRM / Now Assist case studies, 2024.", ar: "دراسات حالة ServiceNow IRM وNow Assist 2024." } },
  ],
  initialInbox: [
    {
      id: "CRU-2026-04",
      source: { en: "SAMA bulletins · cyber-resilience@sama.sa", ar: "نشرات ساما · cyber-resilience@sama.sa" },
      subject: { en: "CRU-2026-04: Updated identity-fabric controls (effective in 30 days)", ar: "CRU-2026-04: تحديث ضوابط الهويّات (سارية بعد 30 يوماً)" },
      preview: { en: "New controls cover identity attestation cadence, privileged-access reviews, and SaaS connector inventory.", ar: "ضوابط جديدة لإقرارات الهويّة ومراجعات الصلاحيات الحسّاسة وجرد موصلات SaaS." },
      receivedAt: "09:00",
      status: "new",
      accent: "#C45BB8",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "s1", kind: "think", agentId: "orch", label: { en: "Open regulator-update workflow", ar: "فتح سير التحديث" }, detail: { en: "SAMA bulletin matches the trigger. 30-day clock starts. Dispatch Monitor → Policy → Memo → Evidence. Two human gates.", ar: "النشرة مطابقة. عدّاد 30 يوماً. توزيع المسارات. نقطتان." } },
    { id: "s2", kind: "update-inbox", agentId: "orch", label: { en: "Bulletin picked up", ar: "تمّ التقاط النشرة" }, inboxUpdate: { id: "CRU-2026-04", status: "in-progress" } },
    { id: "s3", kind: "handoff", agentId: "orch", toAgentId: "monitor", label: { en: "Hand off to Regulator Monitor", ar: "تسليم إلى المراقب" } },
    { id: "s4", kind: "tool-call", agentId: "monitor", toolName: "watch_regulator", label: { en: "Parse SAMA CRU-2026-04", ar: "تحليل النشرة" }, toolResult: { en: "Bulletin parsed. 14 control deltas, 3 net-new, 4 cadence changes, 7 evidence-format changes. Effective 2026-06-02.", ar: "تحليل تامّ. 14 تغيّر، 3 جديد، 4 تغيّر تواتر، 7 تغيّر شكل. السريان 2026-06-02." } },
    { id: "s5", kind: "handoff", agentId: "monitor", toAgentId: "policy", label: { en: "Hand off to Policy Retriever", ar: "تسليم إلى المسترجِع" } },
    { id: "s6", kind: "tool-call", agentId: "policy", toolName: "retrieve_controls", label: { en: "Map bulletin to control register", ar: "ربط النشرة بسجلّ الضوابط" }, toolResult: { en: "9 internal controls touched. 6 currently met, 3 newly degraded: CR-014 (privileged-access review cadence), CR-027 (SaaS connector inventory), CR-082 (identity attestation interval).", ar: "9 ضوابط متأثّرة. 6 ملبّاة، 3 جديدة متدهورة: CR-014 و CR-027 و CR-082." } },
    {
      id: "s7", kind: "patch-workspace", agentId: "policy", label: { en: "Publish affected-controls table", ar: "نشر جدول الضوابط" },
      workspacePatch: {
        op: "add", widget: {
          id: "controls", kind: "table",
          title: { en: "Affected controls (9)", ar: "الضوابط المتأثّرة (9)" },
          rows: [
            [{ en: "Control", ar: "الضابط" }, { en: "Status today", ar: "الحالة اليوم" }, { en: "Owner", ar: "المسؤول" }, { en: "Action", ar: "الإجراء" }],
            [{ en: "CR-014 PAM cadence", ar: "CR-014 تواتر صلاحيات" }, { en: "Degraded", ar: "متدهور" }, { en: "Head of Identity", ar: "رئيس الهويّات" }, { en: "Move quarterly → monthly", ar: "ربعي → شهري" }],
            [{ en: "CR-027 SaaS inventory", ar: "CR-027 جرد SaaS" }, { en: "Degraded", ar: "متدهور" }, { en: "CISO Office", ar: "مكتب أمن المعلومات" }, { en: "Auto-discovery + weekly attest", ar: "اكتشاف آلي + إقرار أسبوعي" }],
            [{ en: "CR-082 Attestation interval", ar: "CR-082 تواتر الإقرار" }, { en: "Degraded", ar: "متدهور" }, { en: "HR Tech", ar: "تقنية الموارد" }, { en: "180d → 90d", ar: "180يوم → 90يوم" }],
            [{ en: "+ 6 controls (cadence/format only)", ar: "+ 6 ضوابط (تواتر/شكل فقط)" }, { en: "Met (small change)", ar: "ملبّاة (تغيير بسيط)" }, { en: "various", ar: "متعدّد" }, { en: "Update doc + republish", ar: "تحديث ونشر" }],
          ],
        },
      },
    },
    { id: "s8", kind: "update-kpi", agentId: "policy", label: { en: "Controls cross-referenced = 9", ar: "الضوابط = 9" }, kpiPatch: { id: "controls-touched", value: "9", delta: "+9" } },
    { id: "s9", kind: "update-kpi", agentId: "policy", label: { en: "Stale-evidence detection: 9 min vs 45-day baseline", ar: "زمن رصد التقادم: 9 دقائق مقابل 45 يوماً" }, kpiPatch: { id: "stale-flag", value: "9 min", delta: "-99%" } },
    { id: "s10", kind: "handoff", agentId: "policy", toAgentId: "memo", label: { en: "Hand off to Impact Memo Drafter", ar: "تسليم إلى الكاتب" } },
    { id: "s11", kind: "tool-call", agentId: "memo", toolName: "draft_impact_memo", label: { en: "Draft CRO impact memo", ar: "صياغة المذكّرة" } },
    {
      id: "s12", kind: "patch-workspace", agentId: "memo", label: { en: "Publish CRO impact memo", ar: "نشر المذكّرة" },
      workspacePatch: {
        op: "add", widget: {
          id: "memo", kind: "doc",
          title: { en: "CRO impact memo (draft)", ar: "مذكّرة المدير (مسوّدة)" },
          rows: [
            [{ en: "Headline. SAMA CRU-2026-04 touches 9 controls; 3 are newly degraded. Time-to-effective: 30 days. Filing budget consumed today: 0%.", ar: "العنوان. CRU-2026-04 يلامس 9 ضوابط؛ 3 منها متدهورة. الوقت المتاح: 30 يوماً." }],
            [{ en: "Remediation plan (21 days). Identity Office moves PAM cadence to monthly (D+7). CISO deploys SaaS auto-discovery (D+14). HR Tech tightens attestation interval (D+21). Residual risk: low/moderate.", ar: "خطة المعالجة (21 يوماً). تواتر الصلاحيات شهري (D+7)، اكتشاف SaaS آلي (D+14)، إقرار 90 يوماً (D+21). المخاطر المتبقية: منخفضة/متوسطة." }],
            [{ en: "Recommendation. Approve the 21-day plan and Internal Audit clearance of the evidence pack. Recommend filing attestation 7 days before effective.", ar: "التوصية. الموافقة على الخطة وإجازة التدقيق ثم الإيداع قبل سريان النشرة بأسبوع." }],
          ],
        },
      },
    },
    { id: "s13", kind: "update-kpi", agentId: "memo", label: { en: "Time to impact memo: 22 min vs 5-day baseline", ar: "زمن المذكّرة: 22 دقيقة مقابل 5 أيام" }, kpiPatch: { id: "lead-time", value: "22 min", delta: "-99%" } },
    { id: "s14", kind: "handoff", agentId: "memo", toAgentId: "evidence", label: { en: "Hand off to Evidence Compiler", ar: "تسليم إلى المُجمّع" } },
    { id: "s15", kind: "tool-call", agentId: "evidence", toolName: "stage_evidence", label: { en: "Stage audit-ready evidence", ar: "تجهيز الأدلّة" }, toolResult: { en: "47 artefacts staged. 9 / 9 controls covered. All artefacts dated within 30 days. SHA-256 hashed and stored on WORM bucket.", ar: "تجهيز 47 قطعة. تغطية 9/9. كلها ضمن 30 يوماً وعلى تخزين WORM." } },
    { id: "s16", kind: "update-kpi", agentId: "evidence", label: { en: "Evidence coverage = 9 / 9", ar: "تغطية الأدلّة = 9/9" }, kpiPatch: { id: "evidence-cov", value: "9 / 9", delta: "+9" } },
    {
      id: "s17", kind: "patch-workspace", agentId: "evidence", label: { en: "Publish evidence pack index", ar: "نشر فهرس الحزمة" },
      workspacePatch: {
        op: "add", widget: {
          id: "pack", kind: "list",
          title: { en: "Evidence pack · CRU-2026-04", ar: "حزمة الأدلّة · CRU-2026-04" },
          rows: [
            [{ en: "PAM logs · CR-014", ar: "سجلّات الصلاحيات · CR-014" }, { en: "12 artefacts · last 30d · WORM-stored", ar: "12 قطعة · آخر 30 يوم · WORM" }],
            [{ en: "SaaS inventory · CR-027", ar: "جرد SaaS · CR-027" }, { en: "9 artefacts · auto-discovery enabled in pilot", ar: "9 قطع · الاكتشاف الآلي قيد التجربة" }],
            [{ en: "Attestation runs · CR-082", ar: "إقرارات · CR-082" }, { en: "26 artefacts · 100% coverage", ar: "26 قطعة · تغطية كاملة" }],
          ],
        },
      },
    },
    { id: "s18", kind: "checkpoint", agentId: "orch", checkpointId: "cro-signoff", label: { en: "Pause for CRO sign-off", ar: "توقف لمدير المخاطر" } },
    { id: "s19", kind: "checkpoint", agentId: "orch", checkpointId: "audit-clear", label: { en: "Pause for Internal Audit clearance", ar: "توقف للتدقيق الداخلي" } },
    { id: "s20", kind: "tool-call", agentId: "orch", toolName: "file_attestation", label: { en: "File attestation with SAMA", ar: "إيداع الإقرار" }, toolResult: { en: "Filed at D+23 with 7-day buffer before effective date. SAMA acknowledgment SAM-ATT-2026-04-118 received.", ar: "أُودع في اليوم 23 بهامش 7 أيام. رقم الإقرار SAM-ATT-2026-04-118." } },
    { id: "s21", kind: "update-inbox", agentId: "orch", label: { en: "Mark bulletin resolved", ar: "تعليم النشرة مغلقة" }, inboxUpdate: { id: "CRU-2026-04", status: "resolved" } },
    { id: "s22", kind: "complete", agentId: "orch", label: { en: "Run complete. Attestation filed. Audit log closed.", ar: "اكتمل التشغيل. أُودع الإقرار وأُغلق السجل." } },
  ],
};

export default samaScenario;
