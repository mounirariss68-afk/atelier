import {
  CATEGORY_LABELS, CATEGORY_LABELS_EN, COMPETITOR_BRANDS,
  getProductName, getCampaignField, getCitySeasonalPattern, getCityName,
  getSubcategoryLabel, getPriceTierLabel, getProductSpecs,
  type ProductCategory, type PriceTier,
} from "@/data/arcelik-seed";
import { getArcelikDataSnapshot } from "@/hooks/useArcelikData";
import type { DemoLang } from "./DemoLangContext";

export type ResponseType = "text" | "metric" | "table" | "list" | "campaign-card" | "analysis" | "chart";

export interface ChatResponse {
  agent: "analyst" | "campaign-mgr";
  text: string;
  type: ResponseType;
  data?: Record<string, unknown>;
}

interface Intent {
  patterns: RegExp[];
  handler: (lang: DemoLang) => ChatResponse;
}

const fmt = (n: number) => n.toLocaleString("tr-TR");

const catLabels = (lang: DemoLang) => (lang === "en" ? CATEGORY_LABELS_EN : CATEGORY_LABELS);

function d() { return getArcelikDataSnapshot(); }

const INTENTS: Intent[] = [
  {
    patterns: [/ajan.*karar/i, /ajan.*öner/i, /bekleyen.*karar/i, /bekleyen.*öner/i, /agent.*decision/i, /agent.*recommend/i, /pending.*decision/i, /pending.*recommend/i, /onay bekleyen/i, /awaiting.*approval/i],
    handler: (lang) => {
      const pick = (tr: string, en: string) => (lang === "en" ? en : tr);
      return {
        agent: "analyst",
        type: "analysis",
        text: pick(
          `Şu anda 15 bekleyen ajan önerisi var. Kritik olanlar:\n\n🔴 Q2 Hedefler Risk Altında — ₺158M açığı kapatmak için eş zamanlı kampanya paketi önerildi\n🟠 Vestel Buzdolabı Fiyat Saldırısı — Ekonomik segmentte karşı strateji gerekli (%87 güven)\n🟠 Klima Sezon Hazırlığı — Bayi stoklarını 2x artırma ve Temmuz fiyat artışı önerisi (%95 güven)\n🟠 Ramazan Kampanyası ROI Düşüşü — Dijital bütçe artışı ve mesaj uyarlaması önerildi\n\n📋 Tüm önerileri görmek için "Ajan Kararları" sekmesine gidin.\n🤖 3 aktif oyun planı çalışıyor (rakip fiyat müdahalesi, kampanya optimizasyonu, stok takviyesi).`,
          `There are 15 pending agent recommendations. The critical ones:\n\n🔴 Q2 Targets at Risk — A simultaneous campaign package proposed to close the ₺158M gap\n🟠 Vestel Refrigerator Price Attack — Counter-strategy needed in the economy segment (87% confidence)\n🟠 AC Season Preparation — Recommendation to 2x dealer stocks and a July price increase (95% confidence)\n🟠 Ramadan Campaign ROI Decline — Digital budget increase and message adjustment proposed\n\n📋 Visit the "Agent Decisions" tab to see all recommendations.\n🤖 3 active playbooks are running (competitor price intervention, campaign optimization, stock replenishment).`
        ),
      };
    },
  },
  {
    patterns: [/vestel.*ne.*yapmalı/i, /vestel.*öner/i, /vestel.*strateji/i, /vestel.*karşı/i, /vestel.*fiyat.*saldır/i, /vestel.*nasıl.*karşıla/i, /vestel.*strategy/i, /vestel.*counter/i, /vestel.*price.*attack/i, /respond.*to.*vestel/i],
    handler: (lang) => {
      const pick = (tr: string, en: string) => (lang === "en" ? en : tr);
      return {
        agent: "analyst",
        type: "analysis",
        text: pick(
          `🔴 Vestel Buzdolabı Fiyat Saldırısı — Ajan Önerisi (Güven: %87)\n\n📊 Akıl Yürütme:\n1. Veri Toplama: Vestel ekonomik segment buzdolabı fiyatlarını %12 düşürdü (3 gün önce)\n2. Etki Analizi: Arçelik ekonomik segmentte %3.2pp pazar payı kaybı riski\n3. Rakip Modelleme: Vestel'in marj yapısı bu fiyatı 45 günden fazla sürdüremez\n4. Strateji: Doğrudan fiyat indirimi yerine değer odaklı paket önerisi\n\n💡 Önerilen Aksiyon:\n• Ekonomik buzdolabı + küçük ev aleti paketi (sepet değeri korunur)\n• 10 yıl kompresör garantisi vurgusu (Vestel'de 5 yıl)\n• Hedef bayilerde özel lansman (önce Tier-1 şehirler)\n\n📈 Tahmini Etki: +₺4.2M gelir, +0.8pp marj, +1.1pp pazar payı (30 gün)\n\n➡️ Bu öneriyi onaylamak/değiştirmek için "Ajan Kararları" sekmesindeki Öneriler paneline gidin.`,
          `🔴 Vestel Refrigerator Price Attack — Agent Recommendation (Confidence: 87%)\n\n📊 Reasoning:\n1. Data Collection: Vestel cut economy-segment refrigerator prices by 12% (3 days ago)\n2. Impact Analysis: Arçelik faces a 3.2pp market share loss risk in the economy segment\n3. Competitor Modeling: Vestel's margin structure cannot sustain this price beyond 45 days\n4. Strategy: A value-focused bundle instead of a direct price cut\n\n💡 Suggested Action:\n• Economy refrigerator + small appliance bundle (basket value preserved)\n• Highlight 10-year compressor warranty (Vestel offers 5 years)\n• Exclusive launch at target dealers (Tier-1 cities first)\n\n📈 Estimated Impact: +₺4.2M revenue, +0.8pp margin, +1.1pp market share (30 days)\n\n➡️ Go to the Recommendations panel under the "Agent Decisions" tab to approve/modify this recommendation.`
        ),
      };
    },
  },
  {
    patterns: [/playbook/i, /oyun planı/i, /otomasyon/i, /ajan.*ne.*yapıyor/i, /ajan.*aktiv/i, /automation/i, /what.*agent.*doing/i, /active.*agent/i],
    handler: (lang) => {
      const pick = (tr: string, en: string) => (lang === "en" ? en : tr);
      return {
        agent: "analyst",
        type: "analysis",
        text: pick(
          `Aktif ajan oyun planları:\n\n⚡ Rakip Fiyat Müdahale Protokolü — Çalışıyor (4/6 adım tamamlandı)\n   Vestel fiyat düşüşüne karşı strateji hazırlanıyor\n\n⚡ Kampanya Performans Müdahale — Onay Bekliyor\n   Ramazan kampanyası optimizasyonu pazarlama direktörünün onayında\n\n⚡ Stok Optimizasyon Protokolü — Çalışıyor (3/5 adım)\n   Klima stok takviyesi siparişi hesaplanıyor\n\n✅ Bayi Coaching Programı — Tamamlandı\n   8 bayiden 6'sında uyum puanı artışı sağlandı\n\n12 ajan son 24 saatte 12 aksiyon gerçekleştirdi.`,
          `Active agent playbooks:\n\n⚡ Competitor Price Response Protocol — Running (4/6 steps complete)\n   Strategy being prepared against Vestel price cut\n\n⚡ Campaign Performance Intervention — Awaiting Approval\n   Ramadan campaign optimization pending marketing director approval\n\n⚡ Stock Optimization Protocol — Running (3/5 steps)\n   AC stock replenishment order being calculated\n\n✅ Dealer Coaching Program — Completed\n   Compliance score improved at 6 of 8 dealers\n\n12 agents executed 12 actions in the last 24 hours.`
        ),
      };
    },
  },
  {
    patterns: [/merhaba/i, /selam/i, /hey/i, /günaydın/i, /iyi günler/i, /hello/i, /\bhi\b/i, /good morning/i, /good day/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "text",
      text: lang === "en"
        ? "Hello! Welcome to the Arçelik Price Intelligence Platform. 🤖 Currently 15 agent recommendations are awaiting approval and 3 playbooks are running. I can help you with market analysis, competitor pricing, campaign suggestions, agent decisions, or regional reports. What would you like to ask?"
        : "Merhaba! Arçelik Fiyat İstihbarat Platformu'na hoş geldiniz. 🤖 Şu anda 15 ajan önerisi onay bekliyor ve 3 oyun planı aktif çalışıyor. Size pazar analizi, rakip fiyatlandırma, kampanya önerisi, ajan kararları veya bölgesel raporlar konusunda yardımcı olabilirim. Ne sormak istersiniz?",
    }),
  },
  {
    patterns: [/pazar pay/i, /market share/i, /payımız kaç/i, /pay.*ne/i, /our.*share/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "metric",
      text: lang === "en"
        ? "Arçelik's national market share is currently at 39.8%. Our target is to reach 42.0%. A +0.8 point increase has been recorded recently."
        : "Arçelik'in ulusal pazar payı şu anda %39.8 seviyesinde. Hedefimiz %42.0'ye ulaşmak. Son dönemde +0.8 puanlık artış yaşandı.",
      data: { value: "39.8%", target: "42.0%", delta: "+0.8pp", trend: "up" },
    }),
  },
  {
    patterns: [/marj/i, /margin/i, /brüt/i, /kâr.*oran/i, /gross.*profit/i, /profit.*ratio/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const catBreakdown = Object.entries(labels).map(([cat, label]) => {
        const ps = d().products.filter((p) => p.category === cat);
        const avg = ps.length ? (ps.reduce((s, p) => s + p.marginPercent, 0) / ps.length).toFixed(1) : "0";
        return `${label}: %${avg}`;
      }).join(", ");
      return {
        agent: "analyst",
        type: "metric",
        text: lang === "en"
          ? `Average gross margin: 21.8% (target: 22.5%). By category: ${catBreakdown}`
          : `Ortalama brüt marj: %21.8 (hedef: %22.5). Kategori bazlı: ${catBreakdown}`,
        data: { value: "21.8%", target: "22.5%", delta: "-0.3pp", trend: "down" },
      };
    },
  },
  {
    patterns: [/en çok sat/i, /best.?sell/i, /popüler ürün/i, /en iyi ürün/i, /top.*product/i, /top.*selling/i],
    handler: (lang) => {
      const top5 = [...d().products].sort((a, b) => b.tsfPrice * (100 - a.marginPercent) - a.tsfPrice * (100 - b.marginPercent)).slice(0, 5);
      const list = top5.map((p, i) => lang === "en"
        ? `${i + 1}. ${getProductName(p, lang)} — ₺${fmt(p.tsfPrice)} (margin: ${p.marginPercent}%)`
        : `${i + 1}. ${p.name} — ₺${fmt(p.tsfPrice)} (marj: %${p.marginPercent})`).join("\n");
      return {
        agent: "analyst",
        type: "list",
        text: lang === "en"
          ? `Top 5 products by revenue potential:\n${list}`
          : `En yüksek gelir potansiyeline sahip 5 ürün:\n${list}`,
      };
    },
  },
  {
    patterns: [/vestel.*fiyat/i, /vestel.*ne/i, /vestel.*son/i, /vestel.*price/i, /vestel.*latest/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const vestelPrices = d().competitorPrices.filter((cp) => cp.brand === "Vestel");
      const avg = (vestelPrices.reduce((s, p) => s + p.priceDeltaPercent, 0) / vestelPrices.length).toFixed(1);
      return {
        agent: "analyst",
        type: "table",
        text: lang === "en"
          ? `${vestelPrices.length} Vestel product prices are tracked. Average price gap: ${avg}% (vs Arçelik).`
          : `Vestel'in ${vestelPrices.length} ürün fiyatı takip ediliyor. Ortalama fiyat farkı: %${avg} (Arçelik'e göre).`,
        data: {
          headers: lang === "en"
            ? ["Model", "Category", "Price", "Gap"]
            : ["Model", "Kategori", "Fiyat", "Fark"],
          rows: vestelPrices.map((p) => [p.competitorModel, labels[p.category], `₺${fmt(p.competitorPrice)}`, `${p.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/bosch.*fiyat/i, /bosch.*karşı/i, /bosch.*ne/i, /bosch.*price/i, /bosch.*compare/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const boschPrices = d().competitorPrices.filter((cp) => cp.brand === "Bosch");
      const avg = (boschPrices.reduce((s, p) => s + p.priceDeltaPercent, 0) / boschPrices.length).toFixed(0);
      return {
        agent: "analyst",
        type: "table",
        text: lang === "en"
          ? `Bosch is positioned in the premium segment. Across ${boschPrices.length} products they are on average ${avg}% more expensive.`
          : `Bosch premium segmentte konumlanıyor. ${boschPrices.length} üründe ortalama %${avg} daha pahalılar.`,
        data: {
          headers: lang === "en"
            ? ["Model", "Category", "Price", "Gap"]
            : ["Model", "Kategori", "Fiyat", "Fark"],
          rows: boschPrices.map((p) => [p.competitorModel, labels[p.category], `₺${fmt(p.competitorPrice)}`, `+${p.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/samsung/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const samsungPrices = d().competitorPrices.filter((cp) => cp.brand === "Samsung");
      const avg = (samsungPrices.reduce((s, p) => s + p.priceDeltaPercent, 0) / (samsungPrices.length || 1)).toFixed(0);
      return {
        agent: "analyst",
        type: "table",
        text: lang === "en"
          ? `Samsung is tracked across ${samsungPrices.length} categories. With premium positioning, the average gap vs Arçelik is ${avg}%.`
          : `Samsung ${samsungPrices.length} kategoride takip ediliyor. Premium konumlandırma ile Arçelik'e göre ortalama %${avg} fark var.`,
        data: {
          headers: lang === "en"
            ? ["Model", "Category", "Price", "Gap"]
            : ["Model", "Kategori", "Fiyat", "Fark"],
          rows: samsungPrices.map((p) => [p.competitorModel, labels[p.category], `₺${fmt(p.competitorPrice)}`, `${p.priceDeltaPercent > 0 ? "+" : ""}${p.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/kampanya.*öner/i, /yeni kampanya/i, /campaign.*suggest/i, /ne kampanya/i, /suggest.*campaign/i, /new campaign/i, /recommend.*campaign/i],
    handler: (lang) => {
      const c = d().campaigns[Math.floor(Math.random() * d().campaigns.length)];
      const cityNames = c.targetCities.map((id) => { const ct = d().cities.find((ct) => ct.id === id); return ct ? getCityName(ct, lang) : null; }).filter(Boolean).join(", ");
      return {
        agent: "campaign-mgr",
        type: "campaign-card",
        text: lang === "en"
          ? `AI campaign suggestion: "${getCampaignField(c, "name", lang)}"\n\n🎯 Target: ${getCampaignField(c, "targetSegment", lang)}\n📍 Cities: ${cityNames}\n💰 Discount: ${getCampaignField(c, "discountDetail", lang)}\n📈 Estimated impact: Market share ${c.projectedImpact.marketShareLift}, Revenue ${c.projectedImpact.revenueDelta}`
          : `AI kampanya önerisi: "${c.name}"\n\n🎯 Hedef: ${c.targetSegment}\n📍 Şehirler: ${cityNames}\n💰 İndirim: ${c.discountDetail}\n📈 Tahmini etki: Pazar payı ${c.projectedImpact.marketShareLift}, Gelir ${c.projectedImpact.revenueDelta}`,
        data: { campaignId: c.id, name: getCampaignField(c, "name", lang) },
      };
    },
  },
  {
    patterns: [/ramazan/i, /bayram.*kampanya/i, /ramadan/i],
    handler: (lang) => {
      const c = d().campaigns.find((c) => c.id === "ramazan")!;
      return {
        agent: "campaign-mgr",
        type: "campaign-card",
        text: lang === "en"
          ? `Ramadan / Eid Campaign details:\n\n📋 ${getCampaignField(c, "headline", lang)}\n📝 ${getCampaignField(c, "bodyCopy", lang)}\n🎯 ${getCampaignField(c, "targetSegment", lang)}\n💰 ${getCampaignField(c, "discountDetail", lang)}\n📈 Impact: Market share ${c.projectedImpact.marketShareLift}, Revenue ${c.projectedImpact.revenueDelta}, Margin ${c.projectedImpact.marginEffect}`
          : `Ramazan Bayramı Kampanyası detayları:\n\n📋 ${c.headline}\n📝 ${c.bodyCopy}\n🎯 ${c.targetSegment}\n💰 ${c.discountDetail}\n📈 Etki: Pazar payı ${c.projectedImpact.marketShareLift}, Gelir ${c.projectedImpact.revenueDelta}, Marj ${c.projectedImpact.marginEffect}`,
        data: { campaignId: c.id },
      };
    },
  },
  {
    patterns: [/düğün/i, /çeyiz/i, /wedding/i, /trousseau/i],
    handler: (lang) => {
      const c = d().campaigns.find((c) => c.id === "dugun-sezonu")!;
      const cityNames = c.targetCities.map((id) => { const ct = d().cities.find((ct) => ct.id === id); return ct ? getCityName(ct, lang) : null; }).filter(Boolean).join(", ");
      return {
        agent: "campaign-mgr",
        type: "campaign-card",
        text: lang === "en"
          ? `Wedding Season Trousseau Bundle:\n\n📋 ${getCampaignField(c, "headline", lang)}\n🎯 ${getCampaignField(c, "targetSegment", lang)}\n💰 ${getCampaignField(c, "discountDetail", lang)}\n📈 Estimated impact: Market share ${c.projectedImpact.marketShareLift}, Revenue ${c.projectedImpact.revenueDelta}\n📍 Target cities: ${cityNames}`
          : `Düğün Sezonu Çeyiz Paketi:\n\n📋 ${c.headline}\n🎯 ${c.targetSegment}\n💰 ${c.discountDetail}\n📈 Tahmini etki: Pazar payı ${c.projectedImpact.marketShareLift}, Gelir ${c.projectedImpact.revenueDelta}\n📍 Hedef şehirler: ${cityNames}`,
        data: { campaignId: c.id },
      };
    },
  },
  {
    patterns: [/kaç ürün/i, /ürün sayısı/i, /toplam ürün/i, /how many product/i, /product count/i, /total product/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const breakdown = Object.entries(labels).map(([cat, label]) => `${label}: ${d().products.filter((p) => p.category === cat).length}`).join(", ");
      return {
        agent: "analyst",
        type: "metric",
        text: lang === "en"
          ? `${d().products.length} products are being tracked in total. Breakdown by category: ${breakdown}`
          : `Toplam ${d().products.length} ürün takip ediliyor. Kategori bazlı dağılım: ${breakdown}`,
        data: { value: d().products.length.toString(), label: lang === "en" ? "Total Products" : "Toplam Ürün" },
      };
    },
  },
  {
    patterns: [/bayi.*uyum/i, /compliance/i, /bayi.*durum/i, /bayi.*skor/i, /dealer.*compliance/i, /dealer.*status/i, /dealer.*score/i],
    handler: (lang) => {
      const avg = d().dealers.reduce((s, d) => s + d.complianceScore, 0) / d().dealers.length;
      const gold = d().dealers.filter((d) => d.tier === "gold").length;
      const silver = d().dealers.filter((d) => d.tier === "silver").length;
      const bronze = d().dealers.filter((d) => d.tier === "bronze").length;
      const top = [...d().dealers].sort((a, b) => b.complianceScore - a.complianceScore)[0];
      const low = [...d().dealers].sort((a, b) => a.complianceScore - b.complianceScore)[0];
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Dealer compliance overview:\n• Average score: ${avg.toFixed(1)}/100 (target: 85)\n• Gold: ${gold}, Silver: ${silver}, Bronze: ${bronze}\n• Highest: ${top.storeName} (${top.complianceScore})\n• Lowest: ${low.storeName} (${low.complianceScore})`
          : `Bayi uyum durumu:\n• Ortalama skor: ${avg.toFixed(1)}/100 (hedef: 85)\n• Gold: ${gold}, Silver: ${silver}, Bronze: ${bronze}\n• En yüksek: ${top.storeName} (${top.complianceScore})\n• En düşük: ${low.storeName} (${low.complianceScore})`,
      };
    },
  },
  {
    patterns: [/düşük marj/i, /en düşük.*marj/i, /marj.*düşük/i, /zayıf marj/i, /low margin/i, /weakest margin/i],
    handler: (lang) => {
      const sorted = [...d().products].sort((a, b) => a.marginPercent - b.marginPercent).slice(0, 5);
      const list = sorted.map((p, i) => lang === "en"
        ? `${i + 1}. ${getProductName(p, lang)} — ${p.marginPercent}% margin (₺${fmt(p.tsfPrice)})`
        : `${i + 1}. ${p.name} — %${p.marginPercent} marj (₺${fmt(p.tsfPrice)})`).join("\n");
      return {
        agent: "analyst",
        type: "list",
        text: lang === "en"
          ? `Bottom 5 products by margin:\n${list}\n\n⚠️ Price optimization may be considered for these d().products.`
          : `En düşük marjlı 5 ürün:\n${list}\n\n⚠️ Bu ürünlerde fiyat optimizasyonu değerlendirilebilir.`,
      };
    },
  },
  {
    patterns: [/en rekabet/i, /avantaj/i, /güçlü.*ürün/i, /biz.*nerede.*iyi/i, /our.*advantage/i, /strong.*product/i, /where.*strong/i],
    handler: (lang) => {
      const advantages = d().competitorPrices.filter((cp) => cp.priceDeltaPercent > 15).map((cp) => {
        const arc = d().products.find((p) => p.id === cp.arcelikEquivalentId);
        return { ...cp, arcelikName: arc?.name ?? "" };
      });
      const items = advantages.slice(0, 5).map((a) => {
        const arcPrice = fmt(d().products.find((p) => p.id === a.arcelikEquivalentId)?.tsfPrice ?? 0);
        return lang === "en"
          ? `• ${a.brand} ${a.competitorModel}: ₺${fmt(a.competitorPrice)} vs Arçelik ₺${arcPrice} (${a.priceDeltaPercent}% gap)`
          : `• ${a.brand} ${a.competitorModel}: ₺${fmt(a.competitorPrice)} vs Arçelik ₺${arcPrice} (%${a.priceDeltaPercent} fark)`;
      }).join("\n");
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Arçelik has a clear price advantage in ${advantages.length} products/segments (competitor 15%+ more expensive):\n${items}\n\nA premium positioning opportunity exists in these segments.`
          : `Arçelik'in belirgin fiyat avantajı olan ${advantages.length} ürün/segment var (rakip %15+ daha pahalı):\n${items}\n\nBu segmentlerde premium konumlandırma fırsatı var.`,
      };
    },
  },
  {
    patterns: [/zayıf.*şehir/i, /düşük.*pay.*şehir/i, /kaybet/i, /nerede.*zayıf/i, /weak.*cit/i, /losing/i, /where.*weak/i],
    handler: (lang) => {
      const weak = [...d().cities].sort((a, b) => a.marketSharePercent - b.marketSharePercent).slice(0, 5);
      const list = weak.map((c, i) => lang === "en"
        ? `${i + 1}. ${getCityName(c, lang)} — ${c.marketSharePercent}% (Index: ${c.avgPriceIndex})`
        : `${i + 1}. ${getCityName(c, lang)} — %${c.marketSharePercent} (Endeks: ${c.avgPriceIndex})`).join("\n");
      return {
        agent: "analyst",
        type: "list",
        text: lang === "en"
          ? `Bottom 5 cities by market share:\n${list}\n\nRegional campaigns and dealer empowerment recommended for these d().cities.`
          : `En düşük pazar payına sahip 5 şehir:\n${list}\n\nBu şehirlerde bölgesel kampanya ve bayi güçlendirme önerilir.`,
      };
    },
  },
  {
    patterns: [/klima/i, /air.?con/i],
    handler: (lang) => {
      const klimaProducts = d().products.filter((p) => p.category === "klima");
      const klimaComp = d().competitorPrices.filter((cp) => cp.category === "klima");
      const min = fmt(Math.min(...klimaProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...klimaProducts.map((p) => p.tsfPrice)));
      const margin = (klimaProducts.reduce((s, p) => s + p.marginPercent, 0) / klimaProducts.length).toFixed(1);
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Air conditioner segment report:\n• ${klimaProducts.length} product portfolio\n• Price range: ₺${min} – ₺${max}\n• Average margin: ${margin}%\n• ${klimaComp.length} competitor prices tracked\n• Seasonal peak: May–September`
          : `Klima segmenti raporu:\n• ${klimaProducts.length} ürün portföyü\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Ortalama marj: %${margin}\n• ${klimaComp.length} rakip fiyat takibi\n• Sezonsal pik: Mayıs–Eylül`,
      };
    },
  },
  {
    patterns: [/buzdolab/i, /fridge/i, /refrigerator/i],
    handler: (lang) => {
      const buzProducts = d().products.filter((p) => p.category === "buzdolabi");
      const min = fmt(Math.min(...buzProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...buzProducts.map((p) => p.tsfPrice)));
      const margin = (buzProducts.reduce((s, p) => s + p.marginPercent, 0) / buzProducts.length).toFixed(1);
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Refrigerator segment:\n• ${buzProducts.length} models\n• Price range: ₺${min} – ₺${max}\n• Average margin: ${margin}%\n• Market share: 41.2% (target: 43.0%)\n• Strongest sub-segment: No-Frost`
          : `Buzdolabı segmenti:\n• ${buzProducts.length} model\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Ortalama marj: %${margin}\n• Pazar payı: %41.2 (hedef: %43.0)\n• En güçlü alt segment: No-Frost`,
      };
    },
  },
  {
    patterns: [/çamaşır/i, /washing/i, /washer/i],
    handler: (lang) => {
      const camProducts = d().products.filter((p) => p.category === "camasir");
      const min = fmt(Math.min(...camProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...camProducts.map((p) => p.tsfPrice)));
      const margin = (camProducts.reduce((s, p) => s + p.marginPercent, 0) / camProducts.length).toFixed(1);
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Washing machine segment:\n• ${camProducts.length} models\n• Price range: ₺${min} – ₺${max}\n• Average margin: ${margin}%\n• Market share: 38.5% (target: 41.0%)`
          : `Çamaşır makinesi segmenti:\n• ${camProducts.length} model\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Ortalama marj: %${margin}\n• Pazar payı: %38.5 (hedef: %41.0)`,
      };
    },
  },
  {
    patterns: [/bulaşık/i, /dishwash/i],
    handler: (lang) => {
      const bulProducts = d().products.filter((p) => p.category === "bulasik");
      const min = fmt(Math.min(...bulProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...bulProducts.map((p) => p.tsfPrice)));
      const margin = (bulProducts.reduce((s, p) => s + p.marginPercent, 0) / bulProducts.length).toFixed(1);
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Dishwasher segment:\n• ${bulProducts.length} models\n• Price range: ₺${min} – ₺${max}\n• Average margin: ${margin}%\n• Inverter models are gaining popularity`
          : `Bulaşık makinesi segmenti:\n• ${bulProducts.length} model\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Ortalama marj: %${margin}\n• İnverter modeller giderek popülerleşiyor`,
      };
    },
  },
  {
    patterns: [/kampanya.*roi/i, /roi/i, /geri dönüş/i, /return on investment/i],
    handler: (lang) => ({
      agent: "campaign-mgr",
      type: "metric",
      text: lang === "en"
        ? "Average campaign ROI is 3.2x (target: 4.0x). Highest ROI: Trade-in campaign (margin impact +0.2%). Lowest ROI: Dealer-Exclusive Regional (margin impact -1.5%)."
        : "Kampanya ROI ortalaması 3.2x (hedef: 4.0x). En yüksek ROI: Eski-Yeni Değişim kampanyası (marj etkisi +0.2%). En düşük ROI: Bayi Özel Bölgesel (marj etkisi -1.5%).",
      data: { value: "3.2x", target: "4.0x" },
    }),
  },
  {
    patterns: [/haftalık.*özet/i, /weekly/i, /genel.*durum/i, /özet/i, /summary/i, /overview/i],
    handler: (lang) => {
      const aboveTarget = d().dealers.filter((d) => d.currentProgress / d.monthlySalesTarget > 0.7).length;
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Weekly Summary:\n\n📊 Market: National share 39.8%, +0.2pp last week\n💰 Revenue: 80% of monthly target completed\n🏷️ Pricing: Competitor price index 1.00 (stable)\n📢 Campaign: 3 active campaigns; Ramadan campaign with highest impact\n🏪 Dealers: ${aboveTarget}/${d().dealers.length} dealers above 70% of target\n⚠️ Watch: Vestel targeting market share via aggressive pricing`
          : `Haftalık Özet:\n\n📊 Pazar: Ulusal pay %39.8, son haftada +0.2pp\n💰 Gelir: Aylık hedefin %80'i tamamlandı\n🏷️ Fiyat: Rakip fiyat endeksi 1.00 (stabil)\n📢 Kampanya: 3 aktif kampanya, Ramazan kampanyası en yüksek etki\n🏪 Bayi: ${aboveTarget}/${d().dealers.length} bayi hedefin %70'inin üzerinde\n⚠️ Dikkat: Vestel agresif fiyatlandırma ile pazar payı hedefliyor`,
      };
    },
  },
  {
    patterns: [/rakip.*fiyat.*analiz/i, /fiyat.*karşılaş/i, /karşılaştırma/i, /competitor.*price.*analysis/i, /price.*compar/i, /comparison/i],
    handler: (lang) => {
      const byBrand = COMPETITOR_BRANDS.map((b) => {
        const prices = d().competitorPrices.filter((cp) => cp.brand === b.name);
        const avg = prices.length ? prices.reduce((s, p) => s + p.priceDeltaPercent, 0) / prices.length : 0;
        return { name: b.name, count: prices.length, avgDelta: avg.toFixed(1), positioning: b.positioning };
      }).filter((b) => b.count > 0);
      const summary = byBrand.map((b) => lang === "en"
        ? `• ${b.name}: ${b.count} products, avg gap ${b.avgDelta}% (${b.positioning})`
        : `• ${b.name}: ${b.count} ürün, ort. fark %${b.avgDelta} (${b.positioning})`).join("\n");
      return {
        agent: "analyst",
        type: "table",
        text: lang === "en"
          ? `Competitor price analysis summary:\n${summary}`
          : `Rakip fiyat analizi özeti:\n${summary}`,
        data: {
          headers: lang === "en"
            ? ["Brand", "Products", "Avg. Gap", "Position"]
            : ["Marka", "Ürün Sayısı", "Ort. Fark", "Konum"],
          rows: byBrand.map((b) => [b.name, b.count.toString(), `${lang === "en" ? "" : "%"}${b.avgDelta}${lang === "en" ? "%" : ""}`, b.positioning]),
        },
      };
    },
  },
  {
    patterns: [/fiyat.*artır/i, /artış.*yap/i, /zam/i, /fiyat.*yükselt/i, /price.*increase/i, /raise.*price/i, /hike/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "analysis",
      text: lang === "en"
        ? `Price increase analysis:\n\n✅ Suitable segments for an increase:\n• Side-by-Side refrigerator: 28% cheaper than Bosch — premium margin headroom\n• Premium washer (10kg+): Only 4% gap vs Siemens\n• OLED TV: 11% cheaper than Grundig QLED\n\n⚠️ Segments to watch:\n• Economy refrigerator: Vestel/Regal aggressive\n• Entry-level washer: Regal 21% cheaper\n• 9000 BTU AC: Regal 24% cheaper\n\n📊 You can run a detailed "what-if" analysis in the Simulator.`
        : `Fiyat artışı analizi:\n\n✅ Artış uygun segmentler:\n• Side-by-Side buzdolabı: Bosch'tan %28 ucuz, premium marj potansiyeli var\n• Premium çamaşır (10kg+): Siemens ile fark sadece %4\n• OLED TV: Grundig QLED'den %11 ucuz\n\n⚠️ Dikkatli olunması gereken segmentler:\n• Ekonomik buzdolabı: Vestel/Regal agresif\n• Giriş seviye çamaşır: Regal %21 daha ucuz\n• 9000 BTU klima: Regal %24 daha ucuz\n\n📊 Simülatörde detaylı "what-if" analizi yapabilirsiniz.`,
    }),
  },
  {
    patterns: [/enerji/i, /a\+\+\+/i, /verimli/i, /energy/i, /efficient/i],
    handler: (lang) => {
      const aPlusPlus = d().products.filter((p) => p.energyClass === "A+++" || p.energyClass === "A++");
      const aPlusPlusPlus = d().products.filter((p) => p.energyClass === "A+++").length;
      const aPP = d().products.filter((p) => p.energyClass === "A++").length;
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Energy-efficient product portfolio:\n• A+++ products: ${aPlusPlusPlus}\n• A++ products: ${aPP}\n• Total efficient (A++ and above): ${aPlusPlus.length}/${d().products.length}\n• In this segment, an energy-efficiency campaign with a 12% extra discount + ÖTV (excise) advantage can be offered.\n• Estimated impact: Market share +0.5%, Revenue +₺15M`
          : `Enerji verimli ürün portföyü:\n• A+++ ürün: ${aPlusPlusPlus}\n• A++ ürün: ${aPP}\n• Toplam verimli (A++ ve üzeri): ${aPlusPlus.length}/${d().products.length}\n• Bu segmentte enerji verimliliği kampanyası ile %12 ek indirim + ÖTV avantajı sunulabilir.\n• Tahmini etki: Pazar payı +0.5%, Gelir +₺15M`,
      };
    },
  },
  {
    patterns: [/sezon/i, /mevsim/i, /yaz/i, /kış/i, /season/i, /summer/i, /winter/i],
    handler: (lang) => ({
      agent: "campaign-mgr",
      type: "analysis",
      text: lang === "en"
        ? "Seasonal calendar overview:\n\n🌸 Q1 (Jan–Mar): Ramadan campaign, hotel renewal purchases\n☀️ Q2 (Apr–Jun): Wedding season starts, AC demand rises\n🔥 Q3 (Jul–Sep): Wedding peak, back-to-school, AC peak\n❄️ Q4 (Oct–Dec): New Year campaign, energy efficiency week\n\nYou can view a detailed Gantt in the Promo Calendar."
        : "Sezonsal takvim özeti:\n\n🌸 Q1 (Oca–Mar): Ramazan kampanyası, otel yenileme alımları\n☀️ Q2 (Nis–Haz): Düğün sezonu başlangıcı, klima talebi artışı\n🔥 Q3 (Tem–Eyl): Düğün pik, okula dönüş, klima zirve\n❄️ Q4 (Eki–Ara): Yılbaşı kampanyası, enerji verimliliği haftası\n\nPromosyon takviminden detaylı Gantt görünümüne bakabilirsiniz.",
    }),
  },
  {
    patterns: [/\btv\b/i, /televizyon/i, /elektronik/i, /television/i, /electronic/i],
    handler: (lang) => {
      const tvProducts = d().products.filter((p) => p.category === "tv-elektronik");
      const min = fmt(Math.min(...tvProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...tvProducts.map((p) => p.tsfPrice)));
      const margin = (tvProducts.reduce((s, p) => s + p.marginPercent, 0) / tvProducts.length).toFixed(1);
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `TV & Electronics segment:\n• ${tvProducts.length} models (LED, 4K, OLED, QLED)\n• Price range: ₺${min} – ₺${max}\n• Average margin: ${margin}%\n• Vestel pricing aggressively (-17% gap)\n• Growth potential in OLED/QLED premium segment`
          : `TV & Elektronik segmenti:\n• ${tvProducts.length} model (LED, 4K, OLED, QLED)\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Ortalama marj: %${margin}\n• Vestel agresif fiyatlandırma yapıyor (-%17 fark)\n• OLED/QLED premium segmentte büyüme potansiyeli var`,
      };
    },
  },
  {
    patterns: [/küçük ev/i, /small appliance/i, /çay/i, /kahve/i, /süpürge/i, /coffee/i, /vacuum/i, /tea/i],
    handler: (lang) => {
      const kevProducts = d().products.filter((p) => p.category === "kucuk-ev");
      const min = fmt(Math.min(...kevProducts.map((p) => p.tsfPrice)));
      const max = fmt(Math.max(...kevProducts.map((p) => p.tsfPrice)));
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Small Appliances:\n• ${kevProducts.length} models\n• Highest-margin category: ~30% average\n• Price range: ₺${min} – ₺${max}\n• Robot vacuums and cordless vacuums are growing segments\n• High cross-sell potential`
          : `Küçük Ev Aletleri:\n• ${kevProducts.length} model\n• En yüksek marj kategorisi: %30 ortalama\n• Fiyat aralığı: ₺${min} – ₺${max}\n• Robot süpürge ve kablosuz süpürge büyüyen segmentler\n• Çapraz satış potansiyeli yüksek`,
      };
    },
  },
  {
    patterns: [/teşekkür/i, /sağ ol/i, /thanks/i, /thank you/i, /eyvallah/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "text",
      text: lang === "en"
        ? "You're welcome! I'm here whenever you have more questions. Have a great day! 🎯"
        : "Rica ederim! Başka bir sorunuz olursa her zaman buradayım. İyi çalışmalar! 🎯",
    }),
  },
  {
    patterns: [/yardım/i, /help/i, /ne yapabilir/i, /nasıl/i, /what.*can.*do/i, /how to/i],
    handler: (lang) => ({
      agent: "analyst",
      type: "text",
      text: lang === "en"
        ? "I can help you with:\n\n🤖 Agent Decisions: \"Pending agent decisions\", \"Status of playbooks?\"\n📊 Market analysis: \"What is our market share?\", \"Give me the weekly summary\"\n🏷️ Pricing: \"Vestel prices\", \"Should we raise prices?\"\n📍 Regional: \"Status in Istanbul\", \"Weak cities\"\n📢 Campaign: \"Suggest a campaign\", \"Ramadan campaign\"\n📦 Product: \"Top selling products\", \"Refrigerator segment\"\n🏪 Dealers: \"Dealer compliance\"\n\nYou can ask in Turkish or English."
        : "Size şu konularda yardımcı olabilirim:\n\n🤖 Ajan Kararları: \"Bekleyen ajan kararları\", \"Oyun planları ne durumda?\"\n📊 Pazar analizi: \"Pazar payımız kaç?\", \"Haftalık özet ver\"\n🏷️ Fiyat: \"Vestel fiyatları\", \"Fiyat artışı yapmalı mıyız?\"\n📍 Bölgesel: \"İstanbul'daki durum\", \"Zayıf şehirler\"\n📢 Kampanya: \"Kampanya öner\", \"Ramazan kampanyası\"\n📦 Ürün: \"En çok satan ürünler\", \"Buzdolabı segmenti\"\n🏪 Bayi: \"Bayi uyum oranı\"\n\nTürkçe veya İngilizce sorabilirsiniz.",
    }),
  },
  {
    patterns: [/kategori.*dağılım/i, /dağılım.*grafik/i, /pie.*chart/i, /pasta.*grafik/i, /category.*distribution/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const catCounts = (Object.entries(labels) as [ProductCategory, string][]).map(([cat, label]) => ({
        name: label,
        value: d().products.filter((p) => p.category === cat).length,
      }));
      return {
        agent: "analyst",
        type: "chart" as const,
        text: lang === "en" ? "Product portfolio distribution by category:" : "Ürün portföyünün kategori bazlı dağılımı:",
        data: { chartType: "pie", chartData: catCounts, label: lang === "en" ? "Product Count" : "Ürün Sayısı" },
      };
    },
  },
  {
    patterns: [/trend.*grafik/i, /fiyat.*trend/i, /aylık.*grafik/i, /line.*chart/i, /trend/i, /monthly.*chart/i],
    handler: (lang) => {
      const monthlyData = lang === "en"
        ? [
            { name: "Jan", value: 37.2 }, { name: "Feb", value: 37.8 }, { name: "Mar", value: 39.5 },
            { name: "Apr", value: 38.1 }, { name: "May", value: 39.2 },
          ]
        : [
            { name: "Oca", value: 37.2 }, { name: "Şub", value: 37.8 }, { name: "Mar", value: 39.5 },
            { name: "Nis", value: 38.1 }, { name: "May", value: 39.2 },
          ];
      return {
        agent: "analyst",
        type: "chart" as const,
        text: lang === "en" ? "Arçelik's market share trend over the last 5 months:" : "Arçelik'in son 5 aylık pazar payı trendi:",
        data: { chartType: "line", chartData: monthlyData, label: lang === "en" ? "Monthly Market Share (%)" : "Aylık Pazar Payı (%)" },
      };
    },
  },
  {
    patterns: [/marj.*grafik/i, /marj.*dağılım/i, /kategori.*marj.*grafik/i, /margin.*chart/i, /margin.*distribution/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const catMargins = (Object.entries(labels) as [ProductCategory, string][]).map(([cat, label]) => {
        const ps = d().products.filter((p) => p.category === cat);
        const avg = ps.length ? ps.reduce((s, p) => s + p.marginPercent, 0) / ps.length : 0;
        return { name: label, value: +avg.toFixed(1) };
      });
      return {
        agent: "analyst",
        type: "chart" as const,
        text: lang === "en" ? "Average gross margin by category:" : "Kategori bazlı ortalama brüt marj dağılımı:",
        data: { chartType: "bar", chartData: catMargins, label: lang === "en" ? "Average Margin (%)" : "Ortalama Marj (%)" },
      };
    },
  },
  {
    patterns: [/marka.*fiyat.*grafik/i, /fiyat.*grafik/i, /grafik.*göster/i, /chart/i, /brand.*price.*chart/i, /show.*chart/i],
    handler: (lang) => {
      const brandAvgs = COMPETITOR_BRANDS.map((b) => {
        const prices = d().competitorPrices.filter((cp) => cp.brand === b.name);
        const avg = prices.length ? prices.reduce((s, p) => s + p.priceDeltaPercent, 0) / prices.length : 0;
        return { name: b.name, value: +avg.toFixed(1) };
      }).filter((b) => b.value !== 0);
      return {
        agent: "analyst",
        type: "chart" as const,
        text: lang === "en"
          ? "Competitor brands' average price gap vs Arçelik (%):"
          : "Rakip markaların Arçelik'e göre ortalama fiyat farkı (%):",
        data: { chartType: "bar", chartData: brandAvgs, label: lang === "en" ? "Avg. Price Gap (%)" : "Ort. Fiyat Farkı (%)" },
      };
    },
  },
  {
    patterns: [/istanbul/i],
    handler: (lang) => {
      const ist = d().cities.find((c) => c.id === "istanbul")!;
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Istanbul report:\n• Market Share: ${ist.marketSharePercent}%\n• Price Index: ${ist.avgPriceIndex}\n• Dealer Count: ${ist.dealerCount}\n• Strong Competitors: ${ist.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Seasonal: ${getCitySeasonalPattern(ist, lang)}`
          : `İstanbul raporu:\n• Pazar Payı: %${ist.marketSharePercent}\n• Fiyat Endeksi: ${ist.avgPriceIndex}\n• Bayi Sayısı: ${ist.dealerCount}\n• Güçlü Rakipler: ${ist.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Sezonsal: ${ist.seasonalPattern}`,
      };
    },
  },
  {
    patterns: [/ankara/i],
    handler: (lang) => {
      const ank = d().cities.find((c) => c.id === "ankara")!;
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Ankara report:\n• Market Share: ${ank.marketSharePercent}%\n• Price Index: ${ank.avgPriceIndex}\n• Dealer Count: ${ank.dealerCount}\n• Strong Competitors: ${ank.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Seasonal: ${getCitySeasonalPattern(ank, lang)}`
          : `Ankara raporu:\n• Pazar Payı: %${ank.marketSharePercent}\n• Fiyat Endeksi: ${ank.avgPriceIndex}\n• Bayi Sayısı: ${ank.dealerCount}\n• Güçlü Rakipler: ${ank.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Sezonsal: ${ank.seasonalPattern}`,
      };
    },
  },
  {
    patterns: [/izmir/i],
    handler: (lang) => {
      const izm = d().cities.find((c) => c.id === "izmir")!;
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Izmir report:\n• Market Share: ${izm.marketSharePercent}%\n• Price Index: ${izm.avgPriceIndex}\n• Dealer Count: ${izm.dealerCount}\n• Strong Competitors: ${izm.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Seasonal: ${getCitySeasonalPattern(izm, lang)}`
          : `İzmir raporu:\n• Pazar Payı: %${izm.marketSharePercent}\n• Fiyat Endeksi: ${izm.avgPriceIndex}\n• Bayi Sayısı: ${izm.dealerCount}\n• Güçlü Rakipler: ${izm.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Sezonsal: ${izm.seasonalPattern}`,
      };
    },
  },
  {
    patterns: [/konya|kayseri|gaziantep|adana|bursa|antalya|mersin|diyarbak|samsun|trabzon|erzurum|van|malatya|eskişehir|denizli|manisa|tekirdağ/i],
    handler: (lang) => {
      const anatolia = d().cities.filter((c) => c.populationTier !== "tier-1");
      const avgShare = (anatolia.reduce((s, c) => s + c.marketSharePercent, 0) / anatolia.length).toFixed(1);
      const top3 = [...d().cities].sort((a, b) => b.marketSharePercent - a.marketSharePercent).slice(0, 3);
      const list = top3.map((c) => lang === "en" ? `${getCityName(c, lang)} (${c.marketSharePercent}%)` : `${getCityName(c, lang)} (%${c.marketSharePercent})`).join(", ");
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `For a city-specific report, click the city on the map. Overall Anatolia performance:\n• Average Market Share: ${avgShare}%\n• Our strongest cities: ${list}`
          : `Şehir bazlı detaylı rapor için haritadan şehre tıklayabilirsiniz. Genel Anadolu performansı:\n• Ortalama Pazar Payı: %${avgShare}\n• En güçlü olduğumuz şehirler: ${list}`,
      };
    },
  },
  {
    patterns: [/alt.?kategori/i, /subcategor/i, /hangi.*alt.*segment/i, /which.*sub/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const breakdown = (Object.entries(labels) as [ProductCategory, string][]).map(([cat, label]) => {
        const subs = Array.from(new Set(d().products.filter((p) => p.category === cat).map((p) => p.subcategory)));
        const subLabels = subs.map((s) => getSubcategoryLabel(s, lang)).join(", ");
        return `${label}: ${subLabels}`;
      }).join("\n");
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Subcategory breakdown across all categories:\n\n${breakdown}\n\nUse the subcategory filters in Price List or Simulator to drill down.`
          : `Tüm kategorilerdeki alt kategori dağılımı:\n\n${breakdown}\n\nDetay için Fiyat Listesi veya Simülatör'deki alt kategori filtrelerini kullanabilirsiniz.`,
      };
    },
  },
  {
    patterns: [/fiyat.?seg/i, /fiyat.?tier/i, /giriş.?sev/i, /premium.?ürün/i, /entry.?level/i, /price.?tier/i, /segment.*dağılım/i, /tier.*break/i],
    handler: (lang) => {
      const tiers: PriceTier[] = ["entry", "mid", "premium"];
      const tierBreakdown = tiers.map((tier) => {
        const ps = d().products.filter((p) => p.priceTier === tier);
        const avgPrice = ps.length ? Math.round(ps.reduce((s, p) => s + p.tsfPrice, 0) / ps.length) : 0;
        const avgMargin = ps.length ? (ps.reduce((s, p) => s + p.marginPercent, 0) / ps.length).toFixed(1) : "0";
        return lang === "en"
          ? `• ${getPriceTierLabel(tier, lang)}: ${ps.length} products, avg ₺${fmt(avgPrice)}, avg margin ${avgMargin}%`
          : `• ${getPriceTierLabel(tier, lang)}: ${ps.length} ürün, ort. ₺${fmt(avgPrice)}, ort. marj %${avgMargin}`;
      }).join("\n");
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Price tier distribution across ${d().products.length} products:\n\n${tierBreakdown}\n\nPremium products have higher margins and 3-year warranty. Use tier filters in the Price List to explore.`
          : `${d().products.length} ürün genelinde fiyat segmenti dağılımı:\n\n${tierBreakdown}\n\nPremium ürünler daha yüksek marj ve 3 yıl garantiye sahip. Fiyat Listesi'ndeki segment filtrelerini kullanarak keşfedebilirsiniz.`,
      };
    },
  },
  {
    patterns: [/özellik.*karşılaş/i, /ürün.*karşılaş/i, /feature.*compar/i, /product.*compar/i, /kapasite/i, /capacity/i, /garanti/i, /warranty/i, /akıllı.*özellik/i, /smart.*feature/i],
    handler: (lang) => {
      const labels = catLabels(lang);
      const catSpecs = (Object.entries(labels) as [ProductCategory, string][]).map(([cat, label]) => {
        const ps = d().products.filter((p) => p.category === cat);
        const smartCount = ps.filter((p) => getProductSpecs(p).smartFeatures.length > 0).length;
        const premiumCount = ps.filter((p) => p.priceTier === "premium").length;
        const capacities = ps.map((p) => getProductSpecs(p).capacity).filter((c) => c !== "-");
        const numericCaps = capacities.map((c) => parseFloat(c)).filter((n) => !isNaN(n));
        const capacityRange = numericCaps.length > 0 ? `${Math.min(...numericCaps)}–${Math.max(...numericCaps)}` : (capacities.length > 0 ? capacities[0] : "-");
        return lang === "en"
          ? `• ${label}: ${ps.length} models, ${smartCount} smart, ${premiumCount} premium, capacity range: ${capacityRange}`
          : `• ${label}: ${ps.length} model, ${smartCount} akıllı, ${premiumCount} premium, kapasite aralığı: ${capacityRange}`;
      }).join("\n");
      return {
        agent: "analyst",
        type: "analysis",
        text: lang === "en"
          ? `Product feature comparison overview:\n\n${catSpecs}\n\n📊 Premium products: 3-year warranty, smart connectivity (Wi-Fi/HomeWhiz)\n📊 Mid-range: 2-year warranty, select smart features\n📊 Entry-level: 2-year warranty, essential features`
          : `Ürün özellik karşılaştırma özeti:\n\n${catSpecs}\n\n📊 Premium ürünler: 3 yıl garanti, akıllı bağlantı (Wi-Fi/HomeWhiz)\n📊 Orta segment: 2 yıl garanti, seçili akıllı özellikler\n📊 Giriş seviye: 2 yıl garanti, temel özellikler`,
      };
    },
  },
];

const FALLBACK = (lang: DemoLang): ChatResponse => ({
  agent: "analyst",
  type: "text",
  text: lang === "en"
    ? "I don't have a detailed analysis on that yet. I can help with: market share, competitor pricing, campaign suggestions, city-based reports, product analyses. Please ask a more specific question."
    : "Bu konuda henüz detaylı analizim yok. Şu konularda yardımcı olabilirim: pazar payı, rakip fiyatları, kampanya önerileri, şehir bazlı raporlar, ürün analizleri. Lütfen daha spesifik bir soru sorun.",
});

export function matchIntent(input: string, lang: DemoLang = "tr"): ChatResponse {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(input)) {
        return intent.handler(lang);
      }
    }
  }
  return FALLBACK(lang);
}
