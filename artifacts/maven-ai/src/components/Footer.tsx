import { Link } from "wouter";
import { Linkedin, Twitter, Mail, MapPin, Phone } from "lucide-react";
import Logo from "./Logo";
import { useLang, tStr, type T } from "@/lib/lang";

const offices: { city: T; country: T; address: T; phone: string }[] = [
  {
    city: { en: "Dubai", ar: "دبي", tr: "Dubai" },
    country: { en: "UAE", ar: "الإمارات", tr: "BAE" },
    address: {
      en: "Jumeirah Lakes Towers, Cluster Y\nSwiss Tower 3402, 34th Floor",
      ar: "أبراج بحيرات جميرا، مجموعة Y\nبرج سويس 3402، الطابق 34",
      tr: "Jumeirah Lakes Towers, Küme Y\nSwiss Tower 3402, 34. Kat",
    },
    phone: "+971 4 561 3707",
  },
  {
    city: { en: "Riyadh", ar: "الرياض", tr: "Riyad" },
    country: { en: "KSA", ar: "السعودية", tr: "S. Arabistan" },
    address: {
      en: "4288, Anas Bin Malik\n6745 Al Malqa District",
      ar: "4288، أنس بن مالك\n6745 حي الملقا",
      tr: "4288, Anas Bin Malik\n6745 Al Malqa Bölgesi",
    },
    phone: "+966 11 257 1940",
  },
  {
    city: { en: "Abu Dhabi", ar: "أبو ظبي", tr: "Abu Dabi" },
    country: { en: "UAE", ar: "الإمارات", tr: "BAE" },
    address: {
      en: "Block B Offices\nMusaffah, M40, 91",
      ar: "مكاتب البلوك B\nمصفح، M40، 91",
      tr: "Blok B Ofisleri\nMusaffah, M40, 91",
    },
    phone: "+971 5 259 91055",
  },
  {
    city: { en: "Doha", ar: "الدوحة", tr: "Doha" },
    country: { en: "Qatar", ar: "قطر", tr: "Katar" },
    address: {
      en: "Office 241-3, Floor 2\nRegus, No. 67",
      ar: "مكتب 241-3، الطابق 2\nريجوس، رقم 67",
      tr: "Ofis 241-3, 2. Kat\nRegus, No. 67",
    },
    phone: "+974 442 31111",
  },
];

const F: Record<string, T> = {
  brandBlurb: {
    en: "Cognirise is a boutique AI advisory and engineering services firm — intelligence that elevates. We take clients from AI ambition to AI in production with senior delivery, lean economics, and an agentic-native practice.",
    ar: "Cognirise شركة استشارات وهندسة ذكاء اصطناعي بوتيك — ذكاء يرتقي. نأخذ العملاء من طموح الذكاء الاصطناعي إلى الذكاء الاصطناعي في الإنتاج بفريق كبار الخبراء، واقتصاديات رشيقة، وممارسة وكيلية الأصل.",
    tr: "Cognirise, butik bir AI danışmanlık ve mühendislik firmasıdır — yükselten zekâ. Müşterilerimizi AI hedefinden üretimdeki AI'ya götürürüz — kıdemli ekip, yalın ekonomi ve ajansal-doğal uygulamayla.",
  },
  company: { en: "Company", ar: "الشركة", tr: "Şirket" },
  services: { en: "Services", ar: "الخدمات", tr: "Hizmetler" },
  marketplace: { en: "Marketplace", ar: "السوق", tr: "Marketplace" },
  diagnostics: { en: "Diagnostics", ar: "التشخيصات", tr: "Tanılamalar" },
  industries: { en: "Industries", ar: "القطاعات", tr: "Sektörler" },
  contact: { en: "Contact", ar: "تواصل", tr: "İletişim" },
  ourOffices: { en: "Our Offices", ar: "مكاتبنا", tr: "Ofislerimiz" },
  allRights: { en: "All rights reserved.", ar: "جميع الحقوق محفوظة.", tr: "Tüm hakları saklıdır." },
  privacy: { en: "Privacy Policy", ar: "سياسة الخصوصية", tr: "Gizlilik Politikası" },
  terms: { en: "Terms of Use", ar: "شروط الاستخدام", tr: "Kullanım Şartları" },
  emailUs: { en: "Email us directly", ar: "راسلنا مباشرة", tr: "Doğrudan e-posta gönderin" },
  // company links
  aboutMaven: { en: "About Cognirise", ar: "عن Cognirise", tr: "Cognirise Hakkında" },
  ourFounders: { en: "Our Founders", ar: "مؤسسونا", tr: "Kurucularımız" },
  howWeWork: { en: "How We Work", ar: "كيف نعمل", tr: "Nasıl Çalışırız" },
  contactUs: { en: "Contact Us", ar: "تواصل معنا", tr: "Bize Ulaşın" },
  forEmployees: { en: "For employees ↗", ar: "للموظفين ↗", tr: "Çalışanlar için ↗" },
  // services
  agenticAI: { en: "Agentic AI", ar: "الذكاء الوكيل", tr: "Ajansal AI" },
  aiSdlc: { en: "AI-Driven SDLC", ar: "SDLC مدفوعة بالذكاء الاصطناعي", tr: "AI Öncülüğünde SDLC" },
  dataGov: { en: "Data & Governance", ar: "البيانات والحوكمة", tr: "Veri & Yönetişim" },
  productStudio: { en: "AI Product Studio", ar: "استوديو منتجات الذكاء الاصطناعي", tr: "AI Ürün Stüdyosu" },
  // marketplace
  vrTool: { en: "Value Realization Tool", ar: "أداة تحقيق القيمة", tr: "Değer Gerçekleştirme Aracı" },
  warRoom: { en: "Programme War Room", ar: "غرفة عمليات البرنامج", tr: "Program Savaş Odası" },
  tender: { en: "Tender Response Studio", ar: "استوديو الاستجابة للمناقصات", tr: "İhale Yanıt Stüdyosu" },
  citizen: { en: "Citizen Services Concierge", ar: "كونسيرج خدمات المواطنين", tr: "Vatandaş Hizmetleri Asistanı" },
  sama: { en: "SAMA Compliance Sentinel", ar: "حارس الامتثال لساما", tr: "SAMA Uyum Bekçisi" },
  allMarketplace: { en: "All marketplace tools →", ar: "جميع أدوات السوق ←", tr: "Tüm marketplace araçları →" },
  // diagnostics
  ari: { en: "Agentic Readiness (ARI)", ar: "جاهزية وكيلية (ARI)", tr: "Ajansal Hazırlık (ARI)" },
  mvi: { en: "Model & Value (MVI)", ar: "النموذج والقيمة (MVI)", tr: "Model & Değer (MVI)" },
  dafi: { en: "Data & AI Foundations (DAFI)", ar: "أسس البيانات والذكاء الاصطناعي (DAFI)", tr: "Veri & AI Temelleri (DAFI)" },
  uvr: { en: "Use Case Value (UVR)", ar: "قيمة حالة الاستخدام (UVR)", tr: "Kullanım Senaryosu Değeri (UVR)" },
  allAssessments: { en: "All free assessments →", ar: "جميع التقييمات المجانية ←", tr: "Tüm ücretsiz değerlendirmeler →" },
  // industries
  publicSector: { en: "Public Sector", ar: "القطاع العام", tr: "Kamu Sektörü" },
  telecom: { en: "Telecommunications", ar: "الاتصالات", tr: "Telekomünikasyon" },
  finance: { en: "Financial Services", ar: "الخدمات المالية", tr: "Finansal Hizmetler" },
  energy: { en: "Energy & Commodities", ar: "الطاقة والسلع", tr: "Enerji & Emtia" },
  retail: { en: "Retail & Consumer Products", ar: "التجزئة والمنتجات الاستهلاكية", tr: "Perakende & Tüketici Ürünleri" },
  travel: { en: "Travel & Hospitality", ar: "السفر والضيافة", tr: "Seyahat & Konaklama" },
  automotive: { en: "Automotive", ar: "السيارات", tr: "Otomotiv" },
};

export default function Footer() {
  const { lang } = useLang();
  const t = (s: T) => tStr(s, lang);

  const companyLinks = [
    { href: "/about", label: F.aboutMaven, external: false },
    { href: "/about#founders", label: F.ourFounders, external: false },
    { href: "/about#operating-model", label: F.howWeWork, external: false },
    { href: "/contact", label: F.contactUs, external: false },
    { href: "/atelier/sign-in", label: F.forEmployees, external: true },
  ];
  const serviceLinks = [
    { href: "/services/agentic-ai-transformation", label: F.agenticAI },
    { href: "/services/ai-driven-sdlc", label: F.aiSdlc },
    { href: "/services/data-governance-foundations", label: F.dataGov },
    { href: "/services/ai-product-studio", label: F.productStudio },
  ];
  const marketplaceLinks = [
    { href: "/marketplace/value-realization", label: F.vrTool },
    { href: "/marketplace/programme-war-room", label: F.warRoom },
    { href: "/marketplace/tender-response-studio", label: F.tender },
    { href: "/marketplace/citizen-services-concierge", label: F.citizen },
    { href: "/marketplace/sama-compliance-sentinel", label: F.sama },
    { href: "/marketplace", label: F.allMarketplace },
  ];
  const diagnosticLinks = [
    { href: "/assessments/ari", label: F.ari },
    { href: "/assessments/mvi", label: F.mvi },
    { href: "/assessments/dafi", label: F.dafi },
    { href: "/assessments/uvr", label: F.uvr },
    { href: "/assessments", label: F.allAssessments },
  ];
  const industryLinks = [
    { href: "/industries#public-sector", label: F.publicSector },
    { href: "/industries#telecom", label: F.telecom },
    { href: "/industries#financial-services", label: F.finance },
    { href: "/industries#energy-commodities", label: F.energy },
    { href: "/industries#retail-consumer", label: F.retail },
    { href: "/industries#travel-hospitality", label: F.travel },
    { href: "/industries#automotive", label: F.automotive },
  ];

  return (
    <footer className="bg-[#0A1230] text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <div className="mb-5"><Logo size="md" /></div>
            <p className="text-gray-400 text-sm leading-relaxed mb-6 max-w-sm">{t(F.brandBlurb)}</p>
            <div className="flex items-center gap-3">
              <a href="https://linkedin.com/company/cognirise" target="_blank" rel="noreferrer" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-[#8A5BD6] flex items-center justify-center transition-colors"><Linkedin size={16} /></a>
              <a href="https://twitter.com/Cognirise" target="_blank" rel="noreferrer" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-[#8A5BD6] flex items-center justify-center transition-colors"><Twitter size={16} /></a>
              <a href="mailto:info@cognirise.com" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-[#8A5BD6] flex items-center justify-center transition-colors"><Mail size={16} /></a>
            </div>
          </div>

          <FooterColumn title={t(F.company)} links={companyLinks} t={t} />
          <FooterColumn title={t(F.services)} links={serviceLinks} t={t} />
          <FooterColumn title={t(F.marketplace)} links={marketplaceLinks} t={t} />
          <FooterColumn title={t(F.diagnostics)} links={diagnosticLinks} t={t} />
          <FooterColumn title={t(F.industries)} links={industryLinks} t={t} />

          <div className="lg:col-span-2 lg:col-start-11">
            <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-5">{t(F.contact)}</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <Mail size={14} className="text-[#FF7B5A] mt-0.5 flex-shrink-0" />
                <a href="mailto:info@cognirise.com" className="text-gray-400 text-sm hover:text-white transition-colors">info@cognirise.com</a>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={14} className="text-[#FF7B5A] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-gray-400 text-sm">{t(offices[0].city)} · {t(offices[1].city)}</p>
                  <p className="text-gray-400 text-sm">{t(offices[2].city)} · {t(offices[3].city)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 pt-10 border-t border-white/10">
          <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-6">{t(F.ourOffices)}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {offices.map((office) => (
              <div key={office.city.en}>
                <div className="flex items-center gap-2 mb-2">
                  <MapPin size={12} className="text-[#FF7B5A]" />
                  <span className="text-white font-semibold text-sm">{t(office.city)}, {t(office.country)}</span>
                </div>
                <p className="text-gray-500 text-xs leading-relaxed whitespace-pre-line">{t(office.address)}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <Phone size={10} className="text-gray-500" />
                  <p className="text-gray-500 text-xs">{office.phone}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-gray-500 text-xs">© {new Date().getFullYear()} Cognirise. {t(F.allRights)}</p>
          <div className="flex items-center gap-5">
            <a href="#" className="text-gray-500 text-xs hover:text-gray-300 transition-colors">{t(F.privacy)}</a>
            <a href="#" className="text-gray-500 text-xs hover:text-gray-300 transition-colors">{t(F.terms)}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  t,
}: {
  title: string;
  links: { href: string; label: T; external?: boolean }[];
  t: (s: T) => string;
}) {
  return (
    <div className="lg:col-span-2">
      <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-5">{title}</h3>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a href={link.href} target="_blank" rel="noreferrer" className="text-gray-400 text-sm hover:text-white transition-colors">{t(link.label)}</a>
            ) : (
              <Link href={link.href} className="text-gray-400 text-sm hover:text-white transition-colors">{t(link.label)}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
