import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Sparkles,
  Globe,
  ShieldCheck,
} from "lucide-react";
import {
  type AssessmentDefinition,
  type ProfileInput,
  type Question,
  type SubmissionInput,
  isQuestionActive,
  ui,
} from "@workspace/assessments";
import { useLang, tStr } from "@/lib/lang";
import { submitAssessment } from "@/lib/api";

type Step = "intro" | "profile" | "questions" | "loading" | "done";

interface UseCase {
  id: string;
  name: string;
  answers: Record<string, string>;
}

const REVENUE_BANDS = ["lt-50m", "50-250m", "250m-1b", "1-5b", "gt-5b"] as const;
const EMP_BANDS = ["lt-200", "200-1000", "1000-5000", "5000-20000", "gt-20000"] as const;
const COUNTRIES = ["ksa", "uae", "qatar", "bahrain", "kuwait", "oman", "other"] as const;
const INDUSTRIES = [
  "public-sector",
  "telecommunications",
  "financial-services",
  "energy-commodities",
  "retail-consumer",
  "travel-hospitality",
  "automotive",
  "healthcare",
  "manufacturing",
  "other",
] as const;

interface Props {
  def: AssessmentDefinition;
  teamToken?: string;
}

export default function AssessmentWizard({ def, teamToken }: Props) {
  const { lang, setLang, dir } = useLang();
  const [, navigate] = useLocation();
  const storageKey = `maven-ai-wizard-${def.slug}`;

  const [step, setStep] = useState<Step>("intro");
  const [profile, setProfile] = useState<ProfileInput>(() => {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (p.profile) return p.profile;
        } catch {}
      }
    }
    return {
      name: "",
      email: "",
      company: "",
      role: "",
      industry: "other",
      country: "ksa",
      revenueBand: "250m-1b",
      employeeCountBand: "1000-5000",
      language: lang,
      optInMarketing: false,
    };
  });

  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (p.answers) return p.answers;
        } catch {}
      }
    }
    return {};
  });

  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [activeUC, setActiveUC] = useState<number>(0);

  useEffect(() => {
    if (def.slug === "uvr" && useCases.length === 0) {
      setUseCases([{ id: crypto.randomUUID(), name: "", answers: {} }]);
    }
  }, [def.slug, useCases.length]);

  useEffect(() => {
    setProfile((p) => ({ ...p, language: lang }));
  }, [lang]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify({ profile, answers }));
  }, [profile, answers, storageKey]);

  const flatQuestions: { dimIdx: number; qIdx: number; q: Question }[] = useMemo(() => {
    const list: { dimIdx: number; qIdx: number; q: Question }[] = [];
    def.dimensions.forEach((dim, di) => {
      dim.questions.forEach((q, qi) => list.push({ dimIdx: di, qIdx: qi, q }));
    });
    return list;
  }, [def]);

  const activeAnswers =
    def.slug === "uvr" && useCases[activeUC] ? useCases[activeUC].answers : answers;

  const visibleQuestions = useMemo(
    () => flatQuestions.filter(({ q }) => isQuestionActive(q, activeAnswers)),
    [flatQuestions, activeAnswers],
  );

  const [qIndex, setQIndex] = useState(0);
  const currentQ = visibleQuestions[qIndex];
  const progressPct = visibleQuestions.length === 0 ? 0 : Math.round(((qIndex + 1) / visibleQuestions.length) * 100);

  const setQAnswer = (qid: string, optId: string) => {
    if (def.slug === "uvr") {
      setUseCases((prev) => {
        const next = [...prev];
        next[activeUC] = { ...next[activeUC], answers: { ...next[activeUC].answers, [qid]: optId } };
        return next;
      });
    } else {
      setAnswers((prev) => ({ ...prev, [qid]: optId }));
    }
  };

  const submit = async () => {
    setStep("loading");
    const sub: SubmissionInput = {
      slug: def.slug,
      profile,
      answers,
      useCases: def.slug === "uvr" ? useCases.map((u) => ({ id: u.id, name: u.name || "Untitled use case", answers: u.answers })) : undefined,
      teamToken,
    };
    try {
      const resp = await submitAssessment(sub);
      window.localStorage.removeItem(storageKey);
      navigate(`/assessments/${def.slug}/results/${resp.publicId}`);
    } catch (err) {
      console.error(err);
      setStep("questions");
      alert(tStr({ en: "Submission failed. Please try again.", ar: "فشل الإرسال. حاول مرة أخرى." }, lang));
    }
  };

  const profileValid =
    profile.name.trim().length > 1 &&
    profile.email.includes("@") &&
    profile.company.trim().length > 1 &&
    profile.role.trim().length > 1;

  return (
    <div dir={dir} className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Top bar */}
      <div className="bg-[#0E2841] text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="inline-block w-2 h-8 rounded-sm"
              style={{ backgroundColor: def.brandColor }}
            />
            <div>
              <p className="text-xs uppercase tracking-widest text-[#0F9ED5] font-semibold">
                {def.code}
              </p>
              <h1 className="text-base font-bold leading-tight">
                {tStr(def.title, lang)}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="text-xs font-medium bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition"
              data-testid="button-toggle-lang"
            >
              <Globe className="inline mr-1" size={12} />
              {lang === "en" ? "العربية" : "English"}
            </button>
          </div>
        </div>
        {step === "questions" && (
          <div className="h-1 bg-white/10">
            <div
              className="h-1 transition-all"
              style={{ width: `${progressPct}%`, backgroundColor: def.brandColor }}
            />
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <AnimatePresence mode="wait">
          {step === "intro" && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0E2841] leading-tight">
                {tStr(def.subtitle, lang)}
              </h2>
              <p className="mt-4 text-lg text-gray-600 leading-relaxed">
                {tStr(def.description, lang)}
              </p>
              <div className="mt-8 grid sm:grid-cols-3 gap-4">
                <Stat
                  label={tStr(ui.common.estTime, lang)}
                  value={`${def.estMinutes} ${tStr(ui.common.minutes, lang)}`}
                />
                <Stat
                  label={tStr({ en: "Dimensions", ar: "الأبعاد" }, lang)}
                  value={String(def.dimensions.length)}
                />
                <Stat
                  label={tStr({ en: "GCC peer benchmark", ar: "مقارنة الأقران الخليجيين" }, lang)}
                  value="✓"
                />
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <ShieldCheck size={16} className="text-[#196B24]" />
                <span>
                  {tStr(
                    {
                      en: "Sovereign / GCC-native sub-score included. PDPL-aware.",
                      ar: "نتيجة فرعية سيادية مضمنة. متوافقة مع PDPL.",
                    },
                    lang,
                  )}
                </span>
              </div>
              <button
                onClick={() => setStep("profile")}
                className="mt-10 inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] text-white font-bold px-7 py-3.5 rounded-xl text-base shadow-lg transition"
                data-testid="button-start-assessment"
              >
                {tStr(ui.common.intro, lang)} <ArrowRight size={18} />
              </button>
            </motion.div>
          )}

          {step === "profile" && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-[#0E2841]">
                {tStr(ui.common.profileTitle, lang)}
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                {tStr(
                  {
                    en: "We use this to calibrate against the right GCC peer cohort.",
                    ar: "نستخدم هذه البيانات لمعايرة المقارنة مع المجموعة الخليجية الصحيحة.",
                  },
                  lang,
                )}
              </p>
              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <Field label={tStr(ui.common.name, lang)}>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082]"
                    data-testid="input-profile-name"
                  />
                </Field>
                <Field label={tStr(ui.common.workEmail, lang)}>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082]"
                    data-testid="input-profile-email"
                  />
                </Field>
                <Field label={tStr(ui.common.company, lang)}>
                  <input
                    type="text"
                    value={profile.company}
                    onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082]"
                    data-testid="input-profile-company"
                  />
                </Field>
                <Field label={tStr(ui.common.role, lang)}>
                  <input
                    type="text"
                    value={profile.role}
                    onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082]"
                    data-testid="input-profile-role"
                  />
                </Field>
                <Field label={tStr(ui.common.industry, lang)}>
                  <select
                    value={profile.industry}
                    onChange={(e) => setProfile({ ...profile, industry: e.target.value as ProfileInput["industry"] })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082] bg-white"
                    data-testid="select-profile-industry"
                  >
                    {INDUSTRIES.map((i) => (
                      <option key={i} value={i}>
                        {tStr(ui.industries[i], lang)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tStr(ui.common.country, lang)}>
                  <select
                    value={profile.country}
                    onChange={(e) => setProfile({ ...profile, country: e.target.value as ProfileInput["country"] })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082] bg-white"
                    data-testid="select-profile-country"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {tStr(ui.countries[c], lang)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tStr(ui.common.revenueBand, lang)}>
                  <select
                    value={profile.revenueBand}
                    onChange={(e) => setProfile({ ...profile, revenueBand: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082] bg-white"
                    data-testid="select-profile-revenue"
                  >
                    {REVENUE_BANDS.map((b) => (
                      <option key={b} value={b}>
                        {tStr(ui.revenueBands[b], lang)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tStr(ui.common.employeeBand, lang)}>
                  <select
                    value={profile.employeeCountBand}
                    onChange={(e) => setProfile({ ...profile, employeeCountBand: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#156082] bg-white"
                    data-testid="select-profile-employees"
                  >
                    {EMP_BANDS.map((b) => (
                      <option key={b} value={b}>
                        {tStr(ui.employeeBands[b], lang)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={profile.optInMarketing}
                  onChange={(e) => setProfile({ ...profile, optInMarketing: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                {tStr(ui.common.optInMarketing, lang)}
              </label>
              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => setStep("intro")}
                  className="inline-flex items-center gap-2 text-gray-600 hover:text-[#0E2841] font-medium px-4 py-2 transition"
                >
                  <ArrowLeft size={16} /> {tStr(ui.common.back, lang)}
                </button>
                <button
                  disabled={!profileValid}
                  onClick={() => {
                    setStep("questions");
                    setQIndex(0);
                  }}
                  className="inline-flex items-center gap-2 bg-[#156082] hover:bg-[#0F4D6B] disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition"
                  data-testid="button-profile-next"
                >
                  {tStr(ui.common.next, lang)} <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {step === "questions" && currentQ && (
            <motion.div
              key={`q-${currentQ.q.id}-${activeUC}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {def.slug === "uvr" && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs uppercase tracking-widest text-amber-700 font-bold mb-2">
                    {tStr({ en: "Use case", ar: "حالة استخدام" }, lang)} {activeUC + 1} {tStr(ui.common.of, lang)} {useCases.length}
                  </p>
                  <input
                    type="text"
                    placeholder={tStr({ en: "Name this use case (e.g. Agentic procurement)", ar: "سمّ هذه الحالة (مثلاً: مشتريات وكيلية)" }, lang)}
                    value={useCases[activeUC]?.name ?? ""}
                    onChange={(e) => {
                      setUseCases((prev) => {
                        const next = [...prev];
                        next[activeUC] = { ...next[activeUC], name: e.target.value };
                        return next;
                      });
                    }}
                    className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm"
                    data-testid={`input-uvr-usecase-${activeUC}`}
                  />
                </div>
              )}
              <p className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-2">
                {tStr(def.dimensions[currentQ.dimIdx].title, lang)}
              </p>
              <p className="text-xs text-gray-400 mb-6">
                {tStr(ui.common.questionOf, lang).replace("{n}", String(qIndex + 1)).replace("{total}", String(visibleQuestions.length))}
              </p>
              <h2 className="text-xl sm:text-2xl font-bold text-[#0E2841] leading-snug">
                {tStr(currentQ.q.prompt, lang)}
              </h2>
              <div className="mt-6 space-y-3">
                {currentQ.q.options.map((opt) => {
                  const selected = activeAnswers[currentQ.q.id] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setQAnswer(currentQ.q.id, opt.id)}
                      className={`w-full text-left border rounded-xl px-5 py-4 transition group ${
                        selected
                          ? "border-[#156082] bg-blue-50 shadow-md"
                          : "border-gray-200 hover:border-[#156082] hover:bg-blue-50/30"
                      }`}
                      data-testid={`option-${currentQ.q.id}-${opt.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selected ? "border-[#156082] bg-[#156082]" : "border-gray-300"
                          }`}
                        >
                          {selected && <CheckCircle2 size={14} className="text-white" />}
                        </span>
                        <span className="text-sm text-gray-800 leading-snug">
                          {tStr(opt.label, lang)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => {
                    if (qIndex > 0) setQIndex(qIndex - 1);
                    else setStep("profile");
                  }}
                  className="inline-flex items-center gap-2 text-gray-600 hover:text-[#0E2841] font-medium px-4 py-2"
                >
                  <ArrowLeft size={16} /> {tStr(ui.common.back, lang)}
                </button>
                {qIndex < visibleQuestions.length - 1 ? (
                  <button
                    disabled={!activeAnswers[currentQ.q.id]}
                    onClick={() => setQIndex(qIndex + 1)}
                    className="inline-flex items-center gap-2 bg-[#156082] hover:bg-[#0F4D6B] disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl"
                    data-testid="button-next-question"
                  >
                    {tStr(ui.common.next, lang)} <ChevronRight size={16} />
                  </button>
                ) : def.slug === "uvr" && activeUC < useCases.length - 1 ? (
                  <button
                    onClick={() => {
                      setActiveUC(activeUC + 1);
                      setQIndex(0);
                    }}
                    className="inline-flex items-center gap-2 bg-[#156082] hover:bg-[#0F4D6B] text-white font-semibold px-6 py-3 rounded-xl"
                  >
                    {tStr({ en: "Next use case", ar: "الحالة التالية" }, lang)} <ChevronRight size={16} />
                  </button>
                ) : def.slug === "uvr" && useCases.length < 3 ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setUseCases((prev) => [...prev, { id: crypto.randomUUID(), name: "", answers: {} }]);
                        setActiveUC(useCases.length);
                        setQIndex(0);
                      }}
                      className="inline-flex items-center gap-2 bg-white border-2 border-[#156082] text-[#156082] font-semibold px-5 py-3 rounded-xl"
                    >
                      + {tStr({ en: "Add another use case", ar: "أضف حالة أخرى" }, lang)}
                    </button>
                    <button
                      onClick={submit}
                      className="inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] text-white font-bold px-6 py-3 rounded-xl shadow-lg"
                      data-testid="button-submit-assessment"
                    >
                      <Sparkles size={16} /> {tStr(ui.common.submit, lang)}
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={!activeAnswers[currentQ.q.id]}
                    onClick={submit}
                    className="inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] disabled:opacity-50 text-white font-bold px-6 py-3 rounded-xl shadow-lg"
                    data-testid="button-submit-assessment"
                  >
                    <Sparkles size={16} /> {tStr(ui.common.submit, lang)}
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {step === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <Loader2 className="mx-auto animate-spin text-[#156082]" size={48} />
              <h3 className="mt-6 text-xl font-bold text-[#0E2841]">
                {tStr(ui.common.finalize, lang)}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {tStr(ui.common.finalizeNote, lang)}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-xl p-4 bg-white">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-[#0E2841] mt-1">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
