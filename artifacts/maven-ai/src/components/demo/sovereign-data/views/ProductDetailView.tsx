import { FileText, ShieldCheck, Database, Ban } from "lucide-react";
import { useSdsLang, useSdsT } from "../DemoLangContext";
import { productDetail, catalogue } from "../sovereign-i18n";
import { useSdsData } from "@/hooks/useSovereignDataData";
import { classificationColor, statusColor, fmtFreshness, ACTIVE_LINEAGE_NODES, DOMAIN_LABEL } from "@/data/sovereign-data-seed";
import { BRAND, BRAND_INK } from "../tokens";

export default function ProductDetailView() {
  const { lang } = useSdsLang();
  const t = useSdsT();
  const isAr = lang === "ar";
  const { products, selectedProductId, setSelectedProductId } = useSdsData();
  const product = products.find((p) => p.id === selectedProductId) ?? products[0];

  const sources = ACTIVE_LINEAGE_NODES.filter((n) => n.kind === "source");
  const transforms = ACTIVE_LINEAGE_NODES.filter((n) => n.kind === "transform");
  const sinks = ACTIVE_LINEAGE_NODES.filter((n) => n.kind === "sink");
  const isActiveProduct = product.id === "citizen-sentiment-dashboard";

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{product.name[lang]}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{DOMAIN_LABEL[product.domain][lang]} · {product.ownerOrg[lang]}</p>
        </div>
        <select
          value={product.id}
          onChange={(e) => setSelectedProductId(e.target.value)}
          className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
        >
          {products.map((p) => (<option key={p.id} value={p.id}>{p.name[lang]}</option>))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label={t("statusLabel", productDetail)} value={t(`status${product.status.charAt(0).toUpperCase()}${product.status.slice(1)}`, catalogue)} tone={statusColor(product.status)} />
        <Tile label={t("classLabel", productDetail)} value={t(`class${product.classification.charAt(0).toUpperCase()}${product.classification.slice(1)}`, catalogue)} tone={classificationColor(product.classification)} />
        <Tile label={t("ownerLabel", productDetail)} value={product.owner[lang]} tone={BRAND_INK} small />
        <Tile label={t("freshLabel", productDetail)} value={fmtFreshness(product.freshnessMin, lang)} tone="#5B7CFF" />
        <Tile label="PDPL" value={`${product.pdplPass}/${product.pdplTotal}`} tone="#8A5BD6" />
      </div>

      {/* Quality contract */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={14} style={{ color: BRAND }} />
          <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("contractTitle", productDetail)}</h2>
        </div>
        <p className="text-xs text-gray-500 mb-3">{t("contractSub", productDetail)}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
          <KV k={t("contractRefresh", productDetail)} v={product.contractRefresh[lang]} />
          <KV k={t("contractCompleteness", productDetail)} v={product.contractCompleteness} />
          <KV k={t("contractLatency", productDetail)} v={product.contractLatency[lang]} />
          <KV k={t("contractClassification", productDetail)} v={t(`class${product.classification.charAt(0).toUpperCase()}${product.classification.slice(1)}`, catalogue)} />
          <KV k={t("contractRetention", productDetail)} v={product.contractRetention[lang]} />
          <KV k={t("contractResidency", productDetail)} v={product.residency} />
          <KV k={t("contractOwner", productDetail)} v={`${product.owner[lang]} · ${product.ownerOrg[lang]}`} />
        </div>
      </section>

      {/* Sources & schema (active product only — full detail) */}
      {isActiveProduct && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Database size={14} style={{ color: BRAND }} />
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("sourcesTitle", productDetail)}</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">{t("sourcesSub", productDetail)}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sources.map((s) => (
              <div key={s.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{s.label[lang]}</p>
                {s.classification && (
                  <p className="text-[10px] mt-0.5" style={{ color: classificationColor(s.classification) }}>
                    {t(`class${s.classification.charAt(0).toUpperCase()}${s.classification.slice(1)}`, catalogue)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* DAG */}
      {isActiveProduct && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("dagTitle", productDetail)}</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">{t("dagSub", productDetail)}</p>
          <ol className="space-y-1.5 text-[12px] text-gray-700">
            {transforms.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: BRAND }}>{i + 1}</span>
                <span>{t.label[lang]}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Blocked sinks */}
      {isActiveProduct && sinks.some((s) => s.blocked) && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Ban size={14} className="text-red-600" />
            <h2 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("blockedTitle", productDetail)}</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">{t("blockedSub", productDetail)}</p>
          <div className="space-y-2">
            {sinks.filter((s) => s.blocked).map((s) => (
              <div key={s.id} className="bg-red-50 border border-red-200 rounded-xl p-3 text-[12px] text-red-900">
                <p className="font-bold mb-0.5">{s.label[lang]}</p>
                {s.blockedReason && <p className="text-[11px]">{s.blockedReason[lang]}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {!isActiveProduct && (
        <section className="bg-white border border-gray-200 rounded-2xl p-5 text-xs text-gray-500">
          <ShieldCheck size={14} className="inline me-1" style={{ color: BRAND }} />
          {lang === "ar"
            ? "لقطة مختصرة لهذا المنتج. للمنتج النشط (لوحة مشاعر المواطنين) تظهر النسب الكاملة والمصبّات المحجوبة."
            : "Summary view for this product. The active scenario product (Citizen Sentiment Dashboard) shows the full lineage and blocked sinks."}
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, tone, small }: { label: string; value: string; tone: string; small?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-extrabold mt-0.5 ${small ? "text-[12px]" : "text-lg"}`} style={{ color: tone }}>{value}</p>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{k}</p>
      <p className="text-[12px] text-gray-800 mt-0.5">{v}</p>
    </div>
  );
}
