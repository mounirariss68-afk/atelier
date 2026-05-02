import type { AssessmentDefinition } from "./types";

export const mvi: AssessmentDefinition = {
  slug: "mvi",
  serviceSlug: "ai-driven-sdlc",
  code: "MVI",
  brandColor: "#E97132",
  estMinutes: 12,
  title: { en: "Modernization Velocity Index", ar: "مؤشر سرعة التحديث" },
  subtitle: {
    en: "How fast can your engineering organization modernize legacy and ship AI-grade software?",
    ar: "ما السرعة التي يمكن لمؤسستك الهندسية بها تحديث النظم القديمة وإطلاق برمجيات بمستوى الذكاء الاصطناعي؟",
  },
  description: {
    en: "Benchmark your application portfolio knowledge, AI-augmented SDLC adoption, DevEx, sovereign-cloud posture, and engineering operating model.",
    ar: "قارن معرفتكم بمحفظة التطبيقات، وتبني SDLC المعزز بالذكاء الاصطناعي، وتجربة المطور، والوضع السيادي، ونموذج تشغيل الهندسة.",
  },
  memoPromptHint:
    "Frame the memo around modernization velocity. Reference the 70%-IT-spend-on-maintenance fact and the 40–60% SDLC compression possible with AI-augmented engineering.",
  antiVendor: {
    en: [
      "If you need a 200-person offshore staff augmentation deal, an Indian SI will outprice us.",
      "If your sole modernization goal is replatforming to Oracle Cloud, talk to Oracle Consulting.",
      "If you need full-stack ServiceNow rollout, talk to Accenture or DXC.",
    ],
    ar: [
      "إذا كنتم بحاجة لصفقة استعانة بفريق عن بعد بـ 200 شخص، فإن SI هندي سيتفوق علينا في السعر.",
      "إذا كان هدف التحديث الوحيد هو الانتقال إلى Oracle Cloud، تحدثوا مع Oracle Consulting.",
      "إذا كنتم بحاجة لطرح ServiceNow كامل، تحدثوا مع Accenture أو DXC.",
    ],
  },
  dimensions: [
    {
      id: "portfolio",
      title: { en: "Application Portfolio Knowledge", ar: "معرفة محفظة التطبيقات" },
      weight: 0.15,
      description: { en: "Inventory completeness, criticality classification, dependency mapping.", ar: "اكتمال الجرد، تصنيف الأهمية، خرائط الاعتماديات." },
      questions: [
        {
          id: "mvi.p1",
          prompt: { en: "Application inventory completeness?", ar: "اكتمال جرد التطبيقات؟" },
          options: [
            { id: "a", label: { en: "No central inventory.", ar: "لا يوجد جرد مركزي." }, score: 1 },
            { id: "b", label: { en: "Spreadsheet maintained quarterly.", ar: "جدول بيانات يُحدّث كل ربع." }, score: 2 },
            { id: "c", label: { en: "CMDB with 70–80% coverage.", ar: "CMDB يغطي 70–80%." }, score: 3 },
            { id: "d", label: { en: "Living inventory with automated discovery.", ar: "جرد حي باكتشاف آلي." }, score: 4 },
            { id: "e", label: { en: "Real-time dependency graph with criticality scoring.", ar: "رسم اعتماديات لحظي مع تصنيف الأهمية." }, score: 5 },
          ],
        },
        {
          id: "mvi.p2",
          prompt: { en: "Legacy criticality classification?", ar: "تصنيف أهمية الأنظمة القديمة؟" },
          options: [
            { id: "a", label: { en: "No formal classification.", ar: "لا تصنيف رسمي." }, score: 1 },
            { id: "b", label: { en: "Tier 1/2/3 by IT.", ar: "تصنيف من قبل تقنية المعلومات." }, score: 2 },
            { id: "c", label: { en: "Joint IT + business criticality matrix.", ar: "مصفوفة أهمية مشتركة بين الأعمال والتقنية." }, score: 3 },
            { id: "d", label: { en: "Risk-weighted modernization roadmap signed off.", ar: "خارطة طريق تحديث مرجحة بالمخاطر معتمدة." }, score: 4 },
            { id: "e", label: { en: "Continuous portfolio re-prioritization tied to enterprise risk.", ar: "إعادة ترتيب أولويات مستمرة مرتبطة بمخاطر المؤسسة." }, score: 5 },
          ],
        },
        {
          id: "mvi.p3",
          prompt: { en: "Dependency mapping across legacy systems?", ar: "خرائط الاعتماديات عبر الأنظمة القديمة؟" },
          options: [
            { id: "a", label: { en: "Tribal knowledge only.", ar: "معرفة شفهية فقط." }, score: 1 },
            { id: "b", label: { en: "Manual maps in Visio/PowerPoint.", ar: "خرائط يدوية في Visio/PowerPoint." }, score: 2 },
            { id: "c", label: { en: "Static CMDB-based dependency lists.", ar: "قوائم اعتماديات ثابتة من CMDB." }, score: 3 },
            { id: "d", label: { en: "Code-level dependency graphs auto-refreshed.", ar: "رسوم اعتماديات على مستوى الكود تُحدث آلياً." }, score: 4 },
            { id: "e", label: { en: "Live dependency + data-flow graph used for impact analysis.", ar: "رسم اعتماديات وتدفق بيانات حي يُستخدم لتحليل الأثر." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "coverage",
      title: { en: "Code & Documentation Coverage", ar: "تغطية الكود والوثائق" },
      weight: 0.10,
      description: { en: "Test coverage, documentation currency, ADR practice.", ar: "تغطية الاختبارات، حداثة الوثائق، ممارسة قرارات المعمارية." },
      questions: [
        {
          id: "mvi.c1",
          prompt: { en: "Average automated test coverage on critical apps?", ar: "متوسط تغطية الاختبارات الآلية للتطبيقات الحيوية؟" },
          options: [
            { id: "a", label: { en: "<20%.", ar: "أقل من 20%." }, score: 1 },
            { id: "b", label: { en: "20–40%.", ar: "20–40%." }, score: 2 },
            { id: "c", label: { en: "40–60%.", ar: "40–60%." }, score: 3 },
            { id: "d", label: { en: "60–80%.", ar: "60–80%." }, score: 4 },
            { id: "e", label: { en: ">80% with mutation testing on critical paths.", ar: "أكثر من 80% مع اختبارات الطفرات للمسارات الحرجة." }, score: 5 },
          ],
        },
        {
          id: "mvi.c2",
          prompt: { en: "Documentation currency for legacy systems?", ar: "حداثة الوثائق للأنظمة القديمة؟" },
          options: [
            { id: "a", label: { en: "Largely outdated or missing.", ar: "قديمة أو مفقودة في الغالب." }, score: 1 },
            { id: "b", label: { en: "Some current docs, mostly architectural.", ar: "بعض الوثائق الحديثة، معظمها معماري." }, score: 2 },
            { id: "c", label: { en: "Functional + technical docs current for top systems.", ar: "وثائق وظيفية وتقنية محدّثة لأهم الأنظمة." }, score: 3 },
            { id: "d", label: { en: "Living docs maintained alongside code.", ar: "وثائق حية تُحفظ مع الكود." }, score: 4 },
            { id: "e", label: { en: "AI-generated specs + human-curated ADRs as source of truth.", ar: "مواصفات مولدة بالذكاء الاصطناعي مع قرارات معمارية بشرية المصدر الموثوق." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "ai-sdlc",
      title: { en: "AI-Augmented SDLC Adoption", ar: "تبني SDLC معزز بالذكاء الاصطناعي" },
      weight: 0.20,
      description: { en: "Copilot/Codeium/Cursor adoption, AI code review, AI test generation, agentic refactoring.", ar: "تبني Copilot/Codeium/Cursor، مراجعة الكود بالذكاء الاصطناعي، توليد الاختبارات، إعادة الهيكلة." },
      questions: [
        {
          id: "mvi.s1",
          prompt: { en: "AI coding assistant adoption among engineers?", ar: "تبني مساعد الكود الذكي بين المهندسين؟" },
          options: [
            { id: "a", label: { en: "<10%.", ar: "أقل من 10%." }, score: 1 },
            { id: "b", label: { en: "10–30% in pilots.", ar: "10–30% في التجارب." }, score: 2 },
            { id: "c", label: { en: "30–60% with informal usage.", ar: "30–60% بشكل غير رسمي." }, score: 3 },
            { id: "d", label: { en: ">60% with measured productivity uplift.", ar: "أكثر من 60% مع قياس تحسن الإنتاجية." }, score: 4 },
            { id: "e", label: { en: ">80% with role-customized AI workflows + agentic refactoring.", ar: "أكثر من 80% مع تدفقات ذكاء اصطناعي مخصصة وإعادة هيكلة وكيلية." }, score: 5 },
          ],
        },
        {
          id: "mvi.s2",
          prompt: { en: "AI usage in code review?", ar: "استخدام الذكاء الاصطناعي في مراجعة الكود؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد." }, score: 1 },
            { id: "b", label: { en: "Optional AI suggestions in PRs.", ar: "اقتراحات اختيارية في طلبات السحب." }, score: 2 },
            { id: "c", label: { en: "AI review enforced for security & secrets.", ar: "مراجعة AI إلزامية للأمن والأسرار." }, score: 3 },
            { id: "d", label: { en: "AI review across security, performance, and style with auto-fixes.", ar: "مراجعة AI شاملة (أمن، أداء، أسلوب) مع إصلاحات آلية." }, score: 4 },
            { id: "e", label: { en: "Agentic refactoring PRs raised by AI and auto-merged on green.", ar: "طلبات سحب لإعادة الهيكلة يرفعها الذكاء الاصطناعي وتُدمج تلقائياً." }, score: 5 },
          ],
        },
        {
          id: "mvi.s3",
          prompt: { en: "AI-driven legacy spec extraction?", ar: "استخراج المواصفات من النظم القديمة بالذكاء الاصطناعي؟" },
          options: [
            { id: "a", label: { en: "Not used.", ar: "غير مستخدم." }, score: 1 },
            { id: "b", label: { en: "Tried in one POC.", ar: "جُرّب في POC واحد." }, score: 2 },
            { id: "c", label: { en: "Used on 1–2 modernization programs.", ar: "مستخدم في برنامج تحديث أو اثنين." }, score: 3 },
            { id: "d", label: { en: "Standard practice for any modernization.", ar: "ممارسة قياسية لأي تحديث." }, score: 4 },
            { id: "e", label: { en: "AI-driven spec + auto-generated test scaffolds + migration plan as one workflow.", ar: "مواصفات بالذكاء الاصطناعي + هياكل اختبار مولدة + خطة هجرة كتدفق واحد." }, score: 5 },
          ],
        },
        {
          id: "mvi.s4",
          prompt: { en: "AI-generated test coverage for new code?", ar: "تغطية اختبارات مولدة بالذكاء الاصطناعي للكود الجديد؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد." }, score: 1 },
            { id: "b", label: { en: "Engineers occasionally use it ad-hoc.", ar: "يستخدمها المهندسون أحياناً." }, score: 2 },
            { id: "c", label: { en: "AI generates ~50% of unit tests.", ar: "AI يولّد نحو 50% من اختبارات الوحدة." }, score: 3 },
            { id: "d", label: { en: ">75% of unit + integration tests AI-assisted.", ar: "أكثر من 75% من اختبارات الوحدة والتكامل بمساعدة AI." }, score: 4 },
            { id: "e", label: { en: "Continuous AI test generation tied to coverage SLAs in CI.", ar: "توليد اختبارات مستمر مرتبط باتفاقيات تغطية في CI." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "devex",
      title: { en: "Engineering Productivity & DevEx", ar: "إنتاجية الهندسة وتجربة المطور" },
      weight: 0.15,
      description: { en: "DORA metrics, platform engineering, internal developer portal.", ar: "مقاييس DORA، هندسة المنصة، بوابة المطورين الداخلية." },
      questions: [
        {
          id: "mvi.d1",
          prompt: { en: "DORA metrics tracking maturity?", ar: "نضج تتبع مقاييس DORA؟" },
          options: [
            { id: "a", label: { en: "Not tracked.", ar: "غير متتبَّعة." }, score: 1 },
            { id: "b", label: { en: "Lead time tracked manually.", ar: "زمن التسليم يُتابع يدوياً." }, score: 2 },
            { id: "c", label: { en: "All 4 DORA metrics dashboarded.", ar: "كل مقاييس DORA الأربعة في لوحة." }, score: 3 },
            { id: "d", label: { en: "Per-team DORA metrics + improvement targets.", ar: "DORA لكل فريق مع أهداف تحسين." }, score: 4 },
            { id: "e", label: { en: "Elite DORA performance benchmarked externally.", ar: "أداء DORA من فئة Elite مع مقارنة خارجية." }, score: 5 },
          ],
        },
        {
          id: "mvi.d2",
          prompt: { en: "Internal developer portal / platform?", ar: "بوابة/منصة مطور داخلية؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد." }, score: 1 },
            { id: "b", label: { en: "Wiki + scattered tools.", ar: "ويكي + أدوات متفرقة." }, score: 2 },
            { id: "c", label: { en: "IDP for service catalog only.", ar: "IDP لكاتالوج الخدمات فقط." }, score: 3 },
            { id: "d", label: { en: "Backstage-class IDP with golden paths.", ar: "IDP من فئة Backstage مع مسارات ذهبية." }, score: 4 },
            { id: "e", label: { en: "IDP with golden paths, scorecards, and AI assistants embedded.", ar: "IDP مع مسارات ذهبية وبطاقات وأذرع AI." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "cloud",
      title: { en: "Architecture & Cloud Readiness", ar: "جاهزية المعمارية والسحابة" },
      weight: 0.15,
      description: { en: "Containerization, target cloud, IaC, observability.", ar: "الحاويات، السحابة المستهدفة، البنية ككود، المراقبة." },
      questions: [
        {
          id: "mvi.cl1",
          prompt: { en: "Workloads containerized?", ar: "نسبة الأحمال في الحاويات؟" },
          options: [
            { id: "a", label: { en: "<10%.", ar: "أقل من 10%." }, score: 1 },
            { id: "b", label: { en: "10–30%.", ar: "10–30%." }, score: 2 },
            { id: "c", label: { en: "30–60%.", ar: "30–60%." }, score: 3 },
            { id: "d", label: { en: "60–85%.", ar: "60–85%." }, score: 4 },
            { id: "e", label: { en: ">85% with k8s as default.", ar: "أكثر من 85% مع k8s كافتراضي." }, score: 5 },
          ],
        },
        {
          id: "mvi.cl2",
          prompt: { en: "Sovereign / on-prem cloud capability?", ar: "قدرة سحابة سيادية/داخلية؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا توجد." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Discussed; no plan.", ar: "تمت مناقشتها بدون خطة." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Hybrid; some workloads on sovereign.", ar: "هجين؛ بعض الأحمال على السيادية." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Multi-region sovereign + public cloud capable.", ar: "متعدد المناطق سيادية + سحابة عامة." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Production-grade sovereign + on-prem with auto-failover.", ar: "سيادية وداخلية بمستوى إنتاج مع تجاوز فشل آلي." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "mvi.cl3",
          prompt: { en: "IaC + observability maturity?", ar: "نضج البنية ككود والمراقبة؟" },
          options: [
            { id: "a", label: { en: "Mostly manual provisioning + log files.", ar: "غالباً يدوي + ملفات سجل." }, score: 1 },
            { id: "b", label: { en: "Some Terraform + APM tools.", ar: "بعض Terraform + أدوات APM." }, score: 2 },
            { id: "c", label: { en: "IaC for new workloads + centralized observability.", ar: "IaC للأحمال الجديدة + مراقبة مركزية." }, score: 3 },
            { id: "d", label: { en: "Policy-as-code + SLO-driven ops.", ar: "سياسات ككود + عمليات قائمة على SLOs." }, score: 4 },
            { id: "e", label: { en: "Policy-as-code, OpenTelemetry-everywhere, AI-assisted incident triage.", ar: "سياسات ككود، OpenTelemetry في كل مكان، فرز حوادث بمساعدة AI." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "risk",
      title: { en: "Risk, Compliance & Sovereign Code", ar: "المخاطر والامتثال وسيادة الكود" },
      weight: 0.10,
      description: { en: "SAST/DAST, secret scanning, sovereign-cloud constraints, regulated workloads.", ar: "SAST/DAST، فحص الأسرار، قيود السحابة السيادية، الأحمال المنظمة." },
      questions: [
        {
          id: "mvi.r1",
          prompt: { en: "Application security in CI/CD?", ar: "أمن التطبيقات في CI/CD؟" },
          options: [
            { id: "a", label: { en: "Manual audits only.", ar: "تدقيقات يدوية فقط." }, score: 1 },
            { id: "b", label: { en: "SAST in some pipelines.", ar: "SAST في بعض الأنابيب." }, score: 2 },
            { id: "c", label: { en: "SAST + secret scanning across most.", ar: "SAST + فحص أسرار في الغالب." }, score: 3 },
            { id: "d", label: { en: "SAST + DAST + SCA + secrets across all.", ar: "SAST + DAST + SCA + أسرار في الكل." }, score: 4 },
            { id: "e", label: { en: "Shift-left + runtime protection + automated remediation.", ar: "Shift-left + حماية وقت التشغيل + معالجة آلية." }, score: 5 },
          ],
        },
        {
          id: "mvi.r2",
          prompt: { en: "Posture for regulated workloads (PDPL, SAMA, CBUAE)?", ar: "وضع الأحمال المنظمة (PDPL، SAMA، CBUAE)؟" },
          options: [
            { id: "a", label: { en: "Awareness only.", ar: "وعي فقط." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Some controls in regulated apps.", ar: "بعض الضوابط في التطبيقات المنظمة." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Compliance baseline templates.", ar: "قوالب أساس امتثال." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Continuous compliance with attestations.", ar: "امتثال مستمر مع شهادات." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Sovereign-by-default + continuous attestation evidence per release.", ar: "سيادي افتراضياً + أدلة شهادات لكل إصدار." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "talent",
      title: { en: "Talent, Change & Operating Model", ar: "المواهب والتغيير ونموذج التشغيل" },
      weight: 0.15,
      description: { en: "Re-skilling, vendor mix, in-source/out-source ratio, agile maturity.", ar: "إعادة التأهيل، مزيج الموردين، نسبة الداخلي/الخارجي، نضج الرشاقة." },
      questions: [
        {
          id: "mvi.t1",
          prompt: { en: "In-source vs. out-source engineering ratio?", ar: "نسبة الهندسة الداخلية مقابل الخارجية؟" },
          options: [
            { id: "a", label: { en: ">80% outsourced.", ar: "أكثر من 80% خارجي." }, score: 1 },
            { id: "b", label: { en: "60–80% outsourced.", ar: "60–80% خارجي." }, score: 2 },
            { id: "c", label: { en: "40–60% outsourced.", ar: "40–60% خارجي." }, score: 3 },
            { id: "d", label: { en: "20–40% outsourced.", ar: "20–40% خارجي." }, score: 4 },
            { id: "e", label: { en: "<20% outsourced; product-led in-house engineering.", ar: "أقل من 20% خارجي؛ هندسة داخلية بقيادة المنتج." }, score: 5 },
          ],
        },
        {
          id: "mvi.t2",
          prompt: { en: "Engineering operating model?", ar: "نموذج تشغيل الهندسة؟" },
          options: [
            { id: "a", label: { en: "Project-based delivery.", ar: "تسليم قائم على المشاريع." }, score: 1 },
            { id: "b", label: { en: "Mix of project + product squads.", ar: "مزيج مشاريع وفرق منتج." }, score: 2 },
            { id: "c", label: { en: "Product squads with platform support.", ar: "فرق منتج مع دعم المنصة." }, score: 3 },
            { id: "d", label: { en: "Stream-aligned + platform + enabling teams (Team Topologies).", ar: "فرق محاذاة + منصة + تمكين (Team Topologies)." }, score: 4 },
            { id: "e", label: { en: "Topologies model + AI agents embedded as 'team members'.", ar: "نموذج Topologies + وكلاء AI كأعضاء فريق." }, score: 5 },
          ],
        },
        {
          id: "mvi.t3",
          prompt: { en: "AI-era reskilling for engineers?", ar: "إعادة تأهيل المهندسين لعصر الذكاء الاصطناعي؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد." }, score: 1 },
            { id: "b", label: { en: "Optional Copilot training.", ar: "تدريب اختياري على Copilot." }, score: 2 },
            { id: "c", label: { en: "Mandatory baseline + role-specific paths.", ar: "تدريب أساسي إلزامي + مسارات حسب الدور." }, score: 3 },
            { id: "d", label: { en: "Funded reskilling tied to certifications.", ar: "إعادة تأهيل ممول مرتبط بالشهادات." }, score: 4 },
            { id: "e", label: { en: "Continuous learning with internal AI engineering certification.", ar: "تعلم مستمر مع شهادات هندسة AI داخلية." }, score: 5 },
          ],
        },
      ],
    },
  ],
  recommendations: {
    portfolio: {
      Nascent: {
        quickWins90d: [{ en: "Pick one critical legacy system and run AI-driven spec extraction this quarter.", ar: "اختيار نظام قديم حرج واحد وتشغيل استخراج مواصفات بالذكاء الاصطناعي هذا الربع." }],
        roadmap6m: [{ en: "Stand up a living application inventory with automated discovery.", ar: "تأسيس جرد تطبيقات حي باكتشاف آلي." }],
        strategic12m: [{ en: "Real-time dependency graph powering impact analysis for every release.", ar: "رسم اعتماديات لحظي يقود تحليل الأثر لكل إصدار." }],
      },
      Emerging: {
        quickWins90d: [{ en: "Joint IT + business criticality matrix for top 30 apps.", ar: "مصفوفة أهمية مشتركة لأعلى 30 تطبيقاً." }],
        roadmap6m: [{ en: "Risk-weighted modernization roadmap signed off by ExCo.", ar: "خارطة طريق تحديث مرجحة بالمخاطر معتمدة من ExCo." }],
        strategic12m: [{ en: "Continuous portfolio re-prioritization tied to enterprise risk.", ar: "إعادة ترتيب أولويات مستمرة مرتبطة بمخاطر المؤسسة." }],
      },
    },
    "ai-sdlc": {
      Nascent: {
        quickWins90d: [{ en: "Roll out a sanctioned AI coding assistant to 100% of engineers in 60 days.", ar: "نشر مساعد كود AI معتمد لجميع المهندسين خلال 60 يوماً." }],
        roadmap6m: [{ en: "Standardize AI code review (security, secrets) across all repos.", ar: "توحيد مراجعة الكود بالذكاء الاصطناعي عبر جميع المستودعات." }],
        strategic12m: [{ en: "Agentic refactoring + AI test generation in CI as standard.", ar: "إعادة هيكلة وكيلية + توليد اختبارات في CI كقياس." }],
      },
      Emerging: {
        quickWins90d: [{ en: "Add AI-driven legacy spec extraction to your modernization runbook.", ar: "إضافة استخراج مواصفات بالذكاء الاصطناعي إلى دليل التحديث." }],
        roadmap6m: [{ en: "Move AI test generation from optional to mandatory on critical paths.", ar: "نقل توليد الاختبارات من اختياري إلى إلزامي على المسارات الحرجة." }],
        strategic12m: [{ en: "Operate role-customized AI workflows + agentic refactoring at scale.", ar: "تشغيل تدفقات AI مخصصة للدور + إعادة هيكلة وكيلية على نطاق واسع." }],
      },
    },
    devex: {
      Nascent: {
        quickWins90d: [{ en: "Instrument all four DORA metrics this quarter.", ar: "ضبط مقاييس DORA الأربعة هذا الربع." }],
        roadmap6m: [{ en: "Stand up a Backstage-class IDP with 5 golden paths.", ar: "تأسيس IDP من فئة Backstage مع 5 مسارات ذهبية." }],
        strategic12m: [{ en: "Embed AI assistants into IDP scorecards.", ar: "تضمين AI في بطاقات IDP." }],
      },
    },
    cloud: {
      Nascent: {
        quickWins90d: [{ en: "Containerize 5 Tier-1 workloads.", ar: "وضع 5 أحمال من المستوى الأول في حاويات." }],
        roadmap6m: [{ en: "Adopt IaC for new workloads + central observability.", ar: "تبنّي IaC للأحمال الجديدة + مراقبة مركزية." }],
        strategic12m: [{ en: "Stand up sovereign-capable hybrid cloud with auto-failover.", ar: "تأسيس سحابة هجينة سيادية مع تجاوز فشل آلي." }],
      },
    },
    risk: {
      Nascent: {
        quickWins90d: [{ en: "SAST + secret scanning across all repos in 60 days.", ar: "SAST + فحص أسرار عبر جميع المستودعات خلال 60 يوماً." }],
        roadmap6m: [{ en: "Compliance baseline templates for PDPL/SAMA workloads.", ar: "قوالب أساس امتثال لـ PDPL/SAMA." }],
        strategic12m: [{ en: "Sovereign-by-default + continuous attestation per release.", ar: "سيادي افتراضياً + شهادات مستمرة لكل إصدار." }],
      },
    },
    talent: {
      Nascent: {
        quickWins90d: [{ en: "Mandatory AI-engineer baseline training for 100% of engineers.", ar: "تدريب أساسي إلزامي لكل المهندسين." }],
        roadmap6m: [{ en: "Stream-aligned product squads + platform team established.", ar: "تأسيس فرق منتج محاذاة + فريق منصة." }],
        strategic12m: [{ en: "Reduce outsourced ratio to <40%; AI agents embedded as team members.", ar: "خفض نسبة الخارجي لأقل من 40%؛ وكلاء AI كأعضاء فريق." }],
      },
    },
    coverage: {
      Nascent: {
        quickWins90d: [{ en: "Drive AI-generated unit tests to 50% coverage on Tier-1 systems.", ar: "رفع تغطية اختبارات الوحدة AI لـ 50% على أنظمة المستوى الأول." }],
        roadmap6m: [{ en: "AI-generated specs as living documentation source-of-truth.", ar: "مواصفات AI كمصدر موثوق للوثائق الحية." }],
        strategic12m: [{ en: "Continuous AI test generation with coverage SLAs in CI.", ar: "توليد اختبارات AI مستمر مع SLAs في CI." }],
      },
    },
  },
};
