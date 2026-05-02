/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Document, Page, Text, View, StyleSheet, Svg, Path, Polygon, Line, Circle, Font } from "@react-pdf/renderer";
import type { AssessmentDefinition, ScoreResult } from "@workspace/assessments";
import { tStr } from "@/lib/lang";

const ARABIC_FONT = "Tajawal";
const isBrowser = typeof window !== "undefined";
const baseUrl: string = isBrowser ? (import.meta.env.BASE_URL ?? "/") : "/";
const arabicRegularSrc = isBrowser
  ? `${baseUrl}fonts/Tajawal-Regular.ttf`.replace(/\/+/g, "/")
  : new URL("../../../public/fonts/Tajawal-Regular.ttf", import.meta.url).pathname;
const arabicBoldSrc = isBrowser
  ? `${baseUrl}fonts/Tajawal-Bold.ttf`.replace(/\/+/g, "/")
  : new URL("../../../public/fonts/Tajawal-Bold.ttf", import.meta.url).pathname;
let arabicFontRegistered = false;
function ensureArabicFont() {
  if (arabicFontRegistered) return;
  Font.register({
    family: ARABIC_FONT,
    fonts: [
      { src: arabicRegularSrc, fontWeight: 400 },
      { src: arabicBoldSrc, fontWeight: 700 },
    ],
  });
  arabicFontRegistered = true;
}

interface PDFArgs {
  def: AssessmentDefinition;
  result: ScoreResult;
  profile: { name: string; company: string; role: string; country: string };
  memo: string;
  lang: "en" | "ar";
  publicId: string;
}

const colors = {
  navy: "#0E2841",
  teal: "#156082",
  orange: "#E97132",
  cyan: "#0F9ED5",
  green: "#196B24",
  light: "#F8FAFC",
  border: "#E5E7EB",
  text: "#1F2937",
  muted: "#6B7280",
};

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingHorizontal: 48, paddingBottom: 64, fontFamily: "Helvetica", fontSize: 10, color: colors.text, lineHeight: 1.5 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 },
  brand: { fontSize: 14, fontWeight: 700, color: colors.navy },
  brandSub: { fontSize: 7, color: colors.cyan, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  pageTag: { fontSize: 8, color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  cover: { paddingTop: 180 },
  coverEyebrow: { fontSize: 9, color: colors.orange, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 },
  coverTitle: { fontSize: 36, fontWeight: 700, color: colors.navy, marginBottom: 12 },
  coverSubtitle: { fontSize: 16, color: colors.teal, marginBottom: 40, fontWeight: 400 },
  coverMeta: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, marginTop: 240 },
  coverMetaRow: { flexDirection: "row", marginBottom: 6, fontSize: 10 },
  coverMetaLabel: { width: 90, color: colors.muted, fontWeight: 700, textTransform: "uppercase", fontSize: 8, letterSpacing: 1 },
  h1: { fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: 700, color: colors.navy, marginBottom: 8, marginTop: 18 },
  h3: { fontSize: 11, fontWeight: 700, color: colors.teal, marginBottom: 4, marginTop: 10 },
  divider: { width: 32, height: 3, backgroundColor: colors.orange, marginBottom: 18 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 14, marginBottom: 10 },
  scoreCard: { backgroundColor: colors.light, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  scoreVal: { fontSize: 38, fontWeight: 700, color: colors.navy },
  scoreLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: 1, color: colors.muted, marginBottom: 2 },
  tierBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, color: "white", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, fontSize: 9, marginRight: 6, marginBottom: 6, color: colors.text },
  memoText: { fontSize: 10, marginBottom: 8, lineHeight: 1.6, color: colors.text },
  dimRow: { flexDirection: "row", marginBottom: 5, alignItems: "center" },
  dimName: { width: 200, fontSize: 9, color: colors.text },
  dimBarBg: { flex: 1, height: 8, backgroundColor: "#E5E7EB", borderRadius: 4, marginHorizontal: 8, position: "relative" },
  dimBarFill: { position: "absolute", height: 8, borderRadius: 4 },
  dimVal: { width: 30, fontSize: 9, fontWeight: 700, textAlign: "right", color: colors.navy },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7, color: colors.muted },
  bullet: { fontSize: 10, marginBottom: 4, color: colors.text },
  small: { fontSize: 8, color: colors.muted },
  founderRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  founderCard: { flex: 1, padding: 10, marginHorizontal: 3, borderWidth: 1, borderColor: colors.border, borderRadius: 4 },
  founderName: { fontSize: 9, fontWeight: 700, color: colors.navy },
  founderTitle: { fontSize: 7, color: colors.muted, marginTop: 1 },
  apTitle: { fontSize: 11, fontWeight: 700, color: "#B91C1C", marginBottom: 4 },
  apFix: { fontSize: 9, color: colors.text, marginTop: 2 },
});

const tierColor: Record<string, string> = {
  Nascent: "#B91C1C",
  Emerging: "#D97706",
  Established: "#0F9ED5",
  Advanced: "#156082",
  Leading: colors.green,
};

function PDFRadar({ def, result }: { def: AssessmentDefinition; result: ScoreResult }) {
  const size = 240;
  const cx = size / 2, cy = size / 2, r = 80;
  const dims = def.dimensions;
  const n = dims.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (val: number, i: number) => {
    const v = Math.max(0, Math.min(5, val)) / 5;
    return [cx + Math.cos(angle(i)) * r * v, cy + Math.sin(angle(i)) * r * v] as const;
  };
  const polygonStr = (vals: number[]) => vals.map((v, i) => point(v, i).join(",")).join(" ");
  const scoreVals = dims.map((d) => result.dimensionScores[d.id] ?? 0);
  const benchVals = dims.map((d) => result.peerBenchmark[d.id] ?? 0);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[1, 2, 3, 4, 5].map((ring) => (
        <Polygon key={ring} points={polygonStr(dims.map(() => ring))} fill="none" stroke="#E5E7EB" strokeWidth={0.5} />
      ))}
      {dims.map((_, i) => {
        const [x, y] = point(5, i);
        return <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#E5E7EB" strokeWidth={0.5} />;
      })}
      <Polygon points={polygonStr(benchVals)} fill="rgba(156,163,175,0.15)" stroke="#9CA3AF" strokeWidth={0.8} />
      <Polygon points={polygonStr(scoreVals)} fill={`${def.brandColor}55`} stroke={def.brandColor} strokeWidth={1.5} />
      {scoreVals.map((v, i) => {
        const [x, y] = point(v, i);
        return <Circle key={i} cx={x} cy={y} r={2} fill={def.brandColor} />;
      })}
    </Svg>
  );
}

export function AssessmentPDF({ def, result, profile, memo, lang, publicId }: PDFArgs) {
  const isAr = lang === "ar";
  if (isAr) ensureArabicFont();
  const t = (s: { en: string; ar: string }) => tStr(s, lang);
  const dirStyle = isAr ? { textAlign: "right" as const, direction: "rtl" as const } : {};
  const tierBg = tierColor[result.tier] ?? colors.teal;
  const pageStyle = isAr ? [styles.page, { fontFamily: ARABIC_FONT }] : styles.page;

  return (
    <Document>
      {/* COVER */}
      <Page size="A4" style={pageStyle}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>MAVEN AI</Text>
            <Text style={styles.brandSub}>A Maven Insights Company</Text>
          </View>
          <Text style={styles.pageTag}>{def.code} · {t({ en: "Diagnostic Report", ar: "تقرير تشخيصي" })}</Text>
        </View>
        <View style={styles.cover}>
          <Text style={styles.coverEyebrow}>{def.code} · {result.tier}</Text>
          <Text style={[styles.coverTitle, dirStyle]}>{t(def.title)}</Text>
          <Text style={[styles.coverSubtitle, dirStyle]}>{t(def.subtitle)}</Text>
          <View style={styles.coverMeta}>
            <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>{t({ en: "Prepared for", ar: "أُعدّ لـ" })}</Text><Text>{profile.name} — {profile.role}</Text></View>
            <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>{t({ en: "Organisation", ar: "المنظمة" })}</Text><Text>{profile.company}</Text></View>
            <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>{t({ en: "Country", ar: "البلد" })}</Text><Text>{profile.country.toUpperCase()}</Text></View>
            <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>{t({ en: "Issued", ar: "تاريخ الإصدار" })}</Text><Text>{new Date().toLocaleDateString()}</Text></View>
            <View style={styles.coverMetaRow}><Text style={styles.coverMetaLabel}>{t({ en: "Reference", ar: "المرجع" })}</Text><Text>{publicId}</Text></View>
          </View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.footerText}>© {new Date().getFullYear()} Maven AI · Boutique AI advisory & engineering</Text>
          <Text style={styles.footerText}>maven-ai.com · 1</Text>
        </View>
      </Page>

      {/* MATURITY AT A GLANCE */}
      <Page size="A4" style={pageStyle}>
        <View style={styles.header}>
          <Text style={styles.brand}>MAVEN AI</Text>
          <Text style={styles.pageTag}>{def.code} · {t({ en: "Maturity at a glance", ar: "النضج بنظرة" })}</Text>
        </View>
        <Text style={[styles.h1, dirStyle]}>{t({ en: "The headline", ar: "العنوان الرئيسي" })}</Text>
        <View style={styles.divider} />

        <View style={styles.scoreCard}>
          <View>
            <Text style={styles.scoreLabel}>{t({ en: "Overall score", ar: "النتيجة الإجمالية" })}</Text>
            <Text style={styles.scoreVal}>{result.overallScore.toFixed(1)} <Text style={{ fontSize: 14, color: colors.muted }}>/ 5</Text></Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.tierBadge, { backgroundColor: tierBg }]}>{result.tier}</Text>
            <Text style={[styles.scoreLabel, { marginTop: 8 }]}>{t({ en: "Sovereign sub-score", ar: "النتيجة السيادية" })}</Text>
            <Text style={{ fontSize: 22, fontWeight: 700, color: colors.green }}>{result.sovereignSubScore.score.toFixed(1)} / 5</Text>
          </View>
        </View>

        <Text style={[styles.h2, dirStyle]}>{t({ en: "Dimension breakdown vs GCC peers", ar: "تفصيل الأبعاد مقابل أقران الخليج" })}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 240 }}>
            <PDFRadar def={def} result={result} />
          </View>
          <View style={{ flex: 1 }}>
            {def.dimensions.map((d) => {
              const v = result.dimensionScores[d.id] ?? 0;
              const peer = result.peerBenchmark[d.id] ?? 0;
              return (
                <View key={d.id} style={styles.dimRow}>
                  <Text style={styles.dimName}>{t(d.title)}</Text>
                  <View style={styles.dimBarBg}>
                    <View style={[styles.dimBarFill, { width: `${(v / 5) * 100}%`, backgroundColor: def.brandColor }]} />
                    <View style={{ position: "absolute", left: `${(peer / 5) * 100 - 0.5}%`, top: -3, width: 1.5, height: 14, backgroundColor: colors.muted }} />
                  </View>
                  <Text style={styles.dimVal}>{v.toFixed(1)}</Text>
                </View>
              );
            })}
            <Text style={[styles.small, { marginTop: 6 }]}>{t({ en: "Coloured bar = your score · Vertical bar = peer benchmark", ar: "اللون = نتيجتك · الخط = معيار الأقران" })}</Text>
          </View>
        </View>

        <Text style={[styles.h2, dirStyle]}>{t({ en: "Where you lead / where you lag", ar: "حيث تتقدم / حيث تتأخر" })}</Text>
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.h3}>{t({ en: "Leading", ar: "متقدم" })}</Text>
            {result.strengths.length === 0
              ? <Text style={styles.bullet}>—</Text>
              : result.strengths.map((s, i) => <Text key={i} style={styles.bullet}>• {s}</Text>)}
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.h3}>{t({ en: "Lagging", ar: "متأخر" })}</Text>
            {result.gaps.length === 0
              ? <Text style={styles.bullet}>—</Text>
              : result.gaps.map((s, i) => <Text key={i} style={styles.bullet}>• {s}</Text>)}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>© {new Date().getFullYear()} Maven AI</Text>
          <Text style={styles.footerText}>maven-ai.com · 2</Text>
        </View>
      </Page>

      {/* EXEC MEMO */}
      <Page size="A4" style={pageStyle}>
        <View style={styles.header}>
          <Text style={styles.brand}>MAVEN AI</Text>
          <Text style={styles.pageTag}>{t({ en: "Executive memo", ar: "مذكرة تنفيذية" })}</Text>
        </View>
        <Text style={[styles.h1, dirStyle]}>{t({ en: "From the Maven AI partnership", ar: "من شراكة Maven AI" })}</Text>
        <View style={styles.divider} />
        {memo.split("\n\n").map((para, i) => (
          <Text key={i} style={[styles.memoText, dirStyle]}>{para}</Text>
        ))}
        <View style={styles.footer}>
          <Text style={styles.footerText}>© {new Date().getFullYear()} Maven AI</Text>
          <Text style={styles.footerText}>maven-ai.com · 3</Text>
        </View>
      </Page>

      {/* ANTI-PATTERNS + COST OF INACTION */}
      <Page size="A4" style={pageStyle}>
        <View style={styles.header}>
          <Text style={styles.brand}>MAVEN AI</Text>
          <Text style={styles.pageTag}>{t({ en: "Risks · Cost of inaction", ar: "المخاطر · كلفة التقاعس" })}</Text>
        </View>
        <Text style={[styles.h1, dirStyle]}>{t({ en: "Anti-patterns we detected", ar: "الأنماط المضادة التي اكتشفناها" })}</Text>
        <View style={styles.divider} />
        {result.antiPatterns.length === 0 ? (
          <Text style={styles.bullet}>{t({ en: "No critical anti-patterns detected. This is unusually clean.", ar: "لا توجد أنماط حرجة. هذا نادر." })}</Text>
        ) : (
          result.antiPatterns.map((ap, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.apTitle}>{t(ap.label)}</Text>
              <Text style={[styles.bullet, { color: colors.muted }]}>{t(ap.description)}</Text>
              <Text style={[styles.h3, { marginTop: 6 }]}>{t({ en: "What to do", ar: "ماذا تفعل" })}</Text>
              <Text style={styles.apFix}>{t(ap.fix)}</Text>
            </View>
          ))
        )}

        <Text style={[styles.h2, dirStyle, { marginTop: 18 }]}>{t({ en: "Cost of inaction (next 12 months)", ar: "كلفة التقاعس (12 شهراً)" })}</Text>
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <View style={[styles.card, { flex: 1, marginRight: 6 }]}>
            <Text style={styles.scoreLabel}>{t({ en: "EBIT lift forfeited", ar: "أرباح ضائعة" })}</Text>
            <Text style={{ fontSize: 18, fontWeight: 700, color: colors.green }}>${result.costOfInaction.ebitDeltaUsd.toLocaleString()}</Text>
          </View>
          <View style={[styles.card, { flex: 1, marginHorizontal: 3 }]}>
            <Text style={styles.scoreLabel}>{t({ en: "Avoidable cost", ar: "كلفة قابلة للتجنب" })}</Text>
            <Text style={{ fontSize: 18, fontWeight: 700, color: colors.orange }}>${result.costOfInaction.costDeltaUsd.toLocaleString()}</Text>
          </View>
          <View style={[styles.card, { flex: 1, marginLeft: 6 }]}>
            <Text style={styles.scoreLabel}>{t({ en: "Productivity recovered", ar: "إنتاجية مسترجعة" })}</Text>
            <Text style={{ fontSize: 18, fontWeight: 700, color: colors.teal }}>{(result.costOfInaction.ebitDeltaUsd / 250_000).toFixed(1)} FTE</Text>
          </View>
        </View>
        <Text style={[styles.small, { marginTop: 6 }]}>{t({ en: "Estimates calibrated to your tier and revenue band. Conservative.", ar: "تقديرات معايرة لمستواك ونطاق إيراداتك. متحفظة." })}</Text>

        <View style={styles.footer}>
          <Text style={styles.footerText}>© {new Date().getFullYear()} Maven AI</Text>
          <Text style={styles.footerText}>maven-ai.com · 4</Text>
        </View>
      </Page>

      {/* RECOMMENDATIONS + ANTI-VENDOR + FOUNDERS */}
      <Page size="A4" style={pageStyle}>
        <View style={styles.header}>
          <Text style={styles.brand}>MAVEN AI</Text>
          <Text style={styles.pageTag}>{t({ en: "Plan · Honesty · Partners", ar: "الخطة · الصراحة · الشركاء" })}</Text>
        </View>

        <Text style={[styles.h1, dirStyle]}>{t({ en: "What to do, sequenced", ar: "ماذا تفعل، بالتسلسل" })}</Text>
        <View style={styles.divider} />

        <Text style={[styles.h3, dirStyle]}>{t({ en: "Quick wins (90 days)", ar: "مكاسب سريعة (90 يوماً)" })}</Text>
        {result.recommendations.quickWins90d.map((r, i) => <Text key={i} style={styles.bullet}>• {t(r)}</Text>)}

        <Text style={[styles.h3, dirStyle]}>{t({ en: "Strategic moves (6–12 months)", ar: "تحركات استراتيجية (6–12 شهر)" })}</Text>
        {result.recommendations.strategic12m.map((r, i) => <Text key={i} style={styles.bullet}>• {t(r)}</Text>)}

        <Text style={[styles.h3, dirStyle]}>{t({ en: "6-month roadmap", ar: "خارطة طريق 6 أشهر" })}</Text>
        {result.recommendations.roadmap6m.map((r: { en: string; ar: string }, i: number) => <Text key={i} style={styles.bullet}>• {t(r)}</Text>)}

        <View style={[styles.card, { marginTop: 18, backgroundColor: "#FEF3C7", borderColor: "#FBBF24" }]}>
          <Text style={[styles.h3, { color: "#92400E", marginTop: 0 }]}>
            {t({ en: "What a vendor will not tell you", ar: "ما لن يخبرك به مزود" })}
          </Text>
          <Text style={[styles.bullet, { color: "#78350F" }]}>{(def.antiVendor[lang]?.[0] ?? def.antiVendor.en[0] ?? "")}</Text>
        </View>

        <Text style={[styles.h2, dirStyle, { marginTop: 18 }]}>{t({ en: "Signed by the partnership", ar: "موقعة من الشركاء" })}</Text>
        <View style={styles.founderRow}>
          {[
            { name: "Mounir Aris", title: "Senior Partner — Strategy" },
            { name: "Gokhan Guney", title: "Senior Partner — Engineering" },
            { name: "Alper Kulak", title: "Senior Partner — Data & Governance" },
            { name: "Khalid Al Khudairi", title: "Senior Partner — KSA Markets" },
          ].map((f) => (
            <View key={f.name} style={styles.founderCard}>
              <Text style={styles.founderName}>{f.name}</Text>
              <Text style={styles.founderTitle}>{f.title}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.small, { marginTop: 14 }]}>
          {t({ en: "Schedule a 30-minute readout with one of the founders at maven-ai.com/contact", ar: "احجز جلسة 30 دقيقة مع أحد المؤسسين عبر maven-ai.com/contact" })}
        </Text>

        <View style={styles.footer}>
          <Text style={styles.footerText}>© {new Date().getFullYear()} Maven AI · {publicId}</Text>
          <Text style={styles.footerText}>maven-ai.com · 5</Text>
        </View>
      </Page>
    </Document>
  );
}

export default AssessmentPDF;
