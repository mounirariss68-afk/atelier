import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Bell, Tag, DollarSign, GraduationCap, Megaphone, Settings, Eye, EyeOff } from "lucide-react";
import { useDemoLang } from "../DemoLangContext";
import { announcements as announcementsI18n } from "../demo-i18n";

type AnnouncementCategoryKey =
  | "catNewProduct"
  | "catPriceUpdate"
  | "catTraining"
  | "catCampaignNews"
  | "catPolicyChange";

interface AnnouncementSeed {
  id: number;
  categoryKey: AnnouncementCategoryKey;
  categoryColor: string;
  titleKey: string;
  bodyKey: string;
  dateObj: Date;
  read: boolean;
}

const ANNOUNCEMENT_SEEDS: AnnouncementSeed[] = [
  { id: 1, categoryKey: "catNewProduct",   categoryColor: "#7c3aed", titleKey: "ann1Title", bodyKey: "ann1Body", dateObj: new Date(2026, 4, 2),  read: false },
  { id: 2, categoryKey: "catPriceUpdate",  categoryColor: "#E30613", titleKey: "ann2Title", bodyKey: "ann2Body", dateObj: new Date(2026, 4, 1),  read: false },
  { id: 3, categoryKey: "catTraining",     categoryColor: "#0891b2", titleKey: "ann3Title", bodyKey: "ann3Body", dateObj: new Date(2026, 3, 30), read: true  },
  { id: 4, categoryKey: "catCampaignNews", categoryColor: "#16a34a", titleKey: "ann4Title", bodyKey: "ann4Body", dateObj: new Date(2026, 3, 28), read: true  },
  { id: 5, categoryKey: "catPolicyChange", categoryColor: "#d97706", titleKey: "ann5Title", bodyKey: "ann5Body", dateObj: new Date(2026, 3, 25), read: true  },
  { id: 6, categoryKey: "catNewProduct",   categoryColor: "#7c3aed", titleKey: "ann6Title", bodyKey: "ann6Body", dateObj: new Date(2026, 3, 22), read: true  },
  { id: 7, categoryKey: "catTraining",     categoryColor: "#0891b2", titleKey: "ann7Title", bodyKey: "ann7Body", dateObj: new Date(2026, 3, 20), read: true  },
  { id: 8, categoryKey: "catCampaignNews", categoryColor: "#16a34a", titleKey: "ann8Title", bodyKey: "ann8Body", dateObj: new Date(2026, 3, 18), read: true  },
];

function formatAnnouncementDate(d: Date, lang: "tr" | "en"): string {
  return d.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "long", year: "numeric" });
}

const CATEGORY_ICONS: Record<AnnouncementCategoryKey, typeof Bell> = {
  catNewProduct: Tag,
  catPriceUpdate: DollarSign,
  catTraining: GraduationCap,
  catCampaignNews: Megaphone,
  catPolicyChange: Settings,
};

export default function AnnouncementsView() {
  const { lang } = useDemoLang();
  const t = announcementsI18n[lang];

  const [readMap, setReadMap] = useState<Record<number, boolean>>(() => {
    const m: Record<number, boolean> = {};
    ANNOUNCEMENT_SEEDS.forEach((a) => { m[a.id] = a.read; });
    return m;
  });
  const [filter, setFilter] = useState<AnnouncementCategoryKey | null>(null);

  const toggleRead = (id: number) => {
    setReadMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const announcements = useMemo(
    () => ANNOUNCEMENT_SEEDS.map((a) => ({
      ...a,
      read: readMap[a.id],
      title: t[a.titleKey] ?? a.titleKey,
      body: t[a.bodyKey] ?? a.bodyKey,
      categoryLabel: t[a.categoryKey] ?? a.categoryKey,
      date: formatAnnouncementDate(a.dateObj, lang),
    })),
    [readMap, t, lang],
  );

  const categoryKeys: AnnouncementCategoryKey[] = useMemo(
    () => Array.from(new Set(ANNOUNCEMENT_SEEDS.map((a) => a.categoryKey))),
    [],
  );
  const filtered = filter ? announcements.filter((a) => a.categoryKey === filter) : announcements;
  const unreadCount = announcements.filter((a) => !a.read).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">{t.title}</h1>
          {unreadCount > 0 && <p className="text-xs text-[#E30613] font-semibold">{unreadCount} {t.unreadCount}</p>}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilter(null)}
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${!filter ? "bg-[#0A1230] text-white" : "bg-white text-gray-600 border border-gray-200"}`}
          >
            {t.all}
          </button>
          {categoryKeys.map((catKey) => (
            <button
              key={catKey}
              onClick={() => setFilter(catKey)}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${filter === catKey ? "bg-[#0A1230] text-white" : "bg-white text-gray-600 border border-gray-200"}`}
            >
              {t[catKey] ?? catKey}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((a, i) => {
          const CatIcon = CATEGORY_ICONS[a.categoryKey] || Bell;
          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`bg-white rounded-xl border shadow-sm p-5 transition-colors ${a.read ? "border-gray-100" : "border-[#E30613]/20 bg-red-50/20"}`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${a.read ? "bg-gray-300" : "bg-[#E30613]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white flex items-center gap-1" style={{ backgroundColor: a.categoryColor }}>
                      <CatIcon size={9} />{a.categoryLabel}
                    </span>
                    <span className="text-[10px] text-gray-400">{a.date}</span>
                    {!a.read && <span className="text-[9px] font-bold text-[#E30613] bg-red-50 px-1.5 py-0.5 rounded">{t.newBadge}</span>}
                  </div>
                  <h3 className="text-sm font-bold mb-1">{a.title}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{a.body}</p>
                </div>
                <button
                  onClick={() => toggleRead(a.id)}
                  className="text-gray-400 hover:text-[#0A1230] p-1 flex-shrink-0"
                  title={a.read ? t.markUnread : t.markRead}
                >
                  {a.read ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
