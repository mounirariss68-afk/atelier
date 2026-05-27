import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { MapPin, Phone, Mail, Send, CheckCircle, Clock, Users, ArrowRight } from "lucide-react";
import { services as sharedServices } from "@workspace/maven-content";
import { useLang, tStr } from "@/lib/lang";

const offices = [
  { city: "Dubai", country: "UAE", address: "Jumeirah Lakes Towers, Cluster Y\nSwiss Tower 3402, 34th Floor", phone: "+971 4 561 3707", primary: true },
  { city: "Riyadh", country: "KSA", address: "4288, Anas Bin Malik\n6745 Al Malqa District", phone: "+966 11 257 1940", primary: true },
  { city: "Abu Dhabi", country: "UAE", address: "Block B Offices\nMusaffah, M40, 91", phone: "+971 5 259 91055", primary: false },
  { city: "Doha", country: "Qatar", address: "Office 241-3, Floor 2\nRegus, No. 67", phone: "+974 442 31111", primary: false },
];

const SERVICE_INTERESTS = sharedServices.map((s) => s.title);
const interestAreas = [...SERVICE_INTERESTS, "General Inquiry", "Partnership"];

const TOPIC_TO_INTEREST: Record<string, string> = Object.fromEntries(
  sharedServices.map((s) => [s.slug, s.title]),
);

const COPY = {
  eyebrow: { en: "Contact", ar: "تواصل", tr: "İletişim" },
  heroTitle: { en: "Let's talk about what AI can do for your organization.", ar: "لنتحدث عمّا يمكن أن يقدمه الذكاء الاصطناعي لمؤسستكم.", tr: "AI'nin kuruluşunuz için neler yapabileceğini konuşalım." },
  heroPara: { en: "Three days to scope. Three weeks to prototype. 90 days to MVP. It starts with a conversation.", ar: "ثلاثة أيام للنطاق. ثلاثة أسابيع للنموذج الأولي. 90 يوماً للـ MVP. يبدأ كل شيء بمحادثة.", tr: "Üç günde kapsam. Üç haftada prototip. 90 günde MVP. Her şey bir görüşmeyle başlar." },
  diagPitchTitle: { en: "Not ready for a call yet?", ar: "لستم مستعدين لمكالمة بعد؟", tr: "Görüşmeye henüz hazır değil misiniz?" },
  diagPitchBody: { en: "Take a free 12-minute diagnostic and we will respond with your scored memo.", ar: "خذ تشخيصاً مجانياً مدته 12 دقيقة وسنعود إليكم بمذكرة مقيّمة.", tr: "12 dakikalık ücretsiz bir teşhis alın, puanlı muhtıranızla size geri dönelim." },
  diagBtn: { en: "Start a diagnostic", ar: "ابدأ التشخيص", tr: "Teşhise başlayın" },
  why1Title: { en: "3-day scoping", ar: "نطاق في 3 أيام", tr: "3 günlük kapsam" },
  why1Desc: { en: "We scope the opportunity and propose a plan — before you commit to anything", ar: "نُحدّد الفرصة ونقترح خطة — قبل أن تلتزموا بأي شيء", tr: "Siz herhangi bir taahhüt vermeden önce fırsatı belirler ve bir plan öneririz" },
  why2Title: { en: "Senior-led from day one", ar: "بقيادة عليا من اليوم الأول", tr: "Birinci günden itibaren kıdemli liderlik" },
  why2Desc: { en: "You'll speak to a Partner in your first call — not a business development team", ar: "ستتحدثون إلى شريك في مكالمتكم الأولى — لا إلى فريق تطوير أعمال", tr: "İlk görüşmenizde bir İş Ortağıyla konuşacaksınız — iş geliştirme ekibiyle değil" },
  why3Title: { en: "Production focus", ar: "التركيز على الإنتاج", tr: "Üretim odağı" },
  why3Desc: { en: "Every conversation starts with the outcome you need — not the solution we want to sell", ar: "كل محادثة تبدأ بالنتيجة التي تحتاجونها — لا بالحل الذي نريد بيعه", tr: "Her görüşme, bizim satmak istediğimiz çözümle değil, ihtiyacınız olan sonuçla başlar" },
  formTitle: { en: "Get in touch", ar: "تواصلوا معنا", tr: "İletişime geçin" },
  formSub: { en: "We typically respond within one business day.", ar: "نرد عادةً خلال يوم عمل واحد.", tr: "Genellikle bir iş günü içinde yanıt veriyoruz." },
  sent: { en: "Message sent", ar: "تم إرسال الرسالة", tr: "Mesaj gönderildi" },
  sentBody: { en: "A Partner will be in touch within one business day.", ar: "سيتواصل شريك خلال يوم عمل واحد.", tr: "Bir İş Ortağı bir iş günü içinde sizinle iletişime geçecek." },
  fullName: { en: "Full name *", ar: "الاسم الكامل *", tr: "Ad soyad *" },
  fullNamePh: { en: "Your name", ar: "اسمكم", tr: "Adınız" },
  company: { en: "Company *", ar: "الشركة *", tr: "Şirket *" },
  companyPh: { en: "Your organization", ar: "مؤسستكم", tr: "Kuruluşunuz" },
  email: { en: "Email *", ar: "البريد الإلكتروني *", tr: "E-posta *" },
  phone: { en: "Phone", ar: "الهاتف", tr: "Telefon" },
  interest: { en: "Area of interest *", ar: "مجال الاهتمام *", tr: "İlgi alanı *" },
  interestPh: { en: "Select an area", ar: "اختر مجالاً", tr: "Bir alan seçin" },
  message: { en: "Message *", ar: "الرسالة *", tr: "Mesaj *" },
  messagePh: { en: "Tell us about your AI challenge or what you'd like to explore...", ar: "حدثونا عن تحدي الذكاء الاصطناعي لديكم أو ما تودّون استكشافه...", tr: "AI zorluğunuzdan veya keşfetmek istediğiniz konudan bahsedin..." },
  sendMsg: { en: "Send message", ar: "إرسال الرسالة", tr: "Mesajı gönder" },
  privacy: { en: "By submitting, you agree to Cognirise's privacy policy.", ar: "بإرسالكم النموذج، فإنكم توافقون على سياسة خصوصية Cognirise.", tr: "Göndererek Cognirise'nın gizlilik politikasını kabul etmiş olursunuz." },
  officesTitle: { en: "Our offices", ar: "مكاتبنا", tr: "Ofislerimiz" },
  officesSub: { en: "Present across the GCC's four main business centers.", ar: "حضور في المراكز التجارية الأربعة الرئيسية في الخليج.", tr: "Körfez'in dört ana iş merkezinde mevcudiyet." },
  mainOffice: { en: "Main office", ar: "المكتب الرئيسي", tr: "Ana ofis" },
  emailDirect: { en: "Email us directly", ar: "راسلونا مباشرةً", tr: "Doğrudan bize e-posta gönderin" },
};

export default function Contact() {
  const { lang, dir } = useLang();
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", interest: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLElement>(null);
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const topic = params.get("topic");
    if (topic && TOPIC_TO_INTEREST[topic]) {
      setForm((prev) => ({ ...prev, interest: TOPIC_TO_INTEREST[topic] }));
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    }
  }, [search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0A1230] py-20 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #C45BB8 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#C45BB8] font-semibold text-sm uppercase tracking-widest">{tStr(COPY.eyebrow, lang)}</span>
          <h1 className="text-5xl font-extrabold text-white mt-3 mb-5 max-w-2xl leading-tight">
            {tStr(COPY.heroTitle, lang)}
          </h1>
          <p className="text-xl text-gray-300 max-w-xl">
            {tStr(COPY.heroPara, lang)}
          </p>
          <div className="mt-8 inline-flex items-center gap-3 bg-white/5 border border-white/15 rounded-2xl px-5 py-4">
            <div className="w-10 h-10 rounded-lg bg-[#5B7CFF]/20 flex items-center justify-center flex-shrink-0">
              <ArrowRight size={18} className="text-[#5B7CFF] rtl:-scale-x-100" />
            </div>
            <div className="text-sm text-white/85">
              <p className="font-semibold text-white">{tStr(COPY.diagPitchTitle, lang)}</p>
              <p>{tStr(COPY.diagPitchBody, lang)}</p>
            </div>
            <Link href="/assessments" className="ml-2 bg-[#5B7CFF] hover:bg-[#0E8BB8] text-white text-sm font-bold px-4 py-2 rounded-lg whitespace-nowrap">
              {tStr(COPY.diagBtn, lang)}
            </Link>
          </div>
        </div>
      </section>

      {/* Why talk to us */}
      <section className="py-12 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: Clock, color: "#5B7CFF", title: COPY.why1Title, desc: COPY.why1Desc },
              { icon: Users, color: "#C45BB8", title: COPY.why2Title, desc: COPY.why2Desc },
              { icon: ArrowRight, color: "#C45BB8", title: COPY.why3Title, desc: COPY.why3Desc },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex gap-4 p-5 rounded-xl bg-gray-50">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: item.color + "18" }}>
                    <Icon size={20} style={{ color: item.color }} />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0A1230] mb-1 text-sm">{tStr(item.title, lang)}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed">{tStr(item.desc, lang)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Form + Info */}
      <section ref={formRef} className="py-20 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12">
            {/* Form */}
            <div className="lg:col-span-7">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                <h2 className="text-2xl font-extrabold text-[#0A1230] mb-2">{tStr(COPY.formTitle, lang)}</h2>
                <p className="text-gray-500 text-sm mb-8">{tStr(COPY.formSub, lang)}</p>

                {submitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-16"
                  >
                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
                      <CheckCircle size={32} className="text-green-600" />
                    </div>
                    <h3 className="text-xl font-bold text-[#0A1230] mb-2">{tStr(COPY.sent, lang)}</h3>
                    <p className="text-gray-500">{tStr(COPY.sentBody, lang)}</p>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{tStr(COPY.fullName, lang)}</label>
                        <input
                          required
                          type="text"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder={tStr(COPY.fullNamePh, lang)}
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5B7CFF] focus:ring-1 focus:ring-[#5B7CFF] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{tStr(COPY.company, lang)}</label>
                        <input
                          required
                          type="text"
                          value={form.company}
                          onChange={(e) => setForm({ ...form, company: e.target.value })}
                          placeholder={tStr(COPY.companyPh, lang)}
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5B7CFF] focus:ring-1 focus:ring-[#5B7CFF] transition-colors"
                        />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{tStr(COPY.email, lang)}</label>
                        <input
                          required
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          placeholder="work@company.com"
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5B7CFF] focus:ring-1 focus:ring-[#5B7CFF] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{tStr(COPY.phone, lang)}</label>
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                          placeholder="+971 ..."
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5B7CFF] focus:ring-1 focus:ring-[#5B7CFF] transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{tStr(COPY.interest, lang)}</label>
                      <select
                        required
                        value={form.interest}
                        onChange={(e) => setForm({ ...form, interest: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5B7CFF] focus:ring-1 focus:ring-[#5B7CFF] transition-colors text-gray-700"
                      >
                        <option value="" disabled>{tStr(COPY.interestPh, lang)}</option>
                        {interestAreas.map((area) => <option key={area}>{area}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">{tStr(COPY.message, lang)}</label>
                      <textarea
                        required
                        rows={5}
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                        placeholder={tStr(COPY.messagePh, lang)}
                        className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5B7CFF] focus:ring-1 focus:ring-[#5B7CFF] transition-colors resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full flex items-center justify-center gap-2 bg-[#C45BB8] hover:bg-[#A04A99] text-white font-bold py-3.5 rounded-xl transition-colors"
                    >
                      {tStr(COPY.sendMsg, lang)} <Send size={16} />
                    </button>
                    <p className="text-xs text-gray-400 text-center">{tStr(COPY.privacy, lang)}</p>
                  </form>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="lg:col-span-5 space-y-6">
              <div>
                <h2 className="text-2xl font-extrabold text-[#0A1230] mb-2">{tStr(COPY.officesTitle, lang)}</h2>
                <p className="text-gray-500 text-sm">{tStr(COPY.officesSub, lang)}</p>
              </div>

              {offices.map((office) => (
                <motion.div
                  key={office.city}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className={`p-5 rounded-xl border ${office.primary ? "border-[#5B7CFF]/30 bg-[#5B7CFF]/5" : "border-gray-100 bg-white"}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin size={15} className="text-[#C45BB8]" />
                    <span className="font-bold text-[#0A1230]">{office.city}, {office.country}</span>
                    {office.primary && <span className="text-xs font-semibold text-[#5B7CFF] bg-[#5B7CFF]/10 px-2 py-0.5 rounded-full">{tStr(COPY.mainOffice, lang)}</span>}
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-line pl-5 mb-1.5">{office.address}</p>
                  <div className="flex items-center gap-1.5 pl-5">
                    <Phone size={12} className="text-gray-400" />
                    <a href={`tel:${office.phone.replace(/\s/g, "")}`} className="text-sm text-gray-500 hover:text-[#5B7CFF] transition-colors">{office.phone}</a>
                  </div>
                </motion.div>
              ))}

              {/* Email */}
              <div className="p-5 rounded-xl bg-[#0A1230] text-white">
                <div className="flex items-center gap-2 mb-2">
                  <Mail size={15} className="text-[#C45BB8]" />
                  <span className="font-bold">{tStr(COPY.emailDirect, lang)}</span>
                </div>
                <a href="mailto:info@cognirise.com" className="text-[#C45BB8] hover:text-white transition-colors text-sm">info@cognirise.com</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
