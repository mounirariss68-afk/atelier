import {
  CATEGORY_LABELS, CATEGORY_LABELS_EN,
  getProductName, getCampaignField,
  type ProductCategory,
} from "@/data/arcelik-seed";
import { getArcelikDataSnapshot } from "@/hooks/useArcelikData";
import type { DemoLang } from "../DemoLangContext";
const fmt = (n: number) => n.toLocaleString("tr-TR");

const catLabels = (lang: DemoLang) => (lang === "en" ? CATEGORY_LABELS_EN : CATEGORY_LABELS);

function d() { return getArcelikDataSnapshot(); }

export type DealerResponseType = "text" | "metric" | "table" | "list" | "progress" | "campaign-card";

export interface DealerChatResponse {
  text: string;
  type: DealerResponseType;
  data?: Record<string, unknown>;
}

interface DealerIntent {
  patterns: RegExp[];
  handler: (lang: DemoLang) => DealerChatResponse;
}

const INTENTS: DealerIntent[] = [
  {
    patterns: [/ajan.*görev/i, /yapılacak/i, /agent.*task/i, /görevlerim/i, /ajan.*öner/i, /aksiyon.*öğe/i, /my tasks/i, /to.?do/i, /action item/i],
    handler: (lang) => ({
      type: "list",
      text: lang === "en"
        ? `Agent tasks generated for you:\n\n🔴 Increase AC stock level — Summer season approaching, current stock below optimal\n🟠 Update Ramadan campaign POS materials — New posters and price tags ready\n🟠 Follow up on 3 pending refrigerator quotes — Open quotes from the last 7 days\n🟢 Promote Energy Efficiency campaign — 12% discount active on A+++ products\n🔴 Check TSF price compliance — Weekly audit approaching\n\nDetails appear in the Agent Tasks section on the Home page.`
        : `Sizin için oluşturulan ajan görevleri:\n\n🔴 Klima stok seviyesini artırın — Yaz sezonu yaklaşıyor, mevcut stok optimum altında\n🟠 Ramazan kampanyası POS materyallerini güncelleyin — Yeni afişler ve fiyat etiketleri hazır\n🟠 3 bekleyen buzdolabı teklifini takip edin — Son 7 günde kapanmamış teklifler var\n🟢 Enerji Verimliliği kampanyasını öne çıkarın — A+++ ürünlerde %12 indirim aktif\n🔴 TSF fiyat uyumluluğunu kontrol edin — Haftalık denetim yaklaşıyor\n\nDetaylar Ana Sayfa'daki Ajan Görevleri bölümünde görünür.`,
    }),
  },
  {
    patterns: [/aktif kampanya/i, /kampanyalar neler/i, /hangi kampanya/i, /kampanya var mı/i, /naber kampanya/i, /active campaign/i, /which campaign/i, /any campaign/i, /current campaign/i],
    handler: (lang) => {
      const active = d().campaigns.filter((c) => c.targetCities.includes(d().dealers[0].city));
      const list = active.slice(0, 4).map((c, i) => `${i + 1}. ${getCampaignField(c, "name", lang)}\n   ${getCampaignField(c, "discountDetail", lang)}`).join("\n\n");
      return {
        type: "list",
        text: lang === "en"
          ? `There are ${active.length} active campaigns in your region:\n\n${list}\n\nVisit the Campaigns section for details.`
          : `Şu anda bölgenizde ${active.length} aktif kampanya var:\n\n${list}\n\nDetaylar için Kampanyalar bölümünü ziyaret edebilirsiniz.`,
      };
    },
  },
  {
    patterns: [/merhaba/i, /selam/i, /hey/i, /günaydın/i, /iyi günler/i, /hello/i, /\bhi\b/i, /good morning/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "Hello! As your Arçelik Dealer Assistant, I can help you with campaigns, prices, stock status, targets, and orders. What would you like to ask?"
        : "Merhaba! Arçelik Bayi Asistanı olarak size kampanyalar, fiyatlar, stok durumu, hedefler ve siparişler konusunda yardımcı olabilirim. Ne sormak istersiniz?",
    }),
  },
  {
    patterns: [/naber/i, /nasılsın/i, /n'aber/i, /nbr/i, /how are you/i, /what's up/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? `I'm great, thanks! 😊 What can I do today for ${d().dealers[0].storeName}? I'm ready to help with campaigns, pricing, stock, or target tracking.`
        : `İyiyim, teşekkürler! 😊 Bugün ${d().dealers[0].storeName} için neler yapabilirim? Kampanya, fiyat, stok veya hedef takibi konularında hazırım.`,
    }),
  },
  {
    patterns: [/kampanya.*bitiyor/i, /bitiş tarihi/i, /ne zaman sona/i, /kampanya.*ne zaman/i, /kalan gün/i, /campaign.*end/i, /when.*end/i, /days left/i, /campaign.*expire/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "Active campaign durations:\n• Trade-in (Old-New): Open-ended (year-round)\n• Bank Installment: 31 July 2026 (88 days left)\n• Energy Efficiency: 25 May 2026 (21 days left)\n\nDon't miss the Energy Efficiency campaign in particular — promote A+++ products!"
        : "Aktif kampanya süreleri:\n• Eski-Yeni Değişim: Süresiz (yıl boyunca)\n• Banka Taksit: 31 Temmuz 2026 (88 gün kaldı)\n• Enerji Verimliliği: 25 Mayıs 2026 (21 gün kaldı)\n\nÖzellikle Enerji Verimliliği kampanyasını kaçırmamak için A+++ ürünleri öne çıkarın!",
    }),
  },
  {
    patterns: [/fiyat listesi/i, /fiyat.*liste/i, /tüm fiyat/i, /güncel fiyat/i, /price list/i, /all prices/i, /current price/i],
    handler: (lang) => {
      const sample = d().products.slice(0, 5);
      return {
        type: "table",
        text: lang === "en" ? "Here are samples from the current price list:" : "İşte güncel fiyat listesinden örnekler:",
        data: {
          headers: lang === "en" ? ["Model", "TSF", "Dealer Cost"] : ["Model", "TSF", "Bayi Alış"],
          rows: sample.map((p) => [p.modelCode, `₺${fmt(p.tsfPrice)}`, `₺${fmt(p.dealerCost)}`]),
        },
      };
    },
  },
  {
    patterns: [/hedef.*ne kadar/i, /hedefime.*kaldı/i, /hedef durumu/i, /kaç ürün daha/i, /hedef takip/i, /target/i, /goal/i, /how.*much.*left/i, /target tracking/i],
    handler: (lang) => {
      const remaining = d().dealers[0].monthlySalesTarget - d().dealers[0].currentProgress;
      const pct = Math.round((d().dealers[0].currentProgress / d().dealers[0].monthlySalesTarget) * 100);
      const bonusMsg = lang === "en"
        ? (d().dealers[0].currentProgress >= 50 ? "✅ You crossed the +1% extra commission threshold! " : "")
        : (d().dealers[0].currentProgress >= 50 ? "✅ %1 ek prim eşiğini geçtiniz! " : "");
      const tail = lang === "en"
        ? (remaining <= 10 ? "You're very close to the target — great job! 💪" : "Keep going, you can reach the target!")
        : (remaining <= 10 ? "Hedefe çok yakınsınız, harika gidiyorsunuz! 💪" : "Devam edin, hedefe ulaşabilirsiniz!");
      return {
        type: "progress",
        text: lang === "en"
          ? `Your target this month: ${d().dealers[0].monthlySalesTarget} units\nSold so far: ${d().dealers[0].currentProgress} units\nRemaining: ${remaining} units\n\n${bonusMsg}${tail}`
          : `Bu ayki hedefiniz: ${d().dealers[0].monthlySalesTarget} ürün\nŞu ana kadar: ${d().dealers[0].currentProgress} ürün satıldı\nKalan: ${remaining} ürün\n\n${bonusMsg}${tail}`,
        data: { current: d().dealers[0].currentProgress, target: d().dealers[0].monthlySalesTarget, percent: pct },
      };
    },
  },
  {
    patterns: [/5088|NFK.*5088/i],
    handler: (lang) => {
      const p = d().products.find((pr) => pr.modelCode.includes("5088"));
      if (!p) return { type: "text", text: lang === "en" ? "I couldn't find this model." : "Bu modeli bulamadım." };
      return {
        type: "metric",
        text: lang === "en"
          ? `${getProductName(p, lang)}\n\nTSF: ₺${fmt(p.tsfPrice)}\nDealer Cost: ₺${fmt(p.dealerCost)}\nMargin: ${p.marginPercent}%\nEnergy: ${p.energyClass}\nFeatures: ${p.features.join(", ")}`
          : `${p.name}\n\nTSF: ₺${fmt(p.tsfPrice)}\nBayi Alış: ₺${fmt(p.dealerCost)}\nMarj: %${p.marginPercent}\nEnerji: ${p.energyClass}\nÖzellikler: ${p.features.join(", ")}`,
        data: { value: `₺${fmt(p.tsfPrice)}`, label: lang === "en" ? "TSF Price" : "TSF Fiyatı" },
      };
    },
  },
  {
    patterns: [/fiyat.*nedir/i, /fiyatı ne\b/i, /\bne kadar.*lira/i, /kaç lira/i, /kaç tl/i, /what.*price/i, /how much/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "Which product's price would you like to know? You can type a model code or product name. For example: '5088 NFK price' or 'AC prices'."
        : "Hangi ürünün fiyatını öğrenmek istiyorsunuz? Model kodunu veya ürün adını yazabilirsiniz. Örneğin: '5088 NFK fiyatı' veya 'klima fiyatları'.",
    }),
  },
  {
    patterns: [/vestel.*fiyat/i, /vestel.*karşı/i, /rakip fiyat/i, /rakip.*karşılaştır/i, /vestel.*price/i, /competitor.*price/i, /competitor.*compar/i],
    handler: (lang) => {
      const vestel = d().competitorPrices.filter((cp) => cp.brand === "Vestel").slice(0, 5);
      return {
        type: "table",
        text: lang === "en"
          ? "Price comparison with Vestel (gap vs Arçelik):"
          : "Vestel ile fiyat karşılaştırması (Arçelik'e göre fark):",
        data: {
          headers: lang === "en" ? ["Vestel Model", "Price", "Gap"] : ["Vestel Model", "Fiyat", "Fark"],
          rows: vestel.map((v) => [v.competitorModel, `₺${fmt(v.competitorPrice)}`, `${v.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/prim/i, /komisyon/i, /kazandım/i, /ne kadar prim/i, /primim/i, /commission/i, /bonus/i, /how much.*earn/i],
    handler: (lang) => ({
      type: "metric",
      text: lang === "en"
        ? `Commission earned this month: ₺${fmt(d().dealers[0].earnedCommission)}\n\nA +₺2,400 increase compared to last month.\n\nBy category:\n• Refrigerator: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.35))}\n• Washer: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.22))}\n• Dishwasher: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.15))}\n• Other: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.28))}`
        : `Bu ay kazanılan komisyon: ₺${fmt(d().dealers[0].earnedCommission)}\n\nGeçen aya göre +₺2.400 artış gösterdiniz.\n\nKategori bazlı:\n• Buzdolabı: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.35))}\n• Çamaşır: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.22))}\n• Bulaşık: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.15))}\n• Diğer: ₺${fmt(Math.round(d().dealers[0].earnedCommission * 0.28))}`,
      data: { value: `₺${fmt(d().dealers[0].earnedCommission)}`, label: lang === "en" ? "This Month's Commission" : "Bu Ay Komisyon" },
    }),
  },
  {
    patterns: [/stok.*var mı/i, /stok durumu/i, /\bstok\b/i, /stok.*kardeşim/i, /stock status/i, /\bstock\b/i, /\binventory\b/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const low = Object.entries(d().dealers[0].stockLevels).filter(([cat, lv]) => {
        const opt: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };
        return (lv ?? 0) < (opt[cat] ?? 10);
      });
      const lines = (Object.entries(labels) as [ProductCategory, string][]).map(([cat, label]) => {
        const lv = d().dealers[0].stockLevels[cat] ?? 0;
        const icon = lv > 10 ? "✅" : lv > 0 ? "⚠️" : "❌";
        return lang === "en" ? `${icon} ${label}: ${lv} units` : `${icon} ${label}: ${lv} adet`;
      }).join("\n");
      const tail = lang === "en"
        ? (low.length > 0 ? `⚠️ ${low.length} categories have low stock. Would you like to place an order?` : "✅ Stock is sufficient across all categories.")
        : (low.length > 0 ? `⚠️ ${low.length} kategoride düşük stok var. Sipariş vermek ister misiniz?` : "✅ Tüm kategorilerde stok yeterli.");
      return {
        type: "list",
        text: lang === "en"
          ? `Your stock status:\n\n${lines}\n\n${tail}`
          : `Stok durumunuz:\n\n${lines}\n\n${tail}`,
      };
    },
  },
  {
    patterns: [/sipariş.*durum/i, /siparişlerim/i, /kargo/i, /sipariş.*ne oldu/i, /order status/i, /my orders/i, /shipping/i, /shipment/i],
    handler: (lang) => ({
      type: "table",
      text: lang === "en" ? "Your recent orders:" : "Son siparişleriniz:",
      data: {
        headers: lang === "en" ? ["Order No.", "Date", "Amount", "Status"] : ["Sipariş No", "Tarih", "Tutar", "Durum"],
        rows: lang === "en"
          ? [
              ["SIP-2026-0501", "May 2", "₺97,950", "Preparing"],
              ["SIP-2026-0487", "Apr 28", "₺115,950", "In Transit"],
              ["SIP-2026-0462", "Apr 22", "₺102,860", "Delivered"],
            ]
          : [
              ["SIP-2026-0501", "2 Mayıs", "₺97.950", "Hazırlanıyor"],
              ["SIP-2026-0487", "28 Nisan", "₺115.950", "Kargoda"],
              ["SIP-2026-0462", "22 Nisan", "₺102.860", "Teslim Edildi"],
            ],
      },
    }),
  },
  {
    patterns: [/yeni ürün/i, /yeni model/i, /son eklenen/i, /yeni.*neler/i, /new product/i, /new model/i, /latest.*added/i],
    handler: (lang) => ({
      type: "list",
      text: lang === "en"
        ? "Recently added products:\n\n1. Grundig G 12420 Premium AC — ₺24,990 (UV-C filter, A+++)\n2. Arçelik S 8960 Cordless Vacuum — ₺11,990 (new colors)\n3. Beko BKK 2520 Robot Vacuum — ₺9,990 (laser navigation)\n\nWe recommend featuring these products in your showroom."
        : "Son eklenen ürünler:\n\n1. Grundig G 12420 Premium Klima — ₺24.990 (UV-C filtre, A+++)\n2. Arçelik S 8960 Kablosuz Süpürge — ₺11.990 (yeni renkler)\n3. Beko BKK 2520 Robot Süpürge — ₺9.990 (lazer navigasyon)\n\nBu ürünleri showroom'unuzda öne çıkarmanızı öneririz.",
    }),
  },
  {
    patterns: [/eğitim/i, /eğitim programı/i, /eğitim var mı/i, /kurs/i, /training/i, /course/i, /workshop/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "Upcoming trainings:\n\n📚 Online: Energy Efficiency Regulations\n   May 8, 2026, 14:00–15:30\n   Certified, free of charge\n\n📚 In-person: Istanbul Regional Dealer Meeting\n   May 15, 2026, 10:00–16:00\n   Arçelik HQ, Sütlüce\n\nWould you like to attend?"
        : "Yaklaşan eğitimler:\n\n📚 Online: Enerji Verimliliği Mevzuatı\n   8 Mayıs 2026, 14:00–15:30\n   Sertifikalı, ücretsiz\n\n📚 Yüz yüze: İstanbul Bölgesel Bayi Toplantısı\n   15 Mayıs 2026, 10:00–16:00\n   Arçelik Genel Merkezi, Sütlüce\n\nKatılmak ister misiniz?",
    }),
  },
  {
    patterns: [/sipariş nasıl/i, /nasıl sipariş/i, /sipariş ver/i, /nasıl.*ısmarla/i, /how.*order/i, /place.*order/i, /place order/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "To place an order:\n\n1️⃣ Go to the Stock & Orders section in the portal\n2️⃣ Click 'Place Order' for low-stock categories\n3️⃣ Choose quantity and products\n4️⃣ Confirm — the order is sent to the regional warehouse\n5️⃣ Delivered within 3–5 business days\n\nFor urgent orders, call 444 0 888."
        : "Sipariş vermek için:\n\n1️⃣ Portal'da Stok & Siparişler bölümüne gidin\n2️⃣ Düşük stoklu kategorilerde 'Sipariş Ver' butonuna tıklayın\n3️⃣ Miktar ve ürün seçimini yapın\n4️⃣ Onaylayın — sipariş bölge deposuna iletilir\n5️⃣ 3-5 iş günü içinde teslim edilir\n\nAcil siparişler için 444 0 888'i arayabilirsiniz.",
    }),
  },
  {
    patterns: [/en çok.*sat/i, /en çok.*ürün/i, /popüler/i, /best.?sell/i, /en iyi sat/i, /top.?sell/i, /most popular/i, /top.*product/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const sorted = (Object.entries(d().dealers[0].productMix) as [ProductCategory, number][]).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      const list = sorted.slice(0, 5).map(([cat, count], i) => lang === "en"
        ? `${i + 1}. ${labels[cat]}: ${count} units`
        : `${i + 1}. ${labels[cat]}: ${count} adet`).join("\n");
      return {
        type: "list",
        text: lang === "en"
          ? `Your top-selling categories this month:\n\n${list}\n\nTotal: ${d().dealers[0].currentProgress} units sold.`
          : `Bu ay en çok sattığınız kategoriler:\n\n${list}\n\nToplam: ${d().dealers[0].currentProgress} ürün satışı.`,
      };
    },
  },
  {
    patterns: [/sıralama/i, /kaçıncı/i, /bölge sıra/i, /\brank/i, /bölgemdeki/i, /ranking/i, /my rank/i, /regional rank/i],
    handler: (lang) => ({
      type: "metric",
      text: lang === "en"
        ? "You're ranked 23rd among 127 dealers in your region!\n\nYou are in the top 18%. You moved up 4 places vs last month. Keep meeting your targets to maintain your Gold Dealer status. 🏆"
        : "Bölgenizde 127 bayi arasında 23. sıradasınız!\n\nÜst %82 diliminde yer alıyorsunuz. Geçen aya göre 4 sıra yükseldiniz. Altın Bayi statünüzü korumak için hedeflerinize ulaşmaya devam edin. 🏆",
      data: { value: lang === "en" ? "#23" : "23.", label: lang === "en" ? "Regional Ranking" : "Bölge Sıralaması" },
    }),
  },
  {
    patterns: [/müşteri.*kampanya/i, /müşterime.*öner/i, /kampanya öner/i, /ne öner/i, /customer.*campaign/i, /recommend.*campaign/i, /suggest.*campaign/i, /what.*recommend/i],
    handler: (lang) => ({
      type: "campaign-card",
      text: lang === "en"
        ? "You can recommend the following campaigns to your customers:\n\n🎯 Energy Efficiency: 12% discount on A+++ products\n   → 'Save ₺3,000 per year' message works well\n\n🎯 Bank Installment: Up to 24 months interest-free\n   → Present 'Just ₺X per month' calculation\n\n🎯 Trade-in: ₺2,000–₺5,000 discount\n   → 'Bring your old appliance, get the new at half price' message\n\nSMS templates are ready in the Campaigns section."
        : "Müşterilerinize şu kampanyaları önerebilirsiniz:\n\n🎯 Enerji Verimliliği: A+++ ürünlerde %12 indirim\n   → 'Yıllık ₺3.000 tasarruf edin' mesajı etkili\n\n🎯 Banka Taksit: 24 aya kadar faizsiz\n   → 'Aylık sadece ₺X' hesaplaması sunun\n\n🎯 Eski-Yeni Değişim: ₺2.000–₺5.000 indirim\n   → 'Eski cihazınızı getirin, yenisi yarı fiyatına' mesajı\n\nSMS şablonları Kampanyalar bölümünde hazır.",
    }),
  },
  {
    patterns: [/taksit/i, /taksit seçenek/i, /kaç taksit/i, /taksitli/i, /installment/i, /financing/i],
    handler: (lang) => ({
      type: "table",
      text: lang === "en" ? "Active installment options:" : "Aktif taksit seçenekleri:",
      data: {
        headers: lang === "en" ? ["Bank", "Installments", "Maturity Fee"] : ["Banka", "Taksit", "Vade Farkı"],
        rows: lang === "en"
          ? [
              ["Ziraat Bankası", "24 months", "Interest-free"],
              ["Halkbank", "24 months", "Interest-free"],
              ["Vakıfbank", "24 months", "Interest-free"],
              ["İş Bankası", "12 months", "1.29%"],
              ["Garanti BBVA", "12 months", "1.39%"],
              ["Yapı Kredi", "9 months", "Interest-free"],
            ]
          : [
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
    patterns: [/düşük stok/i, /stok uyarı/i, /tükenen/i, /kritik stok/i, /low stock/i, /stock alert/i, /out of stock/i, /critical stock/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const low = Object.entries(d().dealers[0].stockLevels).filter(([cat, lv]) => {
        const opt: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };
        return (lv ?? 0) < (opt[cat] ?? 10);
      });
      if (low.length === 0) {
        return {
          type: "text",
          text: lang === "en"
            ? "✅ Stock levels are sufficient across all categories. Nothing to worry about!"
            : "✅ Şu anda tüm kategorilerde stok seviyesi yeterli. Endişelenecek bir şey yok!",
        };
      }
      const items = low.map(([cat, lv]) => lang === "en"
        ? `⚠️ ${labels[cat as ProductCategory]}: ${lv} units (below optimum)`
        : `⚠️ ${labels[cat as ProductCategory]}: ${lv} adet (optimum altında)`).join("\n");
      return {
        type: "list",
        text: lang === "en"
          ? `Low stock alert — ${low.length} categories:\n\n${items}\n\nYou can quickly place an order from the Stock & Orders section.`
          : `Düşük stok uyarısı — ${low.length} kategori:\n\n${items}\n\nStok & Siparişler bölümünden hızlıca sipariş verebilirsiniz.`,
      };
    },
  },
  {
    patterns: [/fiyat değişikliği/i, /fiyat güncelle/i, /son fiyat/i, /fiyat ne oldu/i, /price change/i, /price update/i, /latest.*price/i],
    handler: (lang) => ({
      type: "table",
      text: lang === "en" ? "Products with price changes in the last 7 days:" : "Son 7 günde fiyat değişen ürünler:",
      data: {
        headers: lang === "en" ? ["Model", "Old Price", "New Price", "Date"] : ["Model", "Eski Fiyat", "Yeni Fiyat", "Tarih"],
        rows: lang === "en"
          ? [
              ["5088 NFK", "₺24,990", "₺25,990", "May 1"],
              ["10143 D Premium", "₺23,990", "₺24,990", "Apr 29"],
              ["12420 Klima", "₺20,490", "₺21,990", "Apr 30"],
            ]
          : [
              ["5088 NFK", "₺24.990", "₺25.990", "1 Mayıs"],
              ["10143 D Premium", "₺23.990", "₺24.990", "29 Nisan"],
              ["12420 Klima", "₺20.490", "₺21.990", "30 Nisan"],
            ],
      },
    }),
  },
  {
    patterns: [/kampanya matery/i, /afiş/i, /SMS şablon/i, /sosyal medya/i, /materyal/i, /campaign material/i, /poster/i, /sms template/i, /social media/i],
    handler: (lang) => {
      const c = d().campaigns.find((c) => c.id === "enerji-verimlilik") ?? d().campaigns[0];
      return {
        type: "text",
        text: lang === "en"
          ? `Campaign materials:\n\n📱 SMS Template:\n"${getCampaignField(c, "dealerSmsNotification", lang)}"\n\n🏪 POS Message:\n"${getCampaignField(c, "dealerPosMessaging", lang)}"\n\n📋 Banner Description:\n${getCampaignField(c, "bannerDescription", lang)}\n\nAll materials are accessible from the Campaigns section.`
          : `Kampanya materyalleri:\n\n📱 SMS Şablonu:\n"${c.dealerSmsNotification}"\n\n🏪 POS Mesajı:\n"${c.dealerPosMessaging}"\n\n📋 Afiş Açıklaması:\n${c.bannerDescription}\n\nTüm materyallere Kampanyalar bölümünden ulaşabilirsiniz.`,
      };
    },
  },
  {
    patterns: [/uyum puanı/i, /uyum skor/i, /compliance/i, /uyumum/i, /compliance score/i, /my compliance/i],
    handler: (lang) => ({
      type: "metric",
      text: lang === "en"
        ? `Your compliance score: ${d().dealers[0].complianceScore}/100\n\n${d().dealers[0].complianceScore >= 85 ? "✅ Great! You're above the compliance target." : "⚠️ Target is 85 points. To raise your score, ensure TSF price compliance and display campaign materials in the storefront."}\n\nCompliance score criteria:\n• TSF price compliance\n• Use of campaign materials\n• Timely orders and stock management\n• Training participation`
        : `Uyum puanınız: ${d().dealers[0].complianceScore}/100\n\n${d().dealers[0].complianceScore >= 85 ? "✅ Harika! Uyum hedefinizin üzerindesiniz." : "⚠️ Hedef 85 puan. Puanınızı artırmak için TSF fiyatlarına uyumu ve kampanya materyallerini vitrine koymayı unutmayın."}\n\nUyum puanı kriterleri:\n• TSF fiyatına uygunluk\n• Kampanya materyalleri kullanımı\n• Zamanında sipariş ve stok yönetimi\n• Eğitimlere katılım`,
      data: { value: `${d().dealers[0].complianceScore}/100`, label: lang === "en" ? "Compliance Score" : "Uyum Puanı" },
    }),
  },
  {
    patterns: [/bayi seviye/i, /altın bayi/i, /tier/i, /seviyem/i, /bayi.*statü/i, /dealer.*level/i, /gold dealer/i, /my tier/i, /dealer.*status/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? `Your current tier: 🥇 Gold Dealer\n\nGold Dealer benefits:\n• Priority stock allocation\n• +0.5% extra commission\n• Exclusive campaign opportunities\n• Invitation to regional meetings\n• Priority distribution of new products\n\nTo maintain Gold tier: Compliance score ≥85, monthly target achievement ≥80%`
        : `Mevcut seviyeniz: 🥇 Altın Bayi\n\nAltın Bayi avantajları:\n• Öncelikli stok tahsisi\n• %0.5 ek komisyon\n• Özel kampanya fırsatları\n• Bölgesel toplantılara davet\n• Yeni ürün öncelikli dağıtım\n\nAltın seviyeyi korumak için: Uyum puanı ≥85, aylık hedef gerçekleştirme ≥80%`,
    }),
  },
  {
    patterns: [/yardım/i, /ne yapabilirsin/i, /komut/i, /menü/i, /\bhelp\b/i, /what.*can.*do/i, /commands/i, /menu/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "I can help you with:\n\n🤖 Agent Tasks — to-do items, action items\n📋 Campaigns — active campaigns, end dates\n💰 Prices — product prices, competitor comparison\n📦 Stock — stock status, low stock alerts\n🎯 Targets — sales target tracking, commission status\n🚛 Orders — order status, how to place an order\n📣 Announcements — new products, trainings\n💳 Installments — bank installment options\n🏆 Ranking — regional dealer ranking\n\nJust type the topic you want to ask about!"
        : "Size şu konularda yardımcı olabilirim:\n\n🤖 Ajan Görevleri — yapılacak görevler, aksiyon öğeleri\n📋 Kampanyalar — aktif kampanyalar, bitiş tarihleri\n💰 Fiyatlar — ürün fiyatları, rakip karşılaştırma\n📦 Stok — stok durumu, düşük stok uyarıları\n🎯 Hedefler — satış hedefi takibi, prim durumu\n🚛 Siparişler — sipariş durumu, nasıl sipariş verilir\n📣 Duyurular — yeni ürünler, eğitimler\n💳 Taksit — banka taksit seçenekleri\n🏆 Sıralama — bölgesel bayi sıralaması\n\nSormak istediğiniz konuyu yazmanız yeterli!",
    }),
  },
  {
    patterns: [/buzdolab/i, /fridge/i, /refrigerator/i],
    handler: (lang) => {
      const buzProducts = d().products.filter((p) => p.category === "buzdolabi");
      const stock = d().dealers[0].stockLevels.buzdolabi ?? 0;
      const min = fmt(Math.min(...buzProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...buzProducts.map((p) => p.tsfPrice)));
      return {
        type: "list",
        text: lang === "en"
          ? `Refrigerator category:\n\n• ${buzProducts.length} model portfolio\n• Price range: ₺${min} – ₺${max}\n• Current stock: ${stock} units\n• Sales this month: ${d().dealers[0].productMix.buzdolabi ?? 0} units\n\nMost preferred: 5088 NFK, 5076 NFK, Side-by-Side 274560`
          : `Buzdolabı kategorisi:\n\n• ${buzProducts.length} model portföyü\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Mevcut stok: ${stock} adet\n• Bu ay satışınız: ${d().dealers[0].productMix.buzdolabi ?? 0} adet\n\nEn çok tercih edilenler: 5088 NFK, 5076 NFK, Side-by-Side 274560`,
      };
    },
  },
  {
    patterns: [/çamaşır/i, /washing/i, /washer/i],
    handler: (lang) => {
      const camProducts = d().products.filter((p) => p.category === "camasir");
      const min = fmt(Math.min(...camProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...camProducts.map((p) => p.tsfPrice)));
      return {
        type: "list",
        text: lang === "en"
          ? `Washing machine category:\n\n• ${camProducts.length} models\n• Price range: ₺${min} – ₺${max}\n• Current stock: ${d().dealers[0].stockLevels.camasir ?? 0} units\n• Sales this month: ${d().dealers[0].productMix.camasir ?? 0} units`
          : `Çamaşır makinesi kategorisi:\n\n• ${camProducts.length} model\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Mevcut stok: ${d().dealers[0].stockLevels.camasir ?? 0} adet\n• Bu ay satışınız: ${d().dealers[0].productMix.camasir ?? 0} adet`,
      };
    },
  },
  {
    patterns: [/klima/i, /air.?con/i],
    handler: (lang) => {
      const klimaProducts = d().products.filter((p) => p.category === "klima");
      const stock = d().dealers[0].stockLevels.klima ?? 0;
      const min = fmt(Math.min(...klimaProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...klimaProducts.map((p) => p.tsfPrice)));
      const lowMark = lang === "en" ? "⚠️ (low!)" : "⚠️ (düşük!)";
      return {
        type: "list",
        text: lang === "en"
          ? `Air conditioner category:\n\n• ${klimaProducts.length} models\n• Price range: ₺${min} – ₺${max}\n• Current stock: ${stock} units ${stock < 10 ? lowMark : ""}\n• Summer season approaching — we recommend increasing stock!\n\nFeatured: Grundig G 12420 Premium (UV-C filter, A+++)`
          : `Klima kategorisi:\n\n• ${klimaProducts.length} model\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Mevcut stok: ${stock} adet ${stock < 10 ? lowMark : ""}\n• Yaz sezonu yaklaşıyor — stok artırmanızı öneriyoruz!\n\nÖne çıkan: Grundig G 12420 Premium (UV-C filtre, A+++)`,
      };
    },
  },
  {
    patterns: [/marj/i, /kar oranı/i, /kâr/i, /kazanç oranı/i, /margin/i, /profit/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const cats = (Object.entries(labels) as [ProductCategory, string][]).map(([cat, label]) => {
        const ps = d().products.filter((p) => p.category === cat);
        const avg = ps.length ? (ps.reduce((s, p) => s + p.marginPercent, 0) / ps.length).toFixed(1) : "0";
        return lang === "en" ? `• ${label}: ${avg}%` : `• ${label}: %${avg}`;
      }).join("\n");
      return {
        type: "list",
        text: lang === "en"
          ? `Average dealer margins by category:\n\n${cats}\n\nSmall appliances offer the highest average margin (~30%). Featuring this category can boost your profitability.`
          : `Kategori bazlı ortalama bayi marjları:\n\n${cats}\n\nKüçük ev aletlerinde en yüksek marj (%30) bulunmaktadır. Bu kategoriyi öne çıkararak karlılığınızı artırabilirsiniz.`,
      };
    },
  },
  {
    patterns: [/teşekkür/i, /sağ ol/i, /eyvallah/i, /thanks/i, /thank you/i],
    handler: (lang) => ({
      type: "text",
      text: lang === "en"
        ? "You're welcome! I'm here whenever you have more questions. Happy selling! 🎯"
        : "Rica ederim! Başka bir sorunuz olursa her zaman buradayım. İyi satışlar! 🎯",
    }),
  },
];

const FALLBACK = (lang: DemoLang): DealerChatResponse => ({
  type: "text",
  text: lang === "en"
    ? "Sorry, I didn't quite get that. I can help with:\n\n• Campaigns — 'what are the active campaigns?'\n• Prices — '5088 NFK price'\n• Stock — 'stock status'\n• Targets — 'how much is left to my target?'\n• Orders — 'what's the status of my orders?'\n• Installments — 'installment options'\n\nTry asking about one of these topics!"
    : "Anlayamadım, özür dilerim. Şu konularda yardımcı olabilirim:\n\n• Kampanyalar — 'aktif kampanyalar neler?'\n• Fiyatlar — '5088 NFK fiyatı'\n• Stok — 'stok durumu'\n• Hedefler — 'hedefime ne kadar kaldı?'\n• Siparişler — 'siparişlerim ne durumda?'\n• Taksit — 'taksit seçenekleri'\n\nBu konulardan birini sormayı deneyin!",
});

export function matchDealerIntent(input: string, lang: DemoLang = "tr"): DealerChatResponse {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(input)) return intent.handler(lang);
    }
  }
  return FALLBACK(lang);
}
