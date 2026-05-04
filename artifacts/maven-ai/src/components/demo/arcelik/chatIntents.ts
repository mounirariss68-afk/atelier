import {
  products, competitorPrices, cities, campaigns, dealers,
  kpiBenchmarks, CATEGORY_LABELS, COMPETITOR_BRANDS,
  type ProductCategory,
} from "@/data/arcelik-seed";

export type ResponseType = "text" | "metric" | "table" | "list" | "campaign-card" | "analysis";

export interface ChatResponse {
  agent: "analyst" | "campaign-mgr";
  text: string;
  type: ResponseType;
  data?: Record<string, unknown>;
}

interface Intent {
  patterns: RegExp[];
  handler: () => ChatResponse;
}

const fmt = (n: number) => n.toLocaleString("tr-TR");

const INTENTS: Intent[] = [
  {
    patterns: [/merhaba/i, /selam/i, /hey/i, /günaydın/i, /iyi günler/i],
    handler: () => ({
      agent: "analyst",
      type: "text",
      text: "Merhaba! Arçelik Fiyat İstihbarat Platformu'na hoş geldiniz. Size pazar analizi, rakip fiyatlandırma, kampanya önerisi veya bölgesel raporlar konusunda yardımcı olabilirim. Ne sormak istersiniz?",
    }),
  },
  {
    patterns: [/pazar pay/i, /market share/i, /payımız kaç/i, /pay.*ne/i],
    handler: () => ({
      agent: "analyst",
      type: "metric",
      text: "Arçelik'in ulusal pazar payı şu anda %39.8 seviyesinde. Hedefimiz %42.0'ye ulaşmak. Son dönemde +0.8 puanlık artış yaşandı.",
      data: { value: "39.8%", target: "42.0%", delta: "+0.8pp", trend: "up" },
    }),
  },
  {
    patterns: [/marj/i, /margin/i, /brüt/i, /kâr.*oran/i],
    handler: () => ({
      agent: "analyst",
      type: "metric",
      text: `Ortalama brüt marj: %21.8 (hedef: %22.5). Kategori bazlı: ${Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
        const ps = products.filter((p) => p.category === cat);
        const avg = ps.length ? (ps.reduce((s, p) => s + p.marginPercent, 0) / ps.length).toFixed(1) : "0";
        return `${label}: %${avg}`;
      }).join(", ")}`,
      data: { value: "21.8%", target: "22.5%", delta: "-0.3pp", trend: "down" },
    }),
  },
  {
    patterns: [/en çok sat/i, /best.?sell/i, /popüler ürün/i, /en iyi ürün/i],
    handler: () => {
      const top5 = [...products].sort((a, b) => b.tsfPrice * (100 - a.marginPercent) - a.tsfPrice * (100 - b.marginPercent)).slice(0, 5);
      return {
        agent: "analyst",
        type: "list",
        text: `En yüksek gelir potansiyeline sahip 5 ürün:\n${top5.map((p, i) => `${i + 1}. ${p.name} — ₺${fmt(p.tsfPrice)} (marj: %${p.marginPercent})`).join("\n")}`,
      };
    },
  },
  {
    patterns: [/vestel.*fiyat/i, /vestel.*ne/i, /vestel.*son/i],
    handler: () => {
      const vestelPrices = competitorPrices.filter((cp) => cp.brand === "Vestel");
      return {
        agent: "analyst",
        type: "table",
        text: `Vestel'in ${vestelPrices.length} ürün fiyatı takip ediliyor. Ortalama fiyat farkı: %${(vestelPrices.reduce((s, p) => s + p.priceDeltaPercent, 0) / vestelPrices.length).toFixed(1)} (Arçelik'e göre).`,
        data: {
          headers: ["Model", "Kategori", "Fiyat", "Fark"],
          rows: vestelPrices.map((p) => [p.competitorModel, CATEGORY_LABELS[p.category], `₺${fmt(p.competitorPrice)}`, `${p.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/bosch.*fiyat/i, /bosch.*karşı/i, /bosch.*ne/i],
    handler: () => {
      const boschPrices = competitorPrices.filter((cp) => cp.brand === "Bosch");
      return {
        agent: "analyst",
        type: "table",
        text: `Bosch premium segmentte konumlanıyor. ${boschPrices.length} üründe ortalama %${(boschPrices.reduce((s, p) => s + p.priceDeltaPercent, 0) / boschPrices.length).toFixed(0)} daha pahalılar.`,
        data: {
          headers: ["Model", "Kategori", "Fiyat", "Fark"],
          rows: boschPrices.map((p) => [p.competitorModel, CATEGORY_LABELS[p.category], `₺${fmt(p.competitorPrice)}`, `+${p.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/samsung/i],
    handler: () => {
      const samsungPrices = competitorPrices.filter((cp) => cp.brand === "Samsung");
      return {
        agent: "analyst",
        type: "table",
        text: `Samsung ${samsungPrices.length} kategoride takip ediliyor. Premium konumlandırma ile Arçelik'e göre ortalama %${(samsungPrices.reduce((s, p) => s + p.priceDeltaPercent, 0) / (samsungPrices.length || 1)).toFixed(0)} fark var.`,
        data: {
          headers: ["Model", "Kategori", "Fiyat", "Fark"],
          rows: samsungPrices.map((p) => [p.competitorModel, CATEGORY_LABELS[p.category], `₺${fmt(p.competitorPrice)}`, `${p.priceDeltaPercent > 0 ? "+" : ""}${p.priceDeltaPercent}%`]),
        },
      };
    },
  },
  {
    patterns: [/istanbul/i],
    handler: () => {
      const ist = cities.find((c) => c.id === "istanbul")!;
      return {
        agent: "analyst",
        type: "analysis",
        text: `İstanbul raporu:\n• Pazar Payı: %${ist.marketSharePercent}\n• Fiyat Endeksi: ${ist.avgPriceIndex}\n• Bayi Sayısı: ${ist.dealerCount}\n• Güçlü Rakipler: ${ist.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Sezonsal: ${ist.seasonalPattern}`,
      };
    },
  },
  {
    patterns: [/ankara/i],
    handler: () => {
      const ank = cities.find((c) => c.id === "ankara")!;
      return {
        agent: "analyst",
        type: "analysis",
        text: `Ankara raporu:\n• Pazar Payı: %${ank.marketSharePercent}\n• Fiyat Endeksi: ${ank.avgPriceIndex}\n• Bayi Sayısı: ${ank.dealerCount}\n• Güçlü Rakipler: ${ank.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Sezonsal: ${ank.seasonalPattern}`,
      };
    },
  },
  {
    patterns: [/izmir/i],
    handler: () => {
      const izm = cities.find((c) => c.id === "izmir")!;
      return {
        agent: "analyst",
        type: "analysis",
        text: `İzmir raporu:\n• Pazar Payı: %${izm.marketSharePercent}\n• Fiyat Endeksi: ${izm.avgPriceIndex}\n• Bayi Sayısı: ${izm.dealerCount}\n• Güçlü Rakipler: ${izm.competitorStrength.map((c) => `${c.brand} (${c.strength}/10)`).join(", ")}\n• Sezonsal: ${izm.seasonalPattern}`,
      };
    },
  },
  {
    patterns: [/konya|kayseri|gaziantep|adana|bursa|antalya|mersin|diyarbak|samsun|trabzon|erzurum|van|malatya|eskişehir|denizli|manisa|tekirdağ/i],
    handler: () => {
      return {
        agent: "analyst",
        type: "analysis",
        text: `Şehir bazlı detaylı rapor için haritadan şehre tıklayabilirsiniz. Genel Anadolu performansı:\n• Ortalama Pazar Payı: %${(cities.filter((c) => c.populationTier !== "tier-1").reduce((s, c) => s + c.marketSharePercent, 0) / cities.filter((c) => c.populationTier !== "tier-1").length).toFixed(1)}\n• En güçlü olduğumuz şehirler: ${cities.sort((a, b) => b.marketSharePercent - a.marketSharePercent).slice(0, 3).map((c) => `${c.name} (%${c.marketSharePercent})`).join(", ")}`,
      };
    },
  },
  {
    patterns: [/kampanya.*öner/i, /yeni kampanya/i, /campaign.*suggest/i, /ne kampanya/i],
    handler: () => {
      const c = campaigns[Math.floor(Math.random() * campaigns.length)];
      return {
        agent: "campaign-mgr",
        type: "campaign-card",
        text: `AI kampanya önerisi: "${c.name}"\n\n🎯 Hedef: ${c.targetSegment}\n📍 Şehirler: ${c.targetCities.map((id) => cities.find((ct) => ct.id === id)?.name).filter(Boolean).join(", ")}\n💰 İndirim: ${c.discountDetail}\n📈 Tahmini etki: Pazar payı ${c.projectedImpact.marketShareLift}, Gelir ${c.projectedImpact.revenueDelta}`,
        data: { campaignId: c.id, name: c.name },
      };
    },
  },
  {
    patterns: [/ramazan/i, /bayram.*kampanya/i],
    handler: () => {
      const c = campaigns.find((c) => c.id === "ramazan")!;
      return {
        agent: "campaign-mgr",
        type: "campaign-card",
        text: `Ramazan Bayramı Kampanyası detayları:\n\n📋 ${c.headline}\n📝 ${c.bodyCopy}\n🎯 ${c.targetSegment}\n💰 ${c.discountDetail}\n📈 Etki: Pazar payı ${c.projectedImpact.marketShareLift}, Gelir ${c.projectedImpact.revenueDelta}, Marj ${c.projectedImpact.marginEffect}`,
        data: { campaignId: c.id },
      };
    },
  },
  {
    patterns: [/düğün/i, /çeyiz/i],
    handler: () => {
      const c = campaigns.find((c) => c.id === "dugun-sezonu")!;
      return {
        agent: "campaign-mgr",
        type: "campaign-card",
        text: `Düğün Sezonu Çeyiz Paketi:\n\n📋 ${c.headline}\n🎯 ${c.targetSegment}\n💰 ${c.discountDetail}\n📈 Tahmini etki: Pazar payı ${c.projectedImpact.marketShareLift}, Gelir ${c.projectedImpact.revenueDelta}\n📍 Hedef şehirler: ${c.targetCities.map((id) => cities.find((ct) => ct.id === id)?.name).filter(Boolean).join(", ")}`,
        data: { campaignId: c.id },
      };
    },
  },
  {
    patterns: [/kaç ürün/i, /ürün sayısı/i, /toplam ürün/i],
    handler: () => ({
      agent: "analyst",
      type: "metric",
      text: `Toplam ${products.length} ürün takip ediliyor. Kategori bazlı dağılım: ${Object.entries(CATEGORY_LABELS).map(([cat, label]) => `${label}: ${products.filter((p) => p.category === cat).length}`).join(", ")}`,
      data: { value: products.length.toString(), label: "Toplam Ürün" },
    }),
  },
  {
    patterns: [/bayi.*uyum/i, /compliance/i, /bayi.*durum/i, /bayi.*skor/i],
    handler: () => {
      const avg = dealers.reduce((s, d) => s + d.complianceScore, 0) / dealers.length;
      const gold = dealers.filter((d) => d.tier === "gold").length;
      const silver = dealers.filter((d) => d.tier === "silver").length;
      const bronze = dealers.filter((d) => d.tier === "bronze").length;
      return {
        agent: "analyst",
        type: "analysis",
        text: `Bayi uyum durumu:\n• Ortalama skor: ${avg.toFixed(1)}/100 (hedef: 85)\n• Gold: ${gold}, Silver: ${silver}, Bronze: ${bronze}\n• En yüksek: ${dealers.sort((a, b) => b.complianceScore - a.complianceScore)[0].storeName} (${dealers.sort((a, b) => b.complianceScore - a.complianceScore)[0].complianceScore})\n• En düşük: ${dealers.sort((a, b) => a.complianceScore - b.complianceScore)[0].storeName} (${dealers.sort((a, b) => a.complianceScore - b.complianceScore)[0].complianceScore})`,
      };
    },
  },
  {
    patterns: [/düşük marj/i, /en düşük.*marj/i, /marj.*düşük/i, /zayıf marj/i],
    handler: () => {
      const sorted = [...products].sort((a, b) => a.marginPercent - b.marginPercent).slice(0, 5);
      return {
        agent: "analyst",
        type: "list",
        text: `En düşük marjlı 5 ürün:\n${sorted.map((p, i) => `${i + 1}. ${p.name} — %${p.marginPercent} marj (₺${fmt(p.tsfPrice)})`).join("\n")}\n\n⚠️ Bu ürünlerde fiyat optimizasyonu değerlendirilebilir.`,
      };
    },
  },
  {
    patterns: [/en rekabet/i, /avantaj/i, /güçlü.*ürün/i, /biz.*nerede.*iyi/i],
    handler: () => {
      const advantages = competitorPrices.filter((cp) => cp.priceDeltaPercent > 15).map((cp) => {
        const arc = products.find((p) => p.id === cp.arcelikEquivalentId);
        return { ...cp, arcelikName: arc?.name ?? "" };
      });
      return {
        agent: "analyst",
        type: "analysis",
        text: `Arçelik'in belirgin fiyat avantajı olan ${advantages.length} ürün/segment var (rakip %15+ daha pahalı):\n${advantages.slice(0, 5).map((a) => `• ${a.brand} ${a.competitorModel}: ₺${fmt(a.competitorPrice)} vs Arçelik ₺${fmt(products.find((p) => p.id === a.arcelikEquivalentId)?.tsfPrice ?? 0)} (%${a.priceDeltaPercent} fark)`).join("\n")}\n\nBu segmentlerde premium konumlandırma fırsatı var.`,
      };
    },
  },
  {
    patterns: [/zayıf.*şehir/i, /düşük.*pay.*şehir/i, /kaybet/i, /nerede.*zayıf/i],
    handler: () => {
      const weak = [...cities].sort((a, b) => a.marketSharePercent - b.marketSharePercent).slice(0, 5);
      return {
        agent: "analyst",
        type: "list",
        text: `En düşük pazar payına sahip 5 şehir:\n${weak.map((c, i) => `${i + 1}. ${c.name} — %${c.marketSharePercent} (Endeks: ${c.avgPriceIndex})`).join("\n")}\n\nBu şehirlerde bölgesel kampanya ve bayi güçlendirme önerilir.`,
      };
    },
  },
  {
    patterns: [/klima/i],
    handler: () => {
      const klimaProducts = products.filter((p) => p.category === "klima");
      const klimaComp = competitorPrices.filter((cp) => cp.category === "klima");
      return {
        agent: "analyst",
        type: "analysis",
        text: `Klima segmenti raporu:\n• ${klimaProducts.length} ürün portföyü\n• Fiyat aralığı: ₺${fmt(Math.min(...klimaProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...klimaProducts.map((p) => p.tsfPrice)))}\n• Ortalama marj: %${(klimaProducts.reduce((s, p) => s + p.marginPercent, 0) / klimaProducts.length).toFixed(1)}\n• ${klimaComp.length} rakip fiyat takibi\n• Sezonsal pik: Mayıs–Eylül`,
      };
    },
  },
  {
    patterns: [/buzdolab/i, /fridge/i],
    handler: () => {
      const buzProducts = products.filter((p) => p.category === "buzdolabi");
      return {
        agent: "analyst",
        type: "analysis",
        text: `Buzdolabı segmenti:\n• ${buzProducts.length} model\n• Fiyat aralığı: ₺${fmt(Math.min(...buzProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...buzProducts.map((p) => p.tsfPrice)))}\n• Ortalama marj: %${(buzProducts.reduce((s, p) => s + p.marginPercent, 0) / buzProducts.length).toFixed(1)}\n• Pazar payı: %41.2 (hedef: %43.0)\n• En güçlü alt segment: No-Frost`,
      };
    },
  },
  {
    patterns: [/çamaşır/i, /washing/i],
    handler: () => {
      const camProducts = products.filter((p) => p.category === "camasir");
      return {
        agent: "analyst",
        type: "analysis",
        text: `Çamaşır makinesi segmenti:\n• ${camProducts.length} model\n• Fiyat aralığı: ₺${fmt(Math.min(...camProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...camProducts.map((p) => p.tsfPrice)))}\n• Ortalama marj: %${(camProducts.reduce((s, p) => s + p.marginPercent, 0) / camProducts.length).toFixed(1)}\n• Pazar payı: %38.5 (hedef: %41.0)`,
      };
    },
  },
  {
    patterns: [/bulaşık/i, /dishwash/i],
    handler: () => {
      const bulProducts = products.filter((p) => p.category === "bulasik");
      return {
        agent: "analyst",
        type: "analysis",
        text: `Bulaşık makinesi segmenti:\n• ${bulProducts.length} model\n• Fiyat aralığı: ₺${fmt(Math.min(...bulProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...bulProducts.map((p) => p.tsfPrice)))}\n• Ortalama marj: %${(bulProducts.reduce((s, p) => s + p.marginPercent, 0) / bulProducts.length).toFixed(1)}\n• İnverter modeller giderek popülerleşiyor`,
      };
    },
  },
  {
    patterns: [/kampanya.*roi/i, /roi/i, /geri dönüş/i],
    handler: () => ({
      agent: "campaign-mgr",
      type: "metric",
      text: "Kampanya ROI ortalaması 3.2x (hedef: 4.0x). En yüksek ROI: Eski-Yeni Değişim kampanyası (marj etkisi +0.2%). En düşük ROI: Bayi Özel Bölgesel (marj etkisi -1.5%).",
      data: { value: "3.2x", target: "4.0x" },
    }),
  },
  {
    patterns: [/haftalık.*özet/i, /weekly/i, /genel.*durum/i, /özet/i],
    handler: () => ({
      agent: "analyst",
      type: "analysis",
      text: `Haftalık Özet:\n\n📊 Pazar: Ulusal pay %39.8, son haftada +0.2pp\n💰 Gelir: Aylık hedefin %80'i tamamlandı\n🏷️ Fiyat: Rakip fiyat endeksi 1.00 (stabil)\n📢 Kampanya: 3 aktif kampanya, Ramazan kampanyası en yüksek etki\n🏪 Bayi: ${dealers.filter((d) => d.currentProgress / d.monthlySalesTarget > 0.7).length}/${dealers.length} bayi hedefin %70'inin üzerinde\n⚠️ Dikkat: Vestel agresif fiyatlandırma ile pazar payı hedefliyor`,
    }),
  },
  {
    patterns: [/rakip.*fiyat.*analiz/i, /fiyat.*karşılaş/i, /karşılaştırma/i],
    handler: () => {
      const byBrand = COMPETITOR_BRANDS.map((b) => {
        const prices = competitorPrices.filter((cp) => cp.brand === b.name);
        const avg = prices.length ? prices.reduce((s, p) => s + p.priceDeltaPercent, 0) / prices.length : 0;
        return { name: b.name, count: prices.length, avgDelta: avg.toFixed(1), positioning: b.positioning };
      }).filter((b) => b.count > 0);
      return {
        agent: "analyst",
        type: "table",
        text: `Rakip fiyat analizi özeti:\n${byBrand.map((b) => `• ${b.name}: ${b.count} ürün, ort. fark %${b.avgDelta} (${b.positioning})`).join("\n")}`,
        data: {
          headers: ["Marka", "Ürün Sayısı", "Ort. Fark", "Konum"],
          rows: byBrand.map((b) => [b.name, b.count.toString(), `%${b.avgDelta}`, b.positioning]),
        },
      };
    },
  },
  {
    patterns: [/fiyat.*artır/i, /artış.*yap/i, /zam/i, /fiyat.*yükselt/i],
    handler: () => ({
      agent: "analyst",
      type: "analysis",
      text: `Fiyat artışı analizi:\n\n✅ Artış uygun segmentler:\n• Side-by-Side buzdolabı: Bosch'tan %28 ucuz, premium marj potansiyeli var\n• Premium çamaşır (10kg+): Siemens ile fark sadece %4\n• OLED TV: Grundig QLED'den %11 ucuz\n\n⚠️ Dikkatli olunması gereken segmentler:\n• Ekonomik buzdolabı: Vestel/Regal agresif\n• Giriş seviye çamaşır: Regal %21 daha ucuz\n• 9000 BTU klima: Regal %24 daha ucuz\n\n📊 Simülatörde detaylı "what-if" analizi yapabilirsiniz.`,
    }),
  },
  {
    patterns: [/enerji/i, /a\+\+\+/i, /verimli/i],
    handler: () => {
      const aPlusPlus = products.filter((p) => p.energyClass === "A+++" || p.energyClass === "A++");
      return {
        agent: "analyst",
        type: "analysis",
        text: `Enerji verimli ürün portföyü:\n• A+++ ürün: ${products.filter((p) => p.energyClass === "A+++").length}\n• A++ ürün: ${products.filter((p) => p.energyClass === "A++").length}\n• Toplam verimli (A++ ve üzeri): ${aPlusPlus.length}/${products.length}\n• Bu segmentte enerji verimliliği kampanyası ile %12 ek indirim + ÖTV avantajı sunulabilir.\n• Tahmini etki: Pazar payı +0.5%, Gelir +₺15M`,
      };
    },
  },
  {
    patterns: [/sezon/i, /mevsim/i, /yaz/i, /kış/i],
    handler: () => ({
      agent: "campaign-mgr",
      type: "analysis",
      text: "Sezonsal takvim özeti:\n\n🌸 Q1 (Oca–Mar): Ramazan kampanyası, otel yenileme alımları\n☀️ Q2 (Nis–Haz): Düğün sezonu başlangıcı, klima talebi artışı\n🔥 Q3 (Tem–Eyl): Düğün pik, okula dönüş, klima zirve\n❄️ Q4 (Eki–Ara): Yılbaşı kampanyası, enerji verimliliği haftası\n\nPromosyon takviminden detaylı Gantt görünümüne bakabilirsiniz.",
    }),
  },
  {
    patterns: [/tv/i, /televizyon/i, /elektronik/i],
    handler: () => {
      const tvProducts = products.filter((p) => p.category === "tv-elektronik");
      return {
        agent: "analyst",
        type: "analysis",
        text: `TV & Elektronik segmenti:\n• ${tvProducts.length} model (LED, 4K, OLED, QLED)\n• Fiyat aralığı: ₺${fmt(Math.min(...tvProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...tvProducts.map((p) => p.tsfPrice)))}\n• Ortalama marj: %${(tvProducts.reduce((s, p) => s + p.marginPercent, 0) / tvProducts.length).toFixed(1)}\n• Vestel agresif fiyatlandırma yapıyor (-%17 fark)\n• OLED/QLED premium segmentte büyüme potansiyeli var`,
      };
    },
  },
  {
    patterns: [/küçük ev/i, /small appliance/i, /çay/i, /kahve/i, /süpürge/i],
    handler: () => {
      const kevProducts = products.filter((p) => p.category === "kucuk-ev");
      return {
        agent: "analyst",
        type: "analysis",
        text: `Küçük Ev Aletleri:\n• ${kevProducts.length} model\n• En yüksek marj kategorisi: %30 ortalama\n• Fiyat aralığı: ₺${fmt(Math.min(...kevProducts.map((p) => p.tsfPrice)))} – ₺${fmt(Math.max(...kevProducts.map((p) => p.tsfPrice)))}\n• Robot süpürge ve kablosuz süpürge büyüyen segmentler\n• Çapraz satış potansiyeli yüksek`,
      };
    },
  },
  {
    patterns: [/teşekkür/i, /sağ ol/i, /thanks/i, /eyvallah/i],
    handler: () => ({
      agent: "analyst",
      type: "text",
      text: "Rica ederim! Başka bir sorunuz olursa her zaman buradayım. İyi çalışmalar! 🎯",
    }),
  },
  {
    patterns: [/yardım/i, /help/i, /ne yapabilir/i, /nasıl/i],
    handler: () => ({
      agent: "analyst",
      type: "text",
      text: "Size şu konularda yardımcı olabilirim:\n\n📊 Pazar analizi: \"Pazar payımız kaç?\", \"Haftalık özet ver\"\n🏷️ Fiyat: \"Vestel fiyatları\", \"Fiyat artışı yapmalı mıyız?\"\n📍 Bölgesel: \"İstanbul'daki durum\", \"Zayıf şehirler\"\n📢 Kampanya: \"Kampanya öner\", \"Ramazan kampanyası\"\n📦 Ürün: \"En çok satan ürünler\", \"Buzdolabı segmenti\"\n🏪 Bayi: \"Bayi uyum oranı\"\n\nTürkçe veya İngilizce sorabilirsiniz.",
    }),
  },
];

const FALLBACK: ChatResponse = {
  agent: "analyst",
  type: "text",
  text: "Bu konuda henüz detaylı analizim yok. Şu konularda yardımcı olabilirim: pazar payı, rakip fiyatları, kampanya önerileri, şehir bazlı raporlar, ürün analizleri. Lütfen daha spesifik bir soru sorun.",
};

export function matchIntent(input: string): ChatResponse {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(input)) {
        return intent.handler();
      }
    }
  }
  return FALLBACK;
}
