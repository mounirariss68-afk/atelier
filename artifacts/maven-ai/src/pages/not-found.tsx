import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";

const COPY = {
  eyebrow: { en: "404 — Page not found", ar: "404 — الصفحة غير موجودة", tr: "404 — Sayfa bulunamadı" },
  title: { en: "This page doesn't exist.", ar: "هذه الصفحة غير موجودة.", tr: "Bu sayfa mevcut değil." },
  body: { en: "The page you're looking for may have moved or never existed. Let's get you back on track.", ar: "الصفحة التي تبحث عنها ربما انتقلت أو لم توجد أبداً. لنُعِدْك إلى المسار الصحيح.", tr: "Aradığınız sayfa taşınmış veya hiç var olmamış olabilir. Sizi yola döndürelim." },
  home: { en: "Back to home", ar: "العودة إلى الرئيسية", tr: "Ana sayfaya dön" },
  contact: { en: "Contact us", ar: "تواصل معنا", tr: "Bize ulaşın" },
};

export default function NotFound() {
  const { lang, dir } = useLang();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F8F9FA] pt-20" dir={dir}>
      <div className="text-center max-w-lg mx-auto px-6">
        <p className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest mb-4">{tStr(COPY.eyebrow, lang)}</p>
        <h1 className="text-5xl font-extrabold text-[#0E2841] mb-5 leading-tight">
          {tStr(COPY.title, lang)}
        </h1>
        <p className="text-gray-600 text-lg mb-10 leading-relaxed">
          {tStr(COPY.body, lang)}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/" className="inline-flex items-center gap-2 bg-[#0E2841] hover:bg-[#156082] text-white font-bold px-7 py-3 rounded-xl text-sm transition-colors">
            {tStr(COPY.home, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
          </Link>
          <Link href="/contact" className="inline-flex items-center gap-2 border border-[#156082] text-[#156082] hover:bg-[#156082] hover:text-white font-semibold px-7 py-3 rounded-xl text-sm transition-colors">
            {tStr(COPY.contact, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
          </Link>
        </div>
      </div>
    </div>
  );
}
