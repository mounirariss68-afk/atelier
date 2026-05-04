import { Fragment, useState } from "react";
import { motion } from "framer-motion";
import { Package, AlertTriangle, CheckCircle2, XCircle, ShoppingCart, Truck, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { CATEGORY_LABELS, getCategoryLabel, getProductName, type ProductCategory } from "@/data/arcelik-seed";
import { useToast } from "@/hooks/use-toast";
import { useDemoLang } from "../DemoLangContext";
import { stock } from "../demo-i18n";
import { useArcelikData } from "@/hooks/useArcelikData";

const fmt = (n: number) => n.toLocaleString("tr-TR");
const OPTIMAL: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };

type StockStatus = "ok" | "low" | "out";
function getStatus(level: number, optimal: number): StockStatus {
  if (level <= 0) return "out";
  if (level < optimal) return "low";
  return "ok";
}

function pseudoStock(productId: string, catLevel: number, catOptimal: number, catProductCount: number): number {
  let hash = 0;
  for (let i = 0; i < productId.length; i++) hash = ((hash << 5) - hash + productId.charCodeAt(i)) | 0;
  const share = (Math.abs(hash) % 40 + 10) / 100;
  return Math.max(0, Math.round(catLevel * share * (catProductCount / 3)));
}

function pseudoOptimal(productId: string, catOptimal: number, catProductCount: number): number {
  let hash = 0;
  for (let i = 0; i < productId.length; i++) hash = ((hash << 5) - hash + productId.charCodeAt(i) * 7) | 0;
  const share = (Math.abs(hash) % 30 + 15) / 100;
  return Math.max(1, Math.round(catOptimal * share * (catProductCount / 3)));
}

interface CategoryRow {
  cat: ProductCategory;
  level: number;
  optimal: number;
  status: StockStatus;
  productRows: ProductRow[];
}

interface ProductRow {
  id: string;
  modelCode: string;
  name: string;
  stock: number;
  optimal: number;
  status: StockStatus;
}

function buildCategoryRows(DEALER: { stockLevels: Record<string, number | undefined> } | undefined, allProducts: { id: string; modelCode: string; name: string; category: string }[]): CategoryRow[] {
  if (!DEALER) return [];
  return (Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((cat) => {
    const catLevel = DEALER.stockLevels[cat] ?? 0;
    const catOptimal = OPTIMAL[cat] ?? 10;
    const catProducts = allProducts.filter((p) => p.category === cat);
    const productRows: ProductRow[] = catProducts.map((p) => {
      const s = pseudoStock(p.id, catLevel, catOptimal, catProducts.length);
      const opt = pseudoOptimal(p.id, catOptimal, catProducts.length);
      return { id: p.id, modelCode: p.modelCode, name: p.name, stock: s, optimal: opt, status: getStatus(s, opt) };
    }).sort((a, b) => {
      const order: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };
      return order[a.status] - order[b.status];
    });
    return { cat, level: catLevel, optimal: catOptimal, status: getStatus(catLevel, catOptimal), productRows };
  }).sort((a, b) => {
    const order: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };
    return order[a.status] - order[b.status];
  });
}

interface Order {
  id: string;
  dateKey: string;
  itemsKey: string;
  quantity: number;
  total: number;
  statusKey: string;
  deliveryKey: string;
  step: number;
}

const ORDERS: Order[] = [
  { id: "SIP-2026-0501", dateKey: "order1Date", itemsKey: "order1Items", quantity: 5, total: 97950, statusKey: "statusPreparing", deliveryKey: "order1Delivery", step: 1 },
  { id: "SIP-2026-0487", dateKey: "order2Date", itemsKey: "order2Items", quantity: 5, total: 115950, statusKey: "statusInTransitShort", deliveryKey: "order2Delivery", step: 3 },
  { id: "SIP-2026-0462", dateKey: "order3Date", itemsKey: "order3Items", quantity: 14, total: 102860, statusKey: "statusDeliveredShort", deliveryKey: "order3Delivery", step: 4 },
];

function OrderStepper({ currentStep, steps }: { currentStep: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-1 mt-2">
      {steps.map((label, i) => {
        const done = i + 1 <= currentStep;
        const active = i + 1 === currentStep;
        return (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
              done ? "bg-[#E30613] text-white" : "bg-gray-200 text-gray-400"
            } ${active ? "ring-2 ring-[#E30613]/30" : ""}`}>
              {done ? "✓" : i + 1}
            </div>
            <span className={`text-[9px] whitespace-nowrap ${done ? "text-[#0E2841] font-semibold" : "text-gray-400"}`}>{label}</span>
            {i < steps.length - 1 && <div className={`flex-1 h-px ${done ? "bg-[#E30613]" : "bg-gray-200"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default function StockOrdersView() {
  const { toast } = useToast();
  const { lang } = useDemoLang();
  const t = stock[lang];
  const { dealers, products } = useArcelikData();
  const DEALER = dealers[0];
  const categoryRows = buildCategoryRows(DEALER, products);
  const [tab, setTab] = useState<"stock" | "orders">("stock");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const STATUS_ICON: Record<StockStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
    ok: { icon: CheckCircle2, color: "text-green-500", label: t.statusSufficient },
    low: { icon: AlertTriangle, color: "text-amber-500", label: t.statusLow },
    out: { icon: XCircle, color: "text-red-500", label: t.statusOutOfStock },
  };

  const STEPS = [t.stepReceived, t.stepLeftWarehouse, t.stepInTransit, t.stepDelivered];

  const toggleExpand = (cat: string) => {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(cat)) next.delete(cat); else next.add(cat); return next; });
  };

  const handleOrder = (label: string) => {
    toast({ title: t.toastOrderCreated, description: `${label}` });
  };

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">{t.title}</h1>

      <div className="flex gap-2">
        <button onClick={() => setTab("stock")} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === "stock" ? "bg-[#E30613] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
          <Package size={14} className="inline mr-1.5" />{t.tabStock}
        </button>
        <button onClick={() => setTab("orders")} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === "orders" ? "bg-[#E30613] text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
          <Truck size={14} className="inline mr-1.5" />{t.tabOrders}
        </button>
      </div>

      {tab === "stock" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500">{t.colProduct}</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500">{t.colCurrentStock}</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500">{t.colOptimum}</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500">{t.colStatus}</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500">{t.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => {
                const si = STATUS_ICON[row.status];
                const Icon = si.icon;
                const isExpanded = expanded.has(row.cat);
                const label = getCategoryLabel(row.cat, lang);
                return (
                  <Fragment key={row.cat}>
                    <tr className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50/50 ${row.status === "low" ? "bg-amber-50/30" : row.status === "out" ? "bg-red-50/30" : ""}`} onClick={() => toggleExpand(row.cat)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                          <div>
                            <p className="text-xs font-semibold">{label}</p>
                            <p className="text-[10px] text-gray-400">{row.productRows.length} {t.model}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-bold ${row.status === "ok" ? "text-green-600" : row.status === "low" ? "text-amber-600" : "text-red-600"}`}>{row.level}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{row.optimal}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${si.color}`}>
                          <Icon size={13} />{si.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.status !== "ok" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOrder(label); }}
                            className="px-3 py-1.5 text-[11px] font-semibold text-white bg-[#E30613] rounded-lg hover:bg-[#C00511] transition-colors"
                          >
                            <ShoppingCart size={11} className="inline mr-1" />{t.placeOrder}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && row.productRows.map((pr) => {
                      const pri = STATUS_ICON[pr.status];
                      const PrIcon = pri.icon;
                      return (
                        <tr key={pr.id} className="border-b border-gray-50/50 bg-gray-50/20">
                          <td className="pl-10 pr-4 py-2">
                            <p className="text-[11px] font-medium text-gray-700">{pr.modelCode}</p>
                            <p className="text-[9px] text-gray-400 truncate max-w-[200px]">{getProductName(products.find(x => x.id === pr.id)!, lang)}</p>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className={`text-xs font-bold ${pr.status === "ok" ? "text-green-600" : pr.status === "low" ? "text-amber-600" : "text-red-600"}`}>{pr.stock}</span>
                          </td>
                          <td className="px-4 py-2 text-center text-[11px] text-gray-400">{pr.optimal}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${pri.color}`}>
                              <PrIcon size={11} />{pri.label}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            {pr.status !== "ok" && (
                              <button
                                onClick={() => handleOrder(pr.modelCode)}
                                className="px-2 py-1 text-[10px] font-semibold text-[#E30613] border border-[#E30613] rounded hover:bg-[#E30613] hover:text-white transition-colors"
                              >
                                {t.order}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}

      {tab === "orders" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {ORDERS.map((order) => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs font-bold text-[#0E2841]">{order.id}</p>
                  <p className="text-[11px] text-gray-400">{t[order.dateKey]}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">₺{fmt(order.total)}</p>
                  <p className="text-[10px] text-gray-400">{order.quantity} {t.units}</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 mb-2">{t[order.itemsKey]}</p>
              <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
                <Clock size={12} />
                <span>{t.estimatedDelivery} {t[order.deliveryKey]}</span>
              </div>
              <OrderStepper currentStep={order.step} steps={STEPS} />
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
