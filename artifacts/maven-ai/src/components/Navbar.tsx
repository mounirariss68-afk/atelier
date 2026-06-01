import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Logo from "./Logo";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLang, tStr, type T } from "@/lib/lang";

const NAV: Record<string, T> = {
  home: { en: "Home", ar: "الرئيسية", tr: "Ana Sayfa" },
  about: { en: "About", ar: "من نحن", tr: "Hakkımızda" },
  services: { en: "Services", ar: "الخدمات", tr: "Hizmetler" },
  insights: { en: "Insights", ar: "الرؤى", tr: "İçgörüler" },
  industries: { en: "Industries", ar: "القطاعات", tr: "Sektörler" },
  marketplace: { en: "Marketplace", ar: "السوق", tr: "Marketplace" },
  diagnostics: { en: "Diagnostics", ar: "التشخيصات", tr: "Tanılamalar" },
  allServices: { en: "View All Services →", ar: "عرض جميع الخدمات ←", tr: "Tüm Hizmetleri Gör →" },
  allInsights: { en: "All Insights", ar: "جميع الرؤى", tr: "Tüm İçgörüler" },
  freeAssessment: { en: "Free Assessment", ar: "تقييم مجاني", tr: "Ücretsiz Değerlendirme" },
  talkToUs: { en: "Talk to Us", ar: "تواصل معنا", tr: "Bize Ulaşın" },
  signIn: { en: "Sign in", ar: "تسجيل الدخول", tr: "Giriş yap" },
  toggleMenu: { en: "Toggle menu", ar: "تبديل القائمة", tr: "Menüyü aç/kapat" },
};

// The Atelier (employee portal) lives at /atelier/sign-in. We use a normal
// anchor (not wouter Link) because the portal is a separate artifact mounted
// at a different base path on the same origin.
const ATELIER_SIGN_IN = "/atelier/sign-in";

const SERVICE_LINKS: { href: string; label: T }[] = [
  { href: "/services/agentic-ai-transformation", label: { en: "Agentic AI Transformation", ar: "تحول الذكاء الوكيل", tr: "Ajansal AI Dönüşümü" } },
  { href: "/services/ai-driven-sdlc", label: { en: "AI-Driven SDLC & Legacy Modernization", ar: "دورة تطوير مدفوعة بالذكاء الاصطناعي وتحديث الأنظمة القديمة", tr: "AI Öncülüğünde SDLC & Eski Sistem Modernizasyonu" } },
  { href: "/services/data-governance-foundations", label: { en: "Data & Governance Foundations", ar: "أسس البيانات والحوكمة", tr: "Veri & Yönetişim Temelleri" } },
  { href: "/services/ai-product-studio", label: { en: "AI Product Studio", ar: "استوديو منتجات الذكاء الاصطناعي", tr: "AI Ürün Stüdyosu" } },
];

const INSIGHT_LINKS: { href: string; label: T }[] = [
  { href: "/insights?category=Agentic+AI", label: { en: "Agentic AI", ar: "الذكاء الوكيل", tr: "Ajansal AI" } },
  { href: "/insights?category=Data+%26+Governance", label: { en: "Data & Governance", ar: "البيانات والحوكمة", tr: "Veri & Yönetişim" } },
  { href: "/insights?category=Legacy+Modernization", label: { en: "Legacy Modernization", ar: "تحديث الأنظمة القديمة", tr: "Eski Sistem Modernizasyonu" } },
  { href: "/insights?category=Industry+Trends", label: { en: "Industry Trends", ar: "اتجاهات القطاع", tr: "Sektör Trendleri" } },
];

export default function Navbar() {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const isActive = (path: string) => location.startsWith(path);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-[#0A1230]/98 shadow-xl backdrop-blur-sm" : "bg-[#0A1230]"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link href="/" className="flex items-center group" aria-label="Cognirise">
            <Logo size="md" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8 ml-8 xl:ml-12">
            <Link href="/" className={`nav-link text-sm font-medium transition-colors ${location === "/" ? "text-[#5B7CFF]" : "text-gray-200 hover:text-white"}`}>
              {t(NAV.home)}
            </Link>
            <Link href="/about" className={`nav-link text-sm font-medium transition-colors ${isActive("/about") ? "text-[#5B7CFF]" : "text-gray-200 hover:text-white"}`}>
              {t(NAV.about)}
            </Link>

            <div className="relative" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
              <button className={`nav-link text-sm font-medium transition-colors flex items-center gap-1 ${isActive("/services") ? "text-[#5B7CFF]" : "text-gray-200 hover:text-white"}`}>
                {t(NAV.services)} <ChevronDown size={14} className={`transition-transform ${servicesOpen ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {servicesOpen && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.15 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
                    <div className="py-2">
                      {SERVICE_LINKS.map((link) => (
                        <Link key={link.href} href={link.href} className="block px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#5B7CFF] transition-colors font-medium">
                          {t(link.label)}
                        </Link>
                      ))}
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <Link href="/services" className="block px-5 py-3 text-sm text-[#5B7CFF] font-semibold hover:bg-blue-50 transition-colors">
                          {t(NAV.allServices)}
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative" onMouseEnter={() => setInsightsOpen(true)} onMouseLeave={() => setInsightsOpen(false)}>
              <button className={`nav-link text-sm font-medium transition-colors flex items-center gap-1 ${isActive("/insights") ? "text-[#5B7CFF]" : "text-gray-200 hover:text-white"}`}>
                {t(NAV.insights)} <ChevronDown size={14} className={`transition-transform ${insightsOpen ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {insightsOpen && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.15 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
                    <div className="py-2">
                      <Link href="/insights" className="block px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#5B7CFF] transition-colors font-medium">
                        {t(NAV.allInsights)}
                      </Link>
                      {INSIGHT_LINKS.map((link) => (
                        <Link key={link.href} href={link.href} className="block px-5 py-3 text-sm text-gray-600 hover:bg-gray-50 hover:text-[#5B7CFF] transition-colors">
                          {t(link.label)}
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Link href="/industries" className={`nav-link text-sm font-medium transition-colors ${isActive("/industries") ? "text-[#5B7CFF]" : "text-gray-200 hover:text-white"}`}>
              {t(NAV.industries)}
            </Link>
            <Link href="/marketplace" className={`nav-link text-sm font-medium transition-colors ${isActive("/marketplace") ? "text-[#5B7CFF]" : "text-gray-200 hover:text-white"}`}>
              {t(NAV.marketplace)}
            </Link>
            <Link href="/assessments" className={`nav-link text-sm font-medium transition-colors ${isActive("/assessments") ? "text-[#C45BB8]" : "text-gray-200 hover:text-white"}`}>
              {t(NAV.diagnostics)}
            </Link>
          </nav>

          {/* Desktop CTA + LanguageSwitcher */}
          <div className="hidden lg:flex items-center gap-3">
            <LanguageSwitcher variant="navbar" />
            <a href={ATELIER_SIGN_IN} className="text-gray-300 hover:text-white text-sm font-medium transition-colors" data-testid="link-atelier-signin">
              {t(NAV.signIn)}
            </a>
            <Link href="/assessments" className="border border-[#5B7CFF] text-[#5B7CFF] hover:bg-[#5B7CFF] hover:text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
              {t(NAV.freeAssessment)}
            </Link>
            <Link href="/contact" className="bg-[#5B7CFF] hover:bg-[#4A6BE6] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              {t(NAV.talkToUs)}
            </Link>
          </div>

          <button className="lg:hidden text-white p-2" onClick={() => setMobileOpen(!mobileOpen)} aria-label={t(NAV.toggleMenu)}>
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="lg:hidden bg-[#0A1230] border-t border-white/10 overflow-hidden">
            <div className="px-4 py-4 space-y-1">
              <div className="pb-3 mb-2 border-b border-white/10 flex justify-center">
                <LanguageSwitcher variant="mobile" />
              </div>
              <Link href="/" className="block py-3 text-white font-medium border-b border-white/10">{t(NAV.home)}</Link>
              <Link href="/about" className="block py-3 text-white font-medium border-b border-white/10">{t(NAV.about)}</Link>
              <div className="py-2 border-b border-white/10">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">{t(NAV.services)}</p>
                {SERVICE_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="block py-2 pl-3 text-gray-300 text-sm hover:text-white">{t(link.label)}</Link>
                ))}
              </div>
              <div className="py-2 border-b border-white/10">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">{t(NAV.insights)}</p>
                <Link href="/insights" className="block py-2 pl-3 text-gray-300 text-sm hover:text-white">{t(NAV.allInsights)}</Link>
              </div>
              <Link href="/industries" className="block py-3 text-white font-medium border-b border-white/10">{t(NAV.industries)}</Link>
              <Link href="/marketplace" className="block py-3 text-white font-medium border-b border-white/10">{t(NAV.marketplace)}</Link>
              <Link href="/assessments" className="block py-3 text-white font-medium border-b border-white/10">{t(NAV.diagnostics)}</Link>
              <div className="pt-3 space-y-2">
                <Link href="/assessments" className="block text-center border border-[#5B7CFF] text-[#5B7CFF] font-semibold py-3 rounded-lg">
                  {t(NAV.freeAssessment)}
                </Link>
                <Link href="/contact" className="block text-center bg-[#5B7CFF] text-white font-semibold py-3 rounded-lg">
                  {t(NAV.talkToUs)}
                </Link>
                <a href={ATELIER_SIGN_IN} className="block text-center text-gray-300 hover:text-white text-sm font-medium py-2">
                  {t(NAV.signIn)}
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
