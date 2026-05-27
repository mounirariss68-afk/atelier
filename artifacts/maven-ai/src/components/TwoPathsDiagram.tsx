import { motion } from "framer-motion";
import { Briefcase, Package } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";

const PROJECT_COLOR = "#5B7CFF";
const ASSET_COLOR = "#C45BB8";
const OUTCOME_COLOR = "#8A5BD6";
const NAVY = "#0A1230";

const PROJECT_STEPS = [
  { en: "Scope", ar: "النطاق", tr: "Kapsam" },
  { en: "Discover", ar: "اكتشاف", tr: "Keşif" },
  { en: "Build", ar: "بناء", tr: "İnşa" },
  { en: "Run", ar: "تشغيل", tr: "Çalıştırma" },
];
const ASSET_STEPS = [
  { en: "Pick", ar: "اختيار", tr: "Seçim" },
  { en: "Configure", ar: "تهيئة", tr: "Yapılandırma" },
  { en: "Adopt", ar: "اعتماد", tr: "Benimseme" },
  { en: "Scale", ar: "توسيع", tr: "Ölçekleme" },
];
const LABELS = {
  projectLed: { en: "PROJECT-LED", ar: "قائم على المشاريع", tr: "PROJE ÖNCÜLÜĞÜNDE" },
  assetLed: { en: "ASSET-LED", ar: "قائم على الأصول", tr: "VARLIK ÖNCÜLÜĞÜNDE" },
  client: { en: "CLIENT", ar: "العميل", tr: "MÜŞTERİ" },
  outcomes: { en: "OUTCOMES", ar: "النتائج", tr: "SONUÇLAR" },
  projectCard: { en: "Project-led", ar: "قائم على المشاريع", tr: "Proje öncülüğünde" },
  assetCard: { en: "Asset-led", ar: "قائم على الأصول", tr: "Varlık öncülüğünde" },
  projectDesc: {
    en: "Custom transformation engagements — strategy, large-scale builds, AI-driven SDLC, data & governance foundations. Senior partners on every call. Right when the problem is bespoke and the operating model has to change.",
    ar: "ارتباطات تحول مخصصة — استراتيجية وعمليات بناء واسعة النطاق ودورة حياة تطوير البرمجيات المدفوعة بالذكاء الاصطناعي وأسس البيانات والحوكمة. شركاء كبار في كل مكالمة. مناسب عندما تكون المشكلة فريدة ويجب تغيير نموذج التشغيل.",
    tr: "Özel dönüşüm çalışmaları — strateji, büyük ölçekli geliştirmeler, AI öncülüğünde SDLC, veri & yönetişim temelleri. Her görüşmede kıdemli ortaklar. Sorun kendine özgü olduğunda ve operasyon modelinin değişmesi gerektiğinde doğru seçim.",
  },
  assetDesc: {
    en: "Productized agents and tools from the Marketplace — adopt, configure, and run. Faster time-to-value. Right when the problem is shared across the industry and a configured asset beats a custom build.",
    ar: "وكلاء وأدوات جاهزة من السوق — اعتماد وتهيئة وتشغيل. وقت أسرع لتحقيق القيمة. مناسب عندما تكون المشكلة مشتركة عبر القطاع ويتفوق الأصل المهيأ على البناء المخصص.",
    tr: "Marketplace'ten ürünleştirilmiş ajanlar ve araçlar — benimseyin, yapılandırın, çalıştırın. Daha hızlı değer süresi. Sorun sektör genelinde ortak olduğunda ve yapılandırılmış bir varlık özel geliştirmeyi geçtiğinde doğru seçim.",
  },
};

export default function TwoPathsDiagram() {
  const { lang } = useLang();
  const w = 720;
  const h = 360;
  const projectY = 80;
  const assetY = 280;
  const startX = 60;
  const convergeX = 540;
  const outcomeX = 640;
  const outcomeY = h / 2;

  return (
    <div className="w-full max-w-[760px] mx-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Two paths to outcomes diagram">
        <defs>
          <linearGradient id="projectGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={PROJECT_COLOR} stopOpacity="0.85" />
            <stop offset="100%" stopColor={PROJECT_COLOR} />
          </linearGradient>
          <linearGradient id="assetGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={ASSET_COLOR} stopOpacity="0.85" />
            <stop offset="100%" stopColor={ASSET_COLOR} />
          </linearGradient>
          <radialGradient id="outcomeGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#A77BE0" />
            <stop offset="100%" stopColor={OUTCOME_COLOR} />
          </radialGradient>
          <filter id="tpShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* Project rail */}
        <motion.path
          d={`M ${startX} ${projectY} L ${convergeX} ${projectY} Q ${convergeX + 40} ${projectY} ${outcomeX - 30} ${outcomeY - 6}`}
          fill="none"
          stroke="url(#projectGrad)"
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {/* Asset rail */}
        <motion.path
          d={`M ${startX} ${assetY} L ${convergeX} ${assetY} Q ${convergeX + 40} ${assetY} ${outcomeX - 30} ${outcomeY + 6}`}
          fill="none"
          stroke="url(#assetGrad)"
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.15 }}
        />

        {/* Project label */}
        <g>
          <rect x={startX - 40} y={projectY - 30} width="170" height="22" rx="11" fill={PROJECT_COLOR} />
          <text x={startX + 45} y={projectY - 14} textAnchor="middle" fill="#fff" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em" }}>
            {tStr(LABELS.projectLed, lang)}
          </text>
        </g>
        {/* Asset label */}
        <g>
          <rect x={startX - 40} y={assetY + 12} width="160" height="22" rx="11" fill={ASSET_COLOR} />
          <text x={startX + 40} y={assetY + 28} textAnchor="middle" fill="#fff" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em" }}>
            {tStr(LABELS.assetLed, lang)}
          </text>
        </g>

        {/* Step nodes — project */}
        {PROJECT_STEPS.map((label, i) => {
          const cx = startX + 40 + i * ((convergeX - startX - 40) / (PROJECT_STEPS.length - 1));
          return (
            <motion.g
              key={`p-${i}`}
              initial={{ opacity: 0, scale: 0.6 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.12 }}
            >
              <circle cx={cx} cy={projectY} r="14" fill="#fff" stroke={PROJECT_COLOR} strokeWidth="3" filter="url(#tpShadow)" />
              <text x={cx} y={projectY + 4} textAnchor="middle" fill={PROJECT_COLOR} style={{ fontSize: 11, fontWeight: 800 }}>
                {i + 1}
              </text>
              <text x={cx} y={projectY + 36} textAnchor="middle" fill={NAVY} style={{ fontSize: 11, fontWeight: 600 }}>
                {tStr(label, lang)}
              </text>
            </motion.g>
          );
        })}

        {/* Step nodes — asset */}
        {ASSET_STEPS.map((label, i) => {
          const cx = startX + 40 + i * ((convergeX - startX - 40) / (ASSET_STEPS.length - 1));
          return (
            <motion.g
              key={`a-${i}`}
              initial={{ opacity: 0, scale: 0.6 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.45 + i * 0.12 }}
            >
              <circle cx={cx} cy={assetY} r="14" fill="#fff" stroke={ASSET_COLOR} strokeWidth="3" filter="url(#tpShadow)" />
              <text x={cx} y={assetY + 4} textAnchor="middle" fill={ASSET_COLOR} style={{ fontSize: 11, fontWeight: 800 }}>
                {i + 1}
              </text>
              <text x={cx} y={assetY - 22} textAnchor="middle" fill={NAVY} style={{ fontSize: 11, fontWeight: 600 }}>
                {tStr(label, lang)}
              </text>
            </motion.g>
          );
        })}

        {/* Convergence outcome node */}
        <motion.g
          initial={{ opacity: 0, scale: 0.5 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 1.1 }}
        >
          <circle cx={outcomeX} cy={outcomeY} r="56" fill="url(#outcomeGrad)" filter="url(#tpShadow)" />
          <text x={outcomeX} y={outcomeY - 6} textAnchor="middle" fill="#fff" style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em" }}>
            {tStr(LABELS.client, lang)}
          </text>
          <text x={outcomeX} y={outcomeY + 12} textAnchor="middle" fill="#fff" style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em" }}>
            {tStr(LABELS.outcomes, lang)}
          </text>
        </motion.g>

        {/* Path icons (left edge) */}
        <g transform={`translate(${startX - 32}, ${projectY - 12})`}>
          <circle cx="12" cy="12" r="14" fill={PROJECT_COLOR} />
        </g>
        <g transform={`translate(${startX - 32}, ${assetY - 12})`}>
          <circle cx="12" cy="12" r="14" fill={ASSET_COLOR} />
        </g>
      </svg>

      {/* Legend / two-card panel */}
      <div className="grid sm:grid-cols-2 gap-4 mt-8">
        <div className="rounded-xl p-5 border-2" style={{ borderColor: PROJECT_COLOR, backgroundColor: PROJECT_COLOR + "08" }}>
          <div className="flex items-center gap-2 mb-2">
            <Briefcase size={18} style={{ color: PROJECT_COLOR }} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: PROJECT_COLOR }}>{tStr(LABELS.projectCard, lang)}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {tStr(LABELS.projectDesc, lang)}
          </p>
        </div>
        <div className="rounded-xl p-5 border-2" style={{ borderColor: ASSET_COLOR, backgroundColor: ASSET_COLOR + "10" }}>
          <div className="flex items-center gap-2 mb-2">
            <Package size={18} style={{ color: ASSET_COLOR }} />
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: ASSET_COLOR }}>{tStr(LABELS.assetCard, lang)}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {tStr(LABELS.assetDesc, lang)}
          </p>
        </div>
      </div>
    </div>
  );
}
