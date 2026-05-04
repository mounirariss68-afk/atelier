import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, Tag, DollarSign, GraduationCap, Megaphone, Settings, Eye, EyeOff } from "lucide-react";

interface Announcement {
  id: number;
  category: string;
  categoryColor: string;
  title: string;
  body: string;
  date: string;
  read: boolean;
}

const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 1, category: "Yeni Ürün", categoryColor: "#7c3aed",
    title: "Grundig Premium Klima G 12420 — Yeni Model Kataloğa Eklendi",
    body: "UV-C filtreli, A+++ enerji sınıfı Grundig Premium Klima modeli artık sipariş verilebilir durumda. TSF: ₺24.990. Premium tasarımı ile showroom'unuzda öne çıkarın.",
    date: "2 Mayıs 2026", read: false,
  },
  {
    id: 2, category: "Fiyat Güncellemesi", categoryColor: "#E30613",
    title: "Buzdolabı ve Çamaşır Makinesi Serilerinde Fiyat Güncellemesi",
    body: "5088 NFK, 5076 NFK buzdolabı ve 10143 D çamaşır makinesi modellerinde fiyat güncellemesi yapılmıştır. Yeni fiyatlar 1 Mayıs itibarıyla geçerlidir. Fiyat listesi bölümünden güncel fiyatları inceleyebilirsiniz.",
    date: "1 Mayıs 2026", read: false,
  },
  {
    id: 3, category: "Eğitim", categoryColor: "#0891b2",
    title: "Online Bayi Eğitimi: Yeni Enerji Verimliliği Mevzuatı",
    body: "8 Mayıs 2026, Perşembe, 14:00–15:30 arası online eğitim düzenlenecektir. Konu: AB enerji etiketleme değişiklikleri ve müşterilere doğru bilgilendirme. Katılım sertifikası verilecektir.",
    date: "30 Nisan 2026", read: true,
  },
  {
    id: 4, category: "Kampanya Haberi", categoryColor: "#16a34a",
    title: "Enerji Verimliliği Kampanyası Başladı — Bayi Materyalleri Hazır",
    body: "A+++ ürünlerde %12 ek indirim kampanyası başlamıştır. POS materyalleri, afiş görselleri ve SMS şablonları Kampanyalar bölümünde mevcuttur. Vitrinlerinizi güncellemeyi unutmayın.",
    date: "28 Nisan 2026", read: true,
  },
  {
    id: 5, category: "Politika Değişikliği", categoryColor: "#d97706",
    title: "Garanti Süresi Güncellemesi — Klima Kategorisi",
    body: "Tüm Arçelik ve Beko marka klimalarda garanti süresi 3 yıldan 5 yıla çıkarılmıştır. Bu değişiklik 1 Mayıs 2026 ve sonrası satışlar için geçerlidir. Müşterilerinize bu avantajı vurgulayın.",
    date: "25 Nisan 2026", read: true,
  },
  {
    id: 6, category: "Yeni Ürün", categoryColor: "#7c3aed",
    title: "Arçelik S 8960 Kablosuz Süpürge — Yeni Renk Seçenekleri",
    body: "S 8960 kablosuz süpürge modeli artık Gümüş Gri ve Bordo renk seçenekleriyle sipariş edilebilir. Yeni renkler aynı fiyat ve özelliklerle sunulmaktadır.",
    date: "22 Nisan 2026", read: true,
  },
  {
    id: 7, category: "Eğitim", categoryColor: "#0891b2",
    title: "Bölgesel Bayi Toplantısı — İstanbul, 15 Mayıs",
    body: "İstanbul bölgesi bayileri için yüz yüze toplantı düzenlenecektir. Yer: Arçelik Genel Merkezi, Sütlüce. Saat: 10:00–16:00. Konular: Q2 hedefleri, yeni ürün tanıtımları, başarı öyküleri paylaşımı.",
    date: "20 Nisan 2026", read: true,
  },
  {
    id: 8, category: "Kampanya Haberi", categoryColor: "#16a34a",
    title: "Banka Taksit Kampanyası Güncellendi — 24 Aya Kadar Faizsiz",
    body: "Ziraat, Halkbank ve Vakıfbank kartlarına 24 aya kadar faizsiz taksit kampanyası güncellenmiştir. POS cihazlarınızın güncel olduğundan emin olun. Teknik destek için 444 0 888'i arayabilirsiniz.",
    date: "18 Nisan 2026", read: true,
  },
];

const CATEGORY_ICONS: Record<string, typeof Bell> = {
  "Yeni Ürün": Tag,
  "Fiyat Güncellemesi": DollarSign,
  "Eğitim": GraduationCap,
  "Kampanya Haberi": Megaphone,
  "Politika Değişikliği": Settings,
};

export default function AnnouncementsView() {
  const [announcements, setAnnouncements] = useState(INITIAL_ANNOUNCEMENTS);
  const [filter, setFilter] = useState<string | null>(null);

  const toggleRead = (id: number) => {
    setAnnouncements((prev) => prev.map((a) => a.id === id ? { ...a, read: !a.read } : a));
  };

  const categories = [...new Set(INITIAL_ANNOUNCEMENTS.map((a) => a.category))];
  const filtered = filter ? announcements.filter((a) => a.category === filter) : announcements;
  const unreadCount = announcements.filter((a) => !a.read).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold">Duyurular</h1>
          {unreadCount > 0 && <p className="text-xs text-[#E30613] font-semibold">{unreadCount} okunmamış duyuru</p>}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFilter(null)}
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${!filter ? "bg-[#0E2841] text-white" : "bg-white text-gray-600 border border-gray-200"}`}
          >
            Tümü
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors ${filter === cat ? "bg-[#0E2841] text-white" : "bg-white text-gray-600 border border-gray-200"}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((a, i) => {
          const CatIcon = CATEGORY_ICONS[a.category] || Bell;
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
                      <CatIcon size={9} />{a.category}
                    </span>
                    <span className="text-[10px] text-gray-400">{a.date}</span>
                    {!a.read && <span className="text-[9px] font-bold text-[#E30613] bg-red-50 px-1.5 py-0.5 rounded">YENİ</span>}
                  </div>
                  <h3 className="text-sm font-bold mb-1">{a.title}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{a.body}</p>
                </div>
                <button
                  onClick={() => toggleRead(a.id)}
                  className="text-gray-400 hover:text-[#0E2841] p-1 flex-shrink-0"
                  title={a.read ? "Okunmadı olarak işaretle" : "Okundu olarak işaretle"}
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
