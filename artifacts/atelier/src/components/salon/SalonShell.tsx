import * as React from "react";
import { Link, useLocation, useRoute } from "wouter";

// =============================================================
// Lightweight i18n — task #242
// =============================================================
type Lang = "en" | "ar";
const STR: Record<string, { en: string; ar: string }> = {
  overview: { en: "Overview", ar: "نظرة عامة" },
  value: { en: "Value", ar: "القيمة" },
  workplan: { en: "Work plan", ar: "خطة العمل" },
  deliverables: { en: "Deliverables", ar: "المخرجات" },
  decisions: { en: "Decisions", ar: "القرارات" },
  meetings: { en: "Meetings", ar: "الاجتماعات" },
  team: { en: "Team", ar: "الفريق" },
  requests: { en: "Requests", ar: "الطلبات" },
  settings: { en: "Settings", ar: "الإعدادات" },
  approve: { en: "Approve", ar: "اعتماد" },
  request_change: { en: "Request change", ar: "طلب تعديل" },
  comment: { en: "Comment", ar: "تعليق" },
  request_copy: { en: "Request copy", ar: "طلب نسخة" },
  download: { en: "Download", ar: "تنزيل" },
  download_blocked: {
    en: "Download blocked by client policy. Use Request copy to ask the engagement lead.",
    ar: "التنزيل محظور بموجب سياسة العميل. استخدم زر طلب نسخة لطلبه من قائد التكليف.",
  },
  rationale_required: { en: "Rationale (required)", ar: "السبب (مطلوب)" },
  send: { en: "Send", ar: "إرسال" },
  signed_in_as: { en: "Signed in as", ar: "متصل باسم" },
  language: { en: "Language", ar: "اللغة" },
};

interface SalonI18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: string) => string;
}
const I18nContext = React.createContext<SalonI18nCtx>({
  lang: "en",
  setLang: () => {},
  t: (k) => STR[k]?.en ?? k,
});
export function useSalonI18n() {
  return React.useContext(I18nContext);
}

export function SalonI18nProvider(props: {
  defaultLang?: Lang;
  children: React.ReactNode;
}) {
  const [lang, setLang] = React.useState<Lang>(props.defaultLang ?? "en");
  React.useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    };
  }, [lang]);
  const t = React.useCallback(
    (k: string) => STR[k]?.[lang] ?? STR[k]?.en ?? k,
    [lang],
  );
  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {props.children}
    </I18nContext.Provider>
  );
}

// =============================================================
// Watermark — diagonal CSS overlay with persona name+email+ts+slug
// =============================================================
export function SalonWatermark(props: {
  name: string;
  email: string;
  engagementSlug: string;
}) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const text = `${props.name} · ${props.email} · ${props.engagementSlug} · ${ts}`;
  // Repeated SVG-like text via repeated CSS background — pure CSS, low CPU.
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[5] select-none"
      style={{
        backgroundImage: `repeating-linear-gradient(transparent 0 119px, rgba(0,0,0,0) 119px 120px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
          gridTemplateRows: "repeat(auto-fill, 160px)",
          opacity: 0.07,
          color: "currentColor",
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          transform: "rotate(-22deg)",
          transformOrigin: "center",
        }}
      >
        {Array.from({ length: 80 }).map((_, i) => (
          <div key={i} style={{ padding: 8, whiteSpace: "nowrap" }}>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================
// SalonShell — co-branded chrome
// =============================================================
export interface SalonMe {
  id: string;
  name: string;
  email: string;
  initials: string;
  title: string | null;
  locale: "en" | "ar";
  role: "client_user";
  accountId: string;
  engagements: Array<{
    workspaceSlug: string | null;
    workspaceName: string | null;
    accentColor: string;
    role: "admin" | "approver" | "viewer";
    canApprove: boolean;
    downloadsAllowed: boolean;
  }>;
}

export interface SalonWorkspace {
  id: string;
  slug: string;
  displayName: string;
  accentColor: string;
  clientLogoUrl: string | null;
  cogniriseLogoUrl: string | null;
  eyebrowText: string | null;
  defaultLocale: string;
  rtlEnabled: boolean;
  watermarkEnabled: boolean;
}

const TABS: Array<{ key: string; path: string }> = [
  { key: "overview", path: "" },
  { key: "value", path: "/value" },
  { key: "workplan", path: "/workplan" },
  { key: "deliverables", path: "/deliverables" },
  { key: "decisions", path: "/decisions" },
  { key: "meetings", path: "/meetings" },
  { key: "team", path: "/team" },
  { key: "requests", path: "/requests" },
  { key: "settings", path: "/settings" },
];

export function SalonShell(props: {
  me: SalonMe;
  workspace: SalonWorkspace;
  children: React.ReactNode;
}) {
  const { t, lang, setLang } = useSalonI18n();
  const [location] = useLocation();
  const baseHref = `/salon/${props.workspace.slug}`;
  return (
    <div
      className="min-h-screen bg-bg text-text"
      style={
        {
          ["--salon-accent" as string]: props.workspace.accentColor,
        } as React.CSSProperties
      }
    >
      {props.workspace.watermarkEnabled && (
        <SalonWatermark
          name={props.me.name}
          email={props.me.email}
          engagementSlug={props.workspace.slug}
        />
      )}
      <header
        className="sticky top-0 z-30 w-full border-b border-border bg-bg/90 backdrop-blur"
        style={{ borderTopWidth: 3, borderTopStyle: "solid", borderTopColor: "var(--salon-accent)" }}
      >
        <div className="px-4 md:px-6 py-3 flex items-center gap-4">
          <Link href="/salon" className="font-mono text-xs uppercase tracking-widest text-text-mute hover:text-text">
            ⌂ Salon
          </Link>
          <span className="text-text-mute">·</span>
          <div>
            <div className="text-sm font-semibold">{props.workspace.displayName}</div>
            {props.workspace.eyebrowText && (
              <div className="text-[11px] uppercase tracking-wider text-text-mute">
                {props.workspace.eyebrowText}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-text-mute">
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="px-2 py-1 rounded border border-border hover:border-text-mute"
              title={t("language")}
            >
              {lang === "en" ? "العربية" : "English"}
            </button>
            <span className="hidden md:inline">{t("signed_in_as")} <strong className="text-text">{props.me.name}</strong></span>
          </div>
        </div>
        <nav className="px-4 md:px-6 flex items-center gap-1 overflow-x-auto text-sm">
          {TABS.map((tab) => {
            const href = `${baseHref}${tab.path}`;
            const active =
              tab.path === ""
                ? location === baseHref
                : location.startsWith(href);
            return (
              <Link
                key={tab.key}
                href={href}
                className={`px-3 py-2 border-b-2 transition-colors ${
                  active
                    ? "border-[var(--salon-accent)] text-text"
                    : "border-transparent text-text-mute hover:text-text"
                }`}
              >
                {t(tab.key)}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="relative z-10 px-4 md:px-6 py-6 max-w-6xl mx-auto">
        {props.children}
      </main>
    </div>
  );
}
