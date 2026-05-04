import {
  products, competitorPrices, dealers, campaigns,
  CATEGORY_LABELS, COMPETITOR_BRANDS,
  type ProductCategory,
} from "@/data/arcelik-seed";

const DEALER = dealers[0];
const fmt = (n: number) => n.toLocaleString("tr-TR");

export type DealerResponseType = "text" | "metric" | "table" | "list" | "progress" | "campaign-card";

export interface DealerChatResponse {
  text: string;
  type: DealerResponseType;
  data?: Record<string, unknown>;
}

interface DealerIntent {
  patterns: RegExp[];
  handler: () => DealerChatResponse;
}

const INTENTS: DealerIntent[] = [
  {
    patterns: [/merhaba/i, /selam/i, /hey/i, /günaydın/i, /iyi günler/i],
    handler: () => ({
      type: "text",
      text: "Merhaba! Arçelik Bayi Asistanı olarak size kampanyalar, fiyatlar, stok durumu, hedefler ve siparişler konusunda yardımcı olabilirim. Ne sormak istersiniz?",
    }),
  },
  {
    patterns: [/naber/i, /nasılsın/i, /n'aber/i, /nbr/i],
    handler: () => ({
      type: "text",
      text: `İyiyim, teşekkürler! 😊 Bugün ${DEALER.storeName} için neler yapabilirim? Kampanya, fiyat, stok veya hedef takibi konularında hazırım.`,
    }),
  },
  {
    patterns: [/aktif kampanya/i, /kampanyalar neler/i, /hangi kampanya/i, /kampanya var mı/i, /naber kampanya/i],
    handler: () => {
      const active = campaigns.filter((c) => c.targetCities.includes(DEALER.city));
      const list = active.slice(0, 4).map((c, i) => `${i + 1}. ${c.name}\n   ${c.discountDetail}`).join("\n\n");
      return {
        type: "list",
        text: `Şu anda bölgenizde ${active.length} aktif kampanya var:\n\n${list}\n\nDetaylar için Kampanyalar bölümünü ziyaret edebilirsiniz.`,
      };
    },
  },
  {
    patterns: [/kampanya.*bitiyor/i, /bitiş tarihi/i, /ne zaman sona/i, /kampanya.*ne zaman/i, /kalan gün/i],
    handler: () => ({
      type: "text",
      text: "Aktif kampanya süreleri:\n• Eski-Yeni Değişim: Süresiz (yıl boyunca)\n• Banka Taksit: 31 Temmuz 2026 (88 gün kaldı)\n• Enerji Verimliliği: 25 Mayıs 2026 (21 gün kaldı)\n\nÖzellikle Enerji Verimliliği kampanyasını kaçırmamak için A+++ ürünleri öne çıkarın!",
    }),
  },
  {
    patterns: [/fiyat listesi/i, /fiyat.*liste/i, /tüm fiyat/i, /güncel fiyat/i],
    handler: () => {
      const sample = products.slice(0, 5);
      return {
        type: "table",
        text: "İşte güncel fiyat listesinden örnekler:",
        data: {
          headers: ["Model", "TSF", "Bayi Alış"],
          rows: sample.map((p) => [p.modelCode, `₺${fmt(p.tsfPrice)}`, `₺${fmt(p.dealerCost)}`]),
        },
      };
    },
  },
  {
    patterns: [/hedef.*ne kadar/i, /hedefime.*kaldı/i, /hedef durumu/i, /kaç ürün daha/i, /hedef takip/i],
    handler: () => {
      const remaining = DEALER.monthlySalesTarget - DEALER.currentProgress;
      const pct = Math.round((DEALER.currentProgress / DEALER.monthlySalesTarget) * 100);
      return {
        type: "progress",
        text: `Bu ayki hedefiniz: ${DEALER.monthlySalesTarget} ürün\nŞu ana kadar: ${DEALER.currentProgress} ürün satıldı\nKalan: ${remaining} ürün\n\n${DEALER.currentProgress >= 50 ? "✅ %1 ek prim eşiğini geçtiniz! " : ""}${remaining <= 10 ? "Hedefe çok yakınsınız, harika gidiyorsunuz! 💪" : "Devam edin, hedefe ulaşabilirsiniz!"}`,
        data: { current: DEALER.currentProgress, target: DEALER.monthlySalesTarget, percent: pct },
      };
    },
  },
  {
    patterns: [/5088|NFK.*5088/i],
    handler: () => {
      const p = products.find((pr) => pr.modelCode.includes("5088"));
      if (!p) return { type: "text", text: "Bu modeli bulamadım." };
      return {
        type: "metric",
        text: `${p.name}\n\nTSF: ₺${fmt(p.tsfPrice)}\nBayi Alış: ₺${fmt(p.dealerCost)}\nMarj: %${p.marginPercent}\nEnerji: ${p.energyClass}\nÖzellikler: ${p.features.join(", ")}`,
        data: { value: `₺${fmt(p.tsfPrice)}`, label: "TSF Fiyatı" },
      };
    },
  },
  {
    patterns: [/fiyat.*nedir/i, /fiyatı ne\b/i, /\bne kadar.*lira/i, /kaç lira/i, /kaç tl/i],
    handler: () => ({
      type: "text",
      text: "Hangi ürünün fiyatını öğrenmek istiyorsunuz? Model kodunu veya ürün adını yazabilirsiniz. Örneğin: '5088 NFK fiyatı' veya 'klima fiyatları'.",
    }),
  },
  {
    patterns: [/vestel.*fiyat/i, /vestel.*karşı/i, /rakip fiyat/i, /rakip.*karşılaştır/i],
    handler: () => {
      const vestel = competitorPrices.filter((cp) => cp.brand === "Vestel").slice(0, 5);
      return {
        type: "table",
        text: "Vestel ile fiyat karşılaştırması (Arçelik'e göre fark):",
        data: {
          headers: ["Vestel Model", "Fiyat", "Fark"],
          rows: vestel.map((v) => [v.competitorModel, `₺${fmt(v.competitorPrice)}`, `${v.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/prim/i, /komisyon/i, /kazandım/i, /ne kadar prim/i, /primim/i],
    handler: () => ({
      type: "metric",
      text: `Bu ay kazanılan komisyon: ₺${fmt(DEALER.earnedCommission)}\n\nGeçen aya göre +₺2.400 artış gösterdiniz.\n\nKategori bazlı:\n• Buzdolabı: ₺${fmt(Math.round(DEALER.earnedCommission * 0.35))}\n• Çamaşır: ₺${fmt(Math.round(DEALER.earnedCommission * 0.22))}\n• Bulaşık: ₺${fmt(Math.round(DEALER.earnedCommission * 0.15))}\n• Diğer: ₺${fmt(Math.round(DEALER.earnedCommission * 0.28))}`,
      data: { value: `₺${fmt(DEALER.earnedCommission)}`, label: "Bu Ay Komisyon" },
    }),
  },
  {
    patterns: [/stok.*var mı/i, /stok durumu/i, /stok/i, /stok.*kardeşim/i],
    handler: () => {
      const low = Object.entries(DEALER.stockLevels).filter(([cat, lv]) => {
        const opt: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };
        return (lv ?? 0) < (opt[cat] ?? 10);
      });
      const lines = (Object.entries(CATEGORY_LABELS) as [ProductCategory, string][]).map(([cat, label]) => {
        const lv = DEALER.stockLevels[cat] ?? 0;
        const icon = lv > 10 ? "✅" : lv > 0 ? "⚠️" : "❌";
        return `${icon} ${label}: ${lv} adet`;
      }).join("\n");
      return {
        type: "list",
        text: `Stok durumunuz:\n\n${lines}\n\n${low.length > 0 ? `⚠️ ${low.length} kategoride düşük stok var. Sipariş vermek ister misiniz?` : "✅ Tüm kategorilerde stok yeterli."}`,
      };
    },
  },
  {
    patterns: [/sipariş.*durum/i, /siparişlerim/i, /kargo/i, /sipariş.*ne oldu/i],
    handler: () => ({
      type: "table",
      text: "Son siparişleriniz:",
      data: {
        headers: ["Sipariş No", "Tarih", "Tutar", "Durum"],
        rows: [
          ["SIP-2026-0501", "2 Mayıs", "₺97.950", "Hazırlanıyor"],
          ["SIP-2026-0487", "28 Nisan", "₺115.950", "Kargoda"],
          ["SIP-2026-0462", "22 Nisan", "₺102.860", "Teslim Edildi"],
        ],
      },
    }),
  },
  {
    patterns: [/yeni ürün/i, /yeni model/i, /son eklenen/i, /yeni.*neler/i],
    handler: () => ({
      type: "list",
      text: "Son eklenen ürünler:\n\n1. Grundig G 12420 Premium Klima — ₺24.990 (UV-C filtre, A+++)\n2. Arçelik S 8960 Kablosuz Süpürge — ₺11.990 (yeni renkler)\n3. Beko BKK 2520 Robot Süpürge — ₺9.990 (lazer navigasyon)\n\nBu ürünleri showroom'unuzda öne çıkarmanızı öneririz.",
    }),
  },
  {
    patterns: [/eğitim/i, /eğitim programı/i, /eğitim var mı/i, /kurs/i],
    handler: () => ({
      type: "text",
      text: "Yaklaşan eğitimler:\n\n📚 Online: Enerji Verimliliği Mevzuatı\n   8 Mayıs 2026, 14:00–15:30\n   Sertifikalı, ücretsiz\n\n📚 Yüz yüze: İstanbul Bölgesel Bayi Toplantısı\n   15 Mayıs 2026, 10:00–16:00\n   Arçelik Genel Merkezi, Sütlüce\n\nKatılmak ister misiniz?",
    }),
  },
  {
    patterns: [/sipariş nasıl/i, /nasıl sipariş/i, /sipariş ver/i, /nasıl.*ısmarla/i],
    handler: () => ({
      type: "text",
      text: "Sipariş vermek için:\n\n1️⃣ Portal'da Stok & Siparişler bölümüne gidin\n2️⃣ Düşük stoklu kategorilerde 'Sipariş Ver' butonuna tıklayın\n3️⃣ Miktar ve ürün seçimini yapın\n4️⃣ Onaylayın — sipariş bölge deposuna iletilir\n5️⃣ 3-5 iş günü içinde teslim edilir\n\nAcil siparişler için 444 0 888'i arayabilirsiniz.",
    }),
  },
  {
    patterns: [/en çok.*sat/i, /en çok.*ürün/i, /popüler/i, /best.?sell/i, /en iyi sat/i],
    handler: () => {
      const sorted = (Object.entries(DEALER.productMix) as [ProductCategory, number][]).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      const list = sorted.slice(0, 5).map(([cat, count], i) => `${i + 1}. ${CATEGORY_LABELS[cat]}: ${count} adet`).join("\n");
      return {
        type: "list",
        text: `Bu ay en çok sattığınız kategoriler:\n\n${list}\n\nToplam: ${DEALER.currentProgress} ürün satışı.`,
      };
    },
  },
  {
    patterns: [/sıralama/i, /kaçıncı/i, /bölge sıra/i, /rank/i, /bölgemdeki/i],
    handler: () => ({
      type: "metric",
      text: "Bölgenizde 127 bayi arasında 23. sıradasınız!\n\nÜst %82 diliminde yer alıyorsunuz. Geçen aya göre 4 sıra yükseldiniz. Altın Bayi statünüzü korumak için hedeflerinize ulaşmaya devam edin. 🏆",
      data: { value: "23.", label: "Bölge Sıralaması" },
    }),
  },
  {
    patterns: [/müşteri.*kampanya/i, /müşterime.*öner/i, /kampanya öner/i, /ne öner/i],
    handler: () => ({
      type: "campaign-card",
      text: "Müşterilerinize şu kampanyaları önerebilirsiniz:\n\n🎯 Enerji Verimliliği: A+++ ürünlerde %12 indirim\n   → 'Yıllık ₺3.000 tasarruf edin' mesajı etkili\n\n🎯 Banka Taksit: 24 aya kadar faizsiz\n   → 'Aylık sadece ₺X' hesaplaması sunun\n\n🎯 Eski-Yeni Değişim: ₺2.000–₺5.000 indirim\n   → 'Eski cihazınızı getirin, yenisi yarı fiyatına' mesajı\n\nSMS şablonları Kampanyalar bölümünde hazır.",
    }),
  },
  {
    patterns: [/taksit/i, /taksit seçenek/i, /kaç taksit/i, /taksitli/i],
    handler: () => ({
      type: "table",
      text: "Aktif taksit seçenekleri:",
      data: {
        headers: ["Banka", "Taksit", "Vade Farkı"],
        rows: [
          ["Ziraat Bankası", "24 ay", "Faizsiz"],
          ["Halkbank", "24 ay", "Faizsiz"],
          ["Vakıfbank", "24 ay", "Faizsiz"],
          ["İş Bankası", "12 ay", "%1.29"],
          ["Garanti BBVA", "12 ay", "%1.39"],
          ["Yapı Kredi", "9 ay", "Faizsiz"],
        ],
      },
    }),
  },
  {
    patterns: [/düşük stok/i, /stok uyarı/i, /tükenen/i, /kritik stok/i],
    handler: () => {
      const low = Object.entries(DEALER.stockLevels).filter(([cat, lv]) => {
        const opt: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };
        return (lv ?? 0) < (opt[cat] ?? 10);
      });
      if (low.length === 0) return { type: "text", text: "✅ Şu anda tüm kategorilerde stok seviyesi yeterli. Endişelenecek bir şey yok!" };
      const items = low.map(([cat, lv]) => `⚠️ ${CATEGORY_LABELS[cat as ProductCategory]}: ${lv} adet (optimum altında)`).join("\n");
      return {
        type: "list",
        text: `Düşük stok uyarısı — ${low.length} kategori:\n\n${items}\n\nStok & Siparişler bölümünden hızlıca sipariş verebilirsiniz.`,
      };
    },
  },
  {
    patterns: [/fiyat değişikliği/i, /fiyat güncelle/i, /son fiyat/i, /fiyat ne oldu/i],
    handler: () => ({
      type: "table",
      text: "Son 7 günde fiyat değişen ürünler:",
      data: {
        headers: ["Model", "Eski Fiyat", "Yeni Fiyat", "Tarih"],
        rows: [
          ["5088 NFK", "₺24.990", "₺25.990", "1 Mayıs"],
          ["10143 D Premium", "₺23.990", "₺24.990", "29 Nisan"],
          ["12420 Klima", "₺20.490", "₺21.990", "30 Nisan"],
        ],
      },
    }),
  },
  {
    patterns: [/kampanya matery/i, /afiş/i, /SMS şablon/i, /sosyal medya/i, /materyal/i],
    handler: () => {
      const c = campaigns.find((c) => c.id === "enerji-verimlilik") ?? campaigns[0];
      return {
        type: "text",
        text: `Kampanya materyalleri:\n\n📱 SMS Şablonu:\n"${c.dealerSmsNotification}"\n\n🏪 POS Mesajı:\n"${c.dealerPosMessaging}"\n\n📋 Afiş Açıklaması:\n${c.bannerDescription}\n\nTüm materyallere Kampanyalar bölümünden ulaşabilirsiniz.`,
      };
    },
  },
  {
    patterns: [/uyum puanı/i, /uyum skor/i, /compliance/i, /uyumum/i],
    handler: () => ({
      type: "metric",
      text: `Uyum puanınız: ${DEALER.complianceScore}/100\n\n${DEALER.complianceScore >= 85 ? "✅ Harika! Uyum hedefinizin üzerindesiniz." : "⚠️ Hedef 85 puan. Puanınızı artırmak için TSF fiyatlarına uyumu ve kampanya materyallerini vitrine koymayı unutmayın."}\n\nUyum puanı kriterleri:\n• TSF fiyatına uygunluk\n• Kampanya materyalleri kullanımı\n• Zamanında sipariş ve stok yönetimi\n• Eğitimlere katılım`,
      data: { value: `${DEALER.complianceScore}/100`, label: "Uyum Puanı" },
    }),
  },
  {
    patterns: [/bayi seviye/i, /altın bayi/i, /tier/i, /seviyem/i, /bayi.*statü/i],
    handler: () => ({
      type: "text",
      text: `Mevcut seviyeniz: 🥇 Altın Bayi\n\nAltın Bayi avantajları:\n• Öncelikli stok tahsisi\n• %0.5 ek komisyon\n• Özel kampanya fırsatları\n• Bölgesel toplantılara davet\n• Yeni ürün öncelikli dağıtım\n\nAltın seviyeyi korumak için: Uyum puanı ≥85, aylık hedef gerçekleştirme ≥80%`,
    }),
  },
  {
    patterns: [/yardım/i, /ne yapabilirsin/i, /komut/i, /menü/i, /help/i],
    handler: () => ({
      type: "text",
      text: "Size şu konularda yardımcı olabilirim:\n\n📋 Kampanyalar — aktif kampanyalar, bitiş tarihleri\n💰 Fiyatlar — ürün fiyatları, rakip karşılaştırma\n📦 Stok — stok durumu, düşük stok uyarıları\n🎯 Hedefler — satış hedefi takibi, prim durumu\n🚛 Siparişler — sipariş durumu, nasıl sipariş verilir\n📣 Duyurular — yeni ürünler, eğitimler\n💳 Taksit — banka taksit seçenekleri\n🏆 Sıralama — bölgesel bayi sıralaması\n\nSormak istediğiniz konuyu yazmanız yeterli!",
    }),
  },
  {
    patterns: [/buzdolab/i, /fridge/i],
    handler: () => {
      const buzProducts = products.filter((p) => p.category === "buzdolabi");
      const stock = DEALER.stockLevels.buzdolabi ?? 0;
      return {
        type: "list",
        text: `Buzdolabı kategorisi:\n\n• ${buzProducts.length} model portföyü\n• Fiyat aralığı: ₺${fmt(Math.min(...buzProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...buzProducts.map((p) => p.tsfPrice)))}\n• Mevcut stok: ${stock} adet\n• Bu ay satışınız: ${DEALER.productMix.buzdolabi ?? 0} adet\n\nEn çok tercih edilenler: 5088 NFK, 5076 NFK, Side-by-Side 274560`,
      };
    },
  },
  {
    patterns: [/çamaşır/i, /washing/i],
    handler: () => {
      const camProducts = products.filter((p) => p.category === "camasir");
      return {
        type: "list",
        text: `Çamaşır makinesi kategorisi:\n\n• ${camProducts.length} model\n• Fiyat aralığı: ₺${fmt(Math.min(...camProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...camProducts.map((p) => p.tsfPrice)))}\n• Mevcut stok: ${DEALER.stockLevels.camasir ?? 0} adet\n• Bu ay satışınız: ${DEALER.productMix.camasir ?? 0} adet`,
      };
    },
  },
  {
    patterns: [/klima/i, /air.?con/i],
    handler: () => {
      const klimaProducts = products.filter((p) => p.category === "klima");
      const stock = DEALER.stockLevels.klima ?? 0;
      return {
        type: "list",
        text: `Klima kategorisi:\n\n• ${klimaProducts.length} model\n• Fiyat aralığı: ₺${fmt(Math.min(...klimaProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...klimaProducts.map((p) => p.tsfPrice)))}\n• Mevcut stok: ${stock} adet ${stock < 10 ? "⚠️ (düşük!)" : ""}\n• Yaz sezonu yaklaşıyor — stok artırmanızı öneriyoruz!\n\nÖne çıkan: Grundig G 12420 Premium (UV-C filtre, A+++)`,
      };
    },
  },
  {
    patterns: [/marj/i, /kar oranı/i, /kâr/i, /kazanç oranı/i],
    handler: () => {
      const cats = (Object.entries(CATEGORY_LABELS) as [ProductCategory, string][]).map(([cat, label]) => {
        const ps = products.filter((p) => p.category === cat);
        const avg = ps.length ? (ps.reduce((s, p) => s + p.marginPercent, 0) / ps.length).toFixed(1) : "0";
        return `• ${label}: %${avg}`;
      }).join("\n");
      return {
        type: "list",
        text: `Kategori bazlı ortalama bayi marjları:\n\n${cats}\n\nKüçük ev aletlerinde en yüksek marj (%30) bulunmaktadır. Bu kategoriyi öne çıkararak karlılığınızı artırabilirsiniz.`,
      };
    },
  },
  {
    patterns: [/teşekkür/i, /sağ ol/i, /eyvallah/i],
    handler: () => ({
      type: "text",
      text: "Rica ederim! Başka bir sorunuz olursa her zaman buradayım. İyi satışlar! 🎯",
    }),
  },
];

const FALLBACK: DealerChatResponse = {
  type: "text",
  text: "Anlayamadım, özür dilerim. Şu konularda yardımcı olabilirim:\n\n• Kampanyalar — 'aktif kampanyalar neler?'\n• Fiyatlar — '5088 NFK fiyatı'\n• Stok — 'stok durumu'\n• Hedefler — 'hedefime ne kadar kaldı?'\n• Siparişler — 'siparişlerim ne durumda?'\n• Taksit — 'taksit seçenekleri'\n\nBu konulardan birini sormayı deneyin!",
};

export function matchDealerIntent(input: string): DealerChatResponse {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(input)) return intent.handler();
    }
  }
  return FALLBACK;
}
