/**
 * Concept doc viewer for the Maven Personal Agent.
 *
 * The full 19-section concept doc lives at
 * `artifacts/maven-ai/docs/personal-ai-assistant/concept.md` so it is
 * version-controlled, easy to grep, and editable in any markdown editor.
 *
 * We import it as raw text via Vite's `?raw` suffix and render it with a
 * minimal, dependency-free markdown renderer. This avoids pulling in `marked`
 * or `react-markdown` for what is essentially a one-page reading view.
 */
import { ArrowLeft, BookOpen, MessageSquare, Brain, ExternalLink, Download } from "lucide-react";
import { Link } from "wouter";
import { useMemo } from "react";
import conceptMd from "@/../docs/personal-ai-assistant/concept.md?raw";
import { useLang, tStr } from "@/lib/lang";

// Concept-page localization. Body remains the canonical English doc (the
// translated docs are tracked as a follow-up task) but the chrome — hero,
// CTAs, callouts — speaks the same EN/AR/TR as the rest of the surface so
// a buyer who switches language doesn't bounce off an English-only page.
const COPY = {
  back: { en: "Back to Maven Personal Agent", ar: "العودة إلى مساعد Maven الشخصي", tr: "Maven Kişisel Ajan'a dön" },
  badge: { en: "Concept doc", ar: "وثيقة المفهوم", tr: "Konsept belgesi" },
  title: { en: "Maven Personal Agent — concept & research", ar: "مساعد Maven الشخصي — المفهوم والبحث", tr: "Maven Kişisel Ajan — konsept ve araştırma" },
  blurb: {
    en: "The 19-section product brief behind the demo: the user it's for, the wedge against incumbents (Cedric, M365 Copilot Memory, ChatGPT Memory), the Personal Context Graph, the glass-box trust model, the autonomy ladder, the privacy-by-construction model, and the path from L1 to L4.",
    ar: "الموجز المكوّن من 19 قسماً وراء العرض: المستخدم المستهدف، الفارق عن المنافسين (Cedric وذاكرة M365 Copilot وذاكرة ChatGPT)، رسم السياق الشخصي، نموذج الثقة الشفّاف، سلّم الاستقلالية، الخصوصية بالتصميم، والمسار من L1 إلى L4.",
    tr: "Demonun arkasındaki 19 bölümlük ürün özeti: hedef kullanıcı, mevcutlara (Cedric, M365 Copilot Memory, ChatGPT Memory) karşı kama, Kişisel Bağlam Grafiği, cam-kutu güven modeli, özerklik merdiveni, tasarımdan-itibaren-gizlilik modeli ve L1'den L4'e yol.",
  },
  openCockpit: { en: "Open the Cockpit", ar: "افتح القمرة", tr: "Kokpit'i aç" },
  openMind: { en: "Open the Mind", ar: "افتح العقل", tr: "Zihni aç" },
  download: { en: "Download .md", ar: "نزّل .md", tr: ".md indir" },
  enNote: {
    en: "The body of this document is currently English-only. Arabic and Turkish translations are in flight.",
    ar: "نص هذه الوثيقة حالياً بالإنجليزية فقط. الترجمتان العربية والتركية قيد الإعداد.",
    tr: "Bu belgenin gövdesi şu anda yalnızca İngilizcedir. Arapça ve Türkçe çeviriler hazırlanıyor.",
  },
  outroKicker: { en: "Now see it move", ar: "الآن شاهده يتحرّك", tr: "Şimdi onu hareket halinde gör" },
  outroTitle: { en: "The doc is the why. The demos are the what.", ar: "الوثيقة هي السبب. العرضان هما الكيف.", tr: "Belge nedendir. Demolar nedir." },
  outroBody: {
    en: "The Cockpit shows a day-in-the-life: chat grounded in the PCG, a workspace of pending approvals and personal nudges, and a glass-box rail that drops a receipt every time the agent acts. The Mind shows the PCG itself — every node, when it was learned, where from, and how the agent has used it — and lets you drag a time scrubber from Day 1 to Year 1.",
    ar: "تعرض القمرة يوماً نموذجياً: دردشة مستندة إلى الرسم، مساحة عمل بالموافقات المعلّقة والتنبيهات الشخصية، وشريط شفّاف يترك إيصالاً كلّما تصرّف المساعد. يعرض العقل الرسم نفسه — كل عقدة، متى تعلّمتها ومن أين وكيف استخدمها المساعد — مع شريط زمني من اليوم الأول إلى السنة الأولى.",
    tr: "Kokpit bir günlük yaşamı gösterir: PCG'ye dayalı sohbet, bekleyen onaylar ve kişisel hatırlatmalardan oluşan bir çalışma alanı ve ajan her hareket ettiğinde bir makbuz bırakan cam-kutu şeridi. Zihin PCG'nin kendisini gösterir — her düğüm, ne zaman, nereden öğrenildi ve ajan tarafından nasıl kullanıldı — ve 1. Günden 1. Yıla bir zaman çubuğu sürüklemenize izin verir.",
  },
};

// ---- Tiny markdown renderer ------------------------------------------------
// Handles: H1/H2/H3, blockquotes, ordered/unordered lists (single-level),
// code spans, bold/italic, links, paragraph breaks, horizontal rules.
// Intentionally minimal — anything fancier should live in the source doc.
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split(/\r?\n/);
  const blocks: { kind: string; lines: string[] }[] = [];
  let cur: { kind: string; lines: string[] } | null = null;

  const push = () => {
    if (cur && cur.lines.length > 0) blocks.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line === "") {
      push();
      continue;
    }
    if (line.startsWith("# ")) {
      push();
      blocks.push({ kind: "h1", lines: [line.slice(2)] });
      continue;
    }
    if (line.startsWith("## ")) {
      push();
      blocks.push({ kind: "h2", lines: [line.slice(3)] });
      continue;
    }
    if (line.startsWith("### ")) {
      push();
      blocks.push({ kind: "h3", lines: [line.slice(4)] });
      continue;
    }
    if (line === "---") {
      push();
      blocks.push({ kind: "hr", lines: [] });
      continue;
    }
    if (line === ">" || line.startsWith("> ")) {
      if (!cur || cur.kind !== "blockquote") {
        push();
        cur = { kind: "blockquote", lines: [] };
      }
      cur.lines.push(line === ">" ? "" : line.slice(2));
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      if (!cur || cur.kind !== "ol") {
        push();
        cur = { kind: "ol", lines: [] };
      }
      cur.lines.push(line.replace(/^\s*\d+\.\s/, ""));
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      if (!cur || cur.kind !== "ul") {
        push();
        cur = { kind: "ul", lines: [] };
      }
      cur.lines.push(line.replace(/^\s*[-*]\s/, ""));
      continue;
    }
    if (!cur || cur.kind !== "p") {
      push();
      cur = { kind: "p", lines: [] };
    }
    cur.lines.push(line);
  }
  push();

  return blocks.map((b, i) => {
    switch (b.kind) {
      case "h1":
        return <h1 key={i} className="text-3xl md:text-4xl font-extrabold text-[#0E2841] mt-2 mb-5 leading-tight">{inline(b.lines[0])}</h1>;
      case "h2":
        return <h2 key={i} className="text-xl md:text-2xl font-extrabold text-[#0E2841] mt-9 mb-3 leading-snug">{inline(b.lines[0])}</h2>;
      case "h3":
        return <h3 key={i} className="text-lg font-bold text-[#0E2841] mt-6 mb-2 leading-snug">{inline(b.lines[0])}</h3>;
      case "hr":
        return <hr key={i} className="my-6 border-gray-200" />;
      case "blockquote":
        return (
          <blockquote key={i} className="my-4 pl-4 border-l-4 border-[#a78bfa] text-gray-700 text-base italic">
            {b.lines.map((l, j) => <p key={j}>{inline(l)}</p>)}
          </blockquote>
        );
      case "ul":
        return (
          <ul key={i} className="my-3 ml-6 list-disc space-y-1.5 text-gray-700 text-base leading-relaxed">
            {b.lines.map((l, j) => <li key={j}>{inline(l)}</li>)}
          </ul>
        );
      case "ol":
        return (
          <ol key={i} className="my-3 ml-6 list-decimal space-y-1.5 text-gray-700 text-base leading-relaxed">
            {b.lines.map((l, j) => <li key={j}>{inline(l)}</li>)}
          </ol>
        );
      case "p":
      default:
        return <p key={i} className="my-3 text-gray-700 text-base leading-relaxed">{inline(b.lines.join(" "))}</p>;
    }
  });
}

// Inline parsing: code, bold, italic, links — applied in that order with a
// simple split/recurse approach. Skips all lookahead complexity.
function inline(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/;
  while (rest.length > 0) {
    const m = rest.match(pattern);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(<code key={key++} className="px-1.5 py-0.5 rounded bg-gray-100 text-[0.92em] text-[#0E2841] font-mono">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key++} className="font-bold text-[#0E2841]">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("[")) {
      const linkMatch = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        out.push(
          <a key={key++} href={href} className="text-[#0F9ED5] underline hover:text-[#0E7BAF]" target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
            {label}
          </a>,
        );
      } else {
        out.push(tok);
      }
    } else {
      out.push(tok);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return <>{out}</>;
}

export default function PersonalAgentConcept() {
  const { lang } = useLang();
  const body = useMemo(() => renderMarkdown(conceptMd), []);
  // Build a real .md download from the imported raw source. Done lazily on
  // click so SSR / first paint don't pay the Blob cost. The filename
  // includes a date so re-downloads after edits don't collide locally.
  const handleDownload = () => {
    const blob = new Blob([conceptMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maven-personal-agent-concept-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#0E2841] via-[#091828] to-[#0E2841] text-white py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/marketplace/maven-personal-agent" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-bold uppercase tracking-widest mb-4">
            <ArrowLeft size={12} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#a78bfa]/20 text-[#c4b5fd] text-[10px] font-bold uppercase tracking-widest mb-3">
            <BookOpen size={11} /> {tStr(COPY.badge, lang)}
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold leading-tight mb-3">
            {tStr(COPY.title, lang)}
          </h1>
          <p className="text-base text-gray-300 leading-relaxed max-w-2xl">
            {tStr(COPY.blurb, lang)}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/demo/maven-personal-agent/cockpit" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#a78bfa] text-[#0E2841] font-bold text-xs hover:bg-[#c4b5fd]">
              <MessageSquare size={12} /> {tStr(COPY.openCockpit, lang)}
              <ExternalLink size={10} />
            </Link>
            <Link href="/demo/maven-personal-agent/mind" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 text-white font-bold text-xs hover:bg-white/20">
              <Brain size={12} /> {tStr(COPY.openMind, lang)}
              <ExternalLink size={10} />
            </Link>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 text-white font-bold text-xs hover:bg-white/20"
              data-testid="button-download-concept"
            >
              <Download size={12} /> {tStr(COPY.download, lang)}
            </button>
          </div>
        </div>
      </section>

      {/* Body */}
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {lang !== "en" && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            {tStr(COPY.enNote, lang)}
          </div>
        )}
        {body}

        <hr className="my-10 border-gray-200" />
        <div className="rounded-2xl bg-gradient-to-br from-[#a78bfa]/10 to-[#0F9ED5]/10 p-6 border border-[#a78bfa]/20">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a78bfa] mb-2">{tStr(COPY.outroKicker, lang)}</p>
          <h3 className="text-xl font-extrabold text-[#0E2841] mb-2">{tStr(COPY.outroTitle, lang)}</h3>
          <p className="text-sm text-gray-700 leading-relaxed mb-4">
            {tStr(COPY.outroBody, lang)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/demo/maven-personal-agent/cockpit" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#a78bfa] text-[#0E2841] font-bold text-xs hover:bg-[#c4b5fd]">
              <MessageSquare size={12} /> {tStr(COPY.openCockpit, lang)}
            </Link>
            <Link href="/demo/maven-personal-agent/mind" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0E2841] text-white font-bold text-xs hover:bg-[#091828]">
              <Brain size={12} /> {tStr(COPY.openMind, lang)}
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
