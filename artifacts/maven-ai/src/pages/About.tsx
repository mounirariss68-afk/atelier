import { motion } from "framer-motion";
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Linkedin, MapPin, Quote } from "lucide-react";
import {
  founders,
  founderTitleStr, founderLocationStr, founderBioStr, founderQuoteStr, founderExpertiseList,
} from "@/data/content";
import OperatingModelDiagram from "@/components/OperatingModelDiagram";
import { useLang, tStr } from "@/lib/lang";

const HERO_EYEBROW = { en: "About Cognirise", ar: "حول Cognirise", tr: "Cognirise Hakkında" };
const HERO_TITLE = {
  en: "Built to close the gap between AI ambition and AI in production.",
  ar: "بُنينا لسد الفجوة بين طموح الذكاء الاصطناعي وتطبيقه في الإنتاج.",
  tr: "AI hedefi ile üretimdeki AI arasındaki boşluğu kapatmak için inşa edildi.",
};
const HERO_PARA = {
  en: "Cognirise was founded by two partners who spent years watching world-class organizations fail to move AI from the pilot to the production environment. We built the firm we always wished existed.",
  ar: "تأسست Cognirise على يد شريكَين أمضيا سنوات يراقبان مؤسسات عالمية المستوى تفشل في نقل الذكاء الاصطناعي من التجربة إلى بيئة الإنتاج. أنشأنا الشركة التي تمنينا دائماً وجودها.",
  tr: "Cognirise, dünya çapında kuruluşların AI'ı pilottan üretime taşımakta başarısız olduğunu yıllarca izleyen iki ortak tarafından kuruldu. Her zaman var olmasını dilediğimiz firmayı kurduk.",
};
const STORY_TITLE = { en: "Why we built Cognirise", ar: "لماذا أسسنا Cognirise", tr: "Cognirise'ı neden kurduk" };
const STORY_PARAS = [
  {
    en: "Across MENAT, the AI opportunity is undeniable. National AI strategies, sovereign fund mandates, progressive regulatory frameworks — the region has created the conditions for AI-led transformation at an extraordinary scale.",
    ar: "عبر الشرق الأوسط وشمال أفريقيا وتركيا، فرصة الذكاء الاصطناعي لا يمكن إنكارها. الاستراتيجيات الوطنية للذكاء الاصطناعي، تفويضات الصناديق السيادية، الأطر التنظيمية التقدمية — هيّأت المنطقة الظروف لتحوّل قائم على الذكاء الاصطناعي بنطاق استثنائي.",
    tr: "MENAT genelinde, AI fırsatı yadsınamaz. Ulusal AI stratejileri, egemen fon mandatları, ilerici düzenleyici çerçeveler — bölge, olağanüstü ölçekte AI öncülüğünde dönüşüm için koşulları yarattı.",
  },
  {
    en: "What the region was missing was a delivery partner built for this moment. Not the large Tier-1 firms, whose pyramid models and partner economics make true production delivery structurally difficult. Not the pure-play technology vendors, who sell tools without the strategic and change management capability to make those tools work inside complex organizations.",
    ar: "ما كان ينقص المنطقة هو شريك تنفيذ مُصمّم لهذه اللحظة. ليست شركات الفئة الأولى الكبرى، التي تجعل نماذجها الهرمية واقتصاديات الشركاء تسليم الإنتاج الحقيقي صعباً هيكلياً. وليست شركات التكنولوجيا البحتة التي تبيع الأدوات دون القدرة الاستراتيجية وإدارة التغيير لإنجاح هذه الأدوات داخل المؤسسات المعقدة.",
    tr: "Bölgenin eksik olduğu şey, bu an için inşa edilmiş bir teslimat ortağıydı. Piramit modelleri ve ortak ekonomileri gerçek üretim teslimini yapısal olarak zorlaştıran büyük Tier-1 firmaları değil. Bu araçların karmaşık kuruluşlarda çalışmasını sağlayacak stratejik ve değişim yönetimi yeteneğine sahip olmadan araç satan saf teknoloji satıcıları da değil.",
  },
  {
    en: "Cognirise was founded by two partners with a combined three decades of consulting, engineering, and AI delivery experience across MENAT and globally. We built the firm around four structural choices that, together, make us better at this specific work: production-led delivery, boutique design, agentic-native capability, and platform-agnostic economics.",
    ar: "تأسست Cognirise على يد شريكَين بخبرة مجمّعة تمتد لثلاثة عقود في الاستشارات والهندسة وتسليم الذكاء الاصطناعي عبر الشرق الأوسط وشمال أفريقيا وتركيا وعالمياً. بنينا الشركة حول أربعة خيارات هيكلية تجعلنا، مجتمعة، أفضل في هذا العمل المحدد: تسليم بقيادة الإنتاج، تصميم بوتيك، قدرة وكيلية أصلية، واقتصاديات مستقلة عن المنصات.",
    tr: "Cognirise, MENAT genelinde ve küresel olarak danışmanlık, mühendislik ve AI teslimatı alanında toplam üç on yıllık deneyime sahip iki ortak tarafından kuruldu. Firmayı, birlikte bu özel işte bizi daha iyi kılan dört yapısal seçim etrafında inşa ettik: üretim öncülüğünde teslimat, butik tasarım, ajansal-yerli kapasite ve platform-bağımsız ekonomi.",
  },
  {
    en: "We are a sister company of Maven Insights, one of the GCC's leading management consulting firms, giving us access to a 200+ consultant bench, deep regional client relationships, and the change management and organizational capability that pure AI firms typically lack.",
    ar: "نحن شركة شقيقة لـ Maven Insights، إحدى شركات الاستشارات الإدارية الرائدة في الخليج، مما يمنحنا الوصول إلى أكثر من 200 مستشار، وعلاقات عملاء إقليمية عميقة، وقدرة إدارة التغيير والتنظيم التي تفتقر إليها عادةً شركات الذكاء الاصطناعي البحتة.",
    tr: "Körfez'in önde gelen yönetim danışmanlığı firmalarından biri olan Maven Insights'ın kardeş şirketiyiz; bu bize 200+ danışmanlık ekibine, derin bölgesel müşteri ilişkilerine ve saf AI firmalarının genellikle sahip olmadığı değişim yönetimi ve organizasyon yeteneğine erişim sağlıyor.",
  },
];
const STAT_CARDS = [
  {
    num: "200+",
    title: { en: "Consultants available", ar: "مستشار متاح", tr: "Hazır danışman" },
    desc: {
      en: "Immediate access to Maven Insights' bench of advisory, PMO, change management, and domain specialists.",
      ar: "وصول فوري إلى فريق Maven Insights من متخصصي الاستشارات وإدارة المشاريع وإدارة التغيير والخبراء المتخصصين.",
      tr: "Maven Insights'ın danışmanlık, PMO, değişim yönetimi ve alan uzmanlarından oluşan ekibine anında erişim.",
    },
  },
  {
    num: "4",
    title: { en: "MENAT offices", ar: "مكاتب في الشرق الأوسط وشمال أفريقيا وتركيا", tr: "MENAT ofisleri" },
    desc: {
      en: "Day-one presence in Abu Dhabi, Dubai, Riyadh, and Istanbul — across the Middle East, North Africa, and Türkiye.",
      ar: "حضور من اليوم الأول في أبوظبي ودبي والرياض وإسطنبول — عبر الشرق الأوسط وشمال أفريقيا وتركيا.",
      tr: "Abu Dabi, Dubai, Riyad ve İstanbul'da ilk günden itibaren varlık — Orta Doğu, Kuzey Afrika ve Türkiye genelinde.",
    },
  },
];
const THESIS_TITLE = { en: "The Cognirise thesis", ar: "أطروحة Cognirise", tr: "Cognirise tezi" };
const THESIS_INTRO = {
  en: "Five design choices that, together, make Cognirise structurally better at AI delivery — by category, not by margin.",
  ar: "خمسة خيارات تصميم تجعل Cognirise، مجتمعة، أفضل هيكلياً في تسليم الذكاء الاصطناعي — على مستوى الفئة، لا بالهامش.",
  tr: "Birlikte Cognirise'ı AI teslimatında yapısal olarak daha iyi yapan beş tasarım seçimi — kategori olarak, marj olarak değil.",
};
const THESIS_CARDS = [
  { num: "01", color: "#5B7CFF", title: { en: "Production-led", ar: "بقيادة الإنتاج", tr: "Üretim öncülüğünde" }, desc: { en: "We deliver AI in production, not AI in PowerPoint. Measured outcomes, not advisory decks. Every engagement is anchored to a quantified business case.", ar: "نسلّم الذكاء الاصطناعي في الإنتاج، لا في عروض PowerPoint. نتائج مُقاسة، لا عروض استشارية. كل ارتباط مرتبط بحالة عمل مُقيَّمة كمياً.", tr: "AI'ı üretimde teslim ediyoruz, PowerPoint'te değil. Ölçülü sonuçlar, danışmanlık sunumları değil. Her çalışma sayısallaştırılmış bir iş senaryosuna bağlıdır." } },
  { num: "02", color: "#C45BB8", title: { en: "Boutique by design", ar: "بوتيك بالتصميم", tr: "Tasarım gereği butik" }, desc: { en: "Senior partners and principals on every engagement. The people you meet in the proposal are the people who will do your work.", ar: "شركاء كبار ومديرون رئيسيون في كل ارتباط. الأشخاص الذين تلتقون بهم في العرض هم من سينفّذون عملكم.", tr: "Her çalışmada kıdemli ortaklar ve baş danışmanlar. Teklifte tanıştığınız kişiler, işinizi yapacak kişilerdir." } },
  { num: "03", color: "#C45BB8", title: { en: "Agentic-native", ar: "وكيلي أصلي", tr: "Ajansal-yerli" }, desc: { en: "Built around agentic AI as the operating fabric. Not retrofitted onto a legacy professional services model from the BI or RPA era.", ar: "مبني حول الذكاء الاصطناعي الوكيلي كنسيج تشغيلي. لم يُضَف لاحقاً على نموذج خدمات مهنية موروث من حقبة الـBI أو RPA.", tr: "İşletim dokusu olarak ajansal AI etrafında inşa edildi. BI veya RPA döneminden kalma profesyonel hizmet modelinin üzerine sonradan eklenmiş değil." } },
  { num: "04", color: "#8A5BD6", title: { en: "Lean economics", ar: "اقتصاديات رشيقة", tr: "Yalın ekonomi" }, desc: { en: "Boutique structure plus partner leverage delivers senior-led work at rates the Tier-1 cost base structurally cannot match.", ar: "البنية البوتيكية مع رافعة الشركاء تقدّم عملاً بقيادة كبار الشركاء بأسعار لا يمكن لقاعدة تكلفة شركات الفئة الأولى مجاراتها هيكلياً.", tr: "Butik yapı artı ortak kaldıracı, Tier-1 maliyet tabanının yapısal olarak rekabet edemediği oranlarda kıdemli liderliğinde iş sunar." } },
  { num: "05", color: "#0A1230", title: { en: "Platform-agnostic", ar: "مستقل عن المنصات", tr: "Platform-bağımsız" }, desc: { en: "Clients pick the right stack. Our economics aren't tied to any vendor, and our advice isn't either. Right tool, every time.", ar: "العملاء يختارون التقنيات المناسبة. اقتصادياتنا غير مرتبطة بأي مورّد، ونصيحتنا كذلك. الأداة المناسبة، في كل مرة.", tr: "Müşteriler doğru yığını seçer. Ekonomimiz hiçbir satıcıya bağlı değil, tavsiyemiz de öyle. Her seferinde doğru araç." } },
];
const FOUNDERS_TITLE = { en: "Our founding team", ar: "فريقنا المؤسس", tr: "Kurucu ekibimiz" };
const FOUNDERS_INTRO = {
  en: "Two partners. Complementary disciplines. One shared conviction: MENAT organizations deserve a delivery partner built for this moment.",
  ar: "شريكان. تخصصات متكاملة. قناعة واحدة مشتركة: تستحق مؤسسات الشرق الأوسط وشمال أفريقيا وتركيا شريك تنفيذ مُصمّماً لهذه اللحظة.",
  tr: "İki ortak. Tamamlayıcı disiplinler. Tek ortak kanaat: MENAT kuruluşları bu an için inşa edilmiş bir teslimat ortağını hak ediyor.",
};
const OPMODEL_TITLE = { en: "Our operating model", ar: "نموذج تشغيلنا", tr: "Operasyon modelimiz" };
const OPMODEL_INTRO = {
  en: "A small core leveraging four rings of capability — lean by design. Every dollar of revenue requires a fraction of the headcount of a Tier-1.",
  ar: "نواة صغيرة تستفيد من أربع حلقات من القدرات — رشيقة بالتصميم. كل دولار إيرادات يتطلب جزءاً يسيراً من عدد موظفي شركات الفئة الأولى.",
  tr: "Dört yetenek halkasını kullanan küçük bir çekirdek — tasarım gereği yalın. Her dolarlık gelir, Tier-1'in personel sayısının çok küçük bir kısmını gerektirir.",
};
const SISTER_TITLE = { en: "Backed by Maven Insights", ar: "بدعم من Maven Insights", tr: "Maven Insights tarafından destekleniyor" };
const SISTER_PARA = {
  en: "Maven Insights is a leading management consulting firm with offices across the GCC. Cognirise was founded as a dedicated AI delivery practice, with direct access to Maven Insights' consulting bench, regional client relationships, and change management expertise. Together, we offer the most complete AI-to-production capability in the region.",
  ar: "Maven Insights شركة استشارات إدارية رائدة لها مكاتب في جميع أنحاء دول الخليج. تأسست Cognirise كممارسة مخصصة لتسليم الذكاء الاصطناعي، مع وصول مباشر إلى فريق استشارات Maven Insights وعلاقات العملاء الإقليمية وخبرة إدارة التغيير. معاً، نقدم القدرة الأكثر اكتمالاً لنقل الذكاء الاصطناعي إلى الإنتاج في المنطقة.",
  tr: "Maven Insights, Körfez genelinde ofisleri olan önde gelen bir yönetim danışmanlığı firmasıdır. Cognirise, Maven Insights'ın danışmanlık ekibine, bölgesel müşteri ilişkilerine ve değişim yönetimi uzmanlığına doğrudan erişimle, özel bir AI teslimat pratiği olarak kuruldu. Birlikte, bölgedeki en eksiksiz AI'dan üretime kapasiteyi sunuyoruz.",
};
const SISTER_CTA = { en: "Learn about Maven Insights", ar: "تعرّف على Maven Insights", tr: "Maven Insights hakkında bilgi edinin" };

const TWO_PATHS_PARAGRAPH = {
  en: "Practically, that conviction shows up as two paths to outcomes. A project-led path for bespoke transformation, AI-driven SDLC, and data & governance foundations — and an asset-led path through our Marketplace of productized agents when the problem is shared across the industry and time-to-value matters more than custom IP. Most engagements blend the two; the decision framework is published in our Two Paths POV.",
  ar: "عملياً، تتجلى هذه القناعة في مسارين للوصول إلى النتائج. مسار قائم على المشاريع للتحول المخصص ودورة حياة تطوير البرمجيات المدفوعة بالذكاء الاصطناعي وأسس البيانات والحوكمة — ومسار قائم على الأصول عبر سوقنا من الوكلاء الجاهزين عندما تكون المشكلة مشتركة عبر القطاع ويكون الوقت اللازم لتحقيق القيمة أهم من الملكية الفكرية المخصصة. معظم الارتباطات تمزج بين المسارين، ويُنشر إطار القرار في منظور المسارين لدينا.",
  tr: "Pratikte bu kanaat, sonuçlara giden iki yol olarak ortaya çıkar. Özel dönüşüm, yapay zekâ öncülüğündeki SDLC ve veri & yönetişim temelleri için proje öncülüğündeki yol — ve sorun sektör genelinde ortak olduğunda ve değer süresi özel IP'den daha önemli olduğunda Marketplace'imizdeki ürünleştirilmiş ajanlar aracılığıyla varlık öncülüğündeki yol. Çoğu çalışma her ikisini harmanlar; karar çerçevesi İki Yol bakış açımızda yayımlanmıştır.",
};

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } }),
};

function FounderPhoto({ src, name }: { src: string; name: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name.split(" ").map((n) => n[0]).join("");
  return (
    <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br from-[#0A1230] to-[#5B7CFF] relative">
      {!imgFailed && (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover absolute inset-0 scale-[1.35] origin-center"
          onError={() => setImgFailed(true)}
        />
      )}
      {imgFailed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-black text-6xl opacity-30">{initials}</span>
        </div>
      )}
    </div>
  );
}

export default function About() {
  const { lang, dir } = useLang();
  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0A1230] py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #C45BB8 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" animate="visible" variants={fadeUp}>
            <span className="text-[#C45BB8] font-semibold text-sm uppercase tracking-widest">{tStr(HERO_EYEBROW, lang)}</span>
          </motion.div>
          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-5xl font-extrabold text-white mt-4 mb-6 max-w-3xl leading-tight"
          >
            {tStr(HERO_TITLE, lang)}
          </motion.h1>
          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="text-xl text-gray-300 max-w-2xl leading-relaxed"
          >
            {tStr(HERO_PARA, lang)}
          </motion.p>
        </div>
      </section>

      {/* Story */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <div className="section-divider" />
              <h2 className="text-3xl font-extrabold text-[#0A1230] mb-6">{tStr(STORY_TITLE, lang)}</h2>
              <div className="space-y-5 text-gray-600 leading-relaxed">
                {STORY_PARAS.map((p, i) => <p key={i}>{tStr(p, lang)}</p>)}
                <p>{tStr(TWO_PATHS_PARAGRAPH, lang)}</p>
                <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <Link href="/services" className="text-[#5B7CFF] font-semibold hover:underline">→ {tStr({ en: "Services (project-led)", ar: "الخدمات (قائم على المشاريع)", tr: "Hizmetler (proje öncülüğünde)" }, lang)}</Link>
                  <Link href="/marketplace" className="text-[#C45BB8] font-semibold hover:underline">→ {tStr({ en: "Marketplace (asset-led)", ar: "السوق (قائم على الأصول)", tr: "Marketplace (varlık öncülüğünde)" }, lang)}</Link>
                  <Link href="/insights/two-paths-to-outcomes" className="text-[#0A1230] font-semibold hover:underline">→ {tStr({ en: "Two Paths POV", ar: "منظور المسارين", tr: "İki Yol bakış açısı" }, lang)}</Link>
                </p>
              </div>
            </div>
            <div className="space-y-5">
              {STAT_CARDS.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="flex gap-5 p-5 border border-gray-100 rounded-xl"
                >
                  <div className="text-[#C45BB8] font-black text-2xl leading-none w-16 flex-shrink-0 mt-0.5">{item.num}</div>
                  <div>
                    <h3 className="font-bold text-[#0A1230] mb-1">{tStr(item.title, lang)}</h3>
                    <p className="text-sm text-gray-600">{tStr(item.desc, lang)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The Thesis */}
      <section className="py-24 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="section-divider mx-auto" />
            <h2 className="text-3xl font-extrabold text-[#0A1230] mb-4">{tStr(THESIS_TITLE, lang)}</h2>
            <p className="text-gray-600 max-w-xl mx-auto">{tStr(THESIS_INTRO, lang)}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {THESIS_CARDS.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm"
              >
                <div className="text-4xl font-black mb-3" style={{ color: item.color }}>{item.num}</div>
                <h3 className="font-bold text-[#0A1230] mb-3">{tStr(item.title, lang)}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{tStr(item.desc, lang)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Founders */}
      <section id="founders" className="py-24 bg-white scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="section-divider mx-auto" />
            <h2 className="text-3xl font-extrabold text-[#0A1230] mb-4">{tStr(FOUNDERS_TITLE, lang)}</h2>
            <p className="text-gray-600 max-w-xl mx-auto">{tStr(FOUNDERS_INTRO, lang)}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-5xl mx-auto">
            {founders.map((founder, i) => (
              <motion.div
                key={founder.id}
                id={founder.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="grid grid-cols-1 gap-6 items-start"
              >
                {/* Photo */}
                <div className="max-w-xs">
                  <FounderPhoto src={founder.image} name={founder.name} />
                </div>

                {/* Bio */}
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-2xl font-extrabold text-[#0A1230]">{founder.name}</h3>
                      <p className="text-[#5B7CFF] font-semibold">{founderTitleStr(founder, lang)}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <MapPin size={13} className="text-gray-400" />
                        <span className="text-gray-500 text-sm">{founderLocationStr(founder, lang)}</span>
                      </div>
                    </div>
                    <a href={founder.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-2 border border-gray-200 hover:border-[#5B7CFF] text-gray-600 hover:text-[#5B7CFF] px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                      <Linkedin size={16} /> LinkedIn
                    </a>
                  </div>

                  <p className="text-gray-600 leading-relaxed mb-5">{founderBioStr(founder, lang)}</p>

                  <div className="flex flex-wrap gap-2 mb-6">
                    {founderExpertiseList(founder, lang).map((skill) => (
                      <span key={skill} className="text-xs font-semibold px-3 py-1.5 bg-[#F8F9FA] border border-gray-200 rounded-full text-gray-700">{skill}</span>
                    ))}
                  </div>

                  <blockquote className="border-l-4 border-[#C45BB8] pl-5 py-2">
                    <p className="text-gray-700 italic leading-relaxed">"{founderQuoteStr(founder, lang)}"</p>
                  </blockquote>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Operating Model */}
      <section id="operating-model" className="py-24 bg-[#0A1230] scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="section-divider mx-auto" />
            <h2 className="text-3xl font-extrabold text-white mb-4">{tStr(OPMODEL_TITLE, lang)}</h2>
            <p className="text-gray-400 max-w-xl mx-auto">{tStr(OPMODEL_INTRO, lang)}</p>
          </div>
          <OperatingModelDiagram />
        </div>
      </section>

      {/* Sister Company */}
      <section className="py-20 bg-[#F8F9FA]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="section-divider mx-auto" />
          <h2 className="text-3xl font-extrabold text-[#0A1230] mb-5">{tStr(SISTER_TITLE, lang)}</h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
            {tStr(SISTER_PARA, lang)}
          </p>
          <a href="https://www.maveninsights.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-[#5B7CFF] text-[#5B7CFF] font-semibold px-7 py-3.5 rounded-xl hover:bg-[#5B7CFF] hover:text-white transition-colors">
            {tStr(SISTER_CTA, lang)} <ArrowRight size={16} className="rtl:-scale-x-100" />
          </a>
        </div>
      </section>
    </div>
  );
}
