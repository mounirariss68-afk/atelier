import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import dealerImg from '../../../../../attached_assets/arcelik/dealer.jpg';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Agents pulse
      setTimeout(() => setPhase(2), 6000), // Campaign studio
      setTimeout(() => setPhase(3), 12000), // Dealer portal
      setTimeout(() => setPhase(4), 18000), // Final callouts
      setTimeout(() => setPhase(5), 23000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const agents = [
    "Fiyat İzleme Ajanı",
    "Talep Tahmincisi",
    "Rekabet Analisti",
    "Kampanya Stratejisti",
    "Bayi Yöneticisi",
    "Fiyatlama Orkestratörü"
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B1B2E]"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 1 }}
    >
      
      {/* Agents Cockpit (Phase 1) */}
      <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-4 p-20 z-10">
        {agents.map((agent, i) => (
          <motion.div
            key={agent}
            className="bg-[#0E2841] border border-[#1E3A8A] rounded-xl p-6 w-[30%] shadow-lg flex items-center gap-4"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={
              phase === 1 ? { opacity: 1, scale: 1, borderColor: '#F5A623' } :
              phase > 1 ? { opacity: 0, scale: 0.9, pointerEvents: 'none' } : 
              { opacity: 0, scale: 0.8 }
            }
            transition={{ 
              duration: 0.5, 
              delay: phase === 1 ? i * 0.3 : 0,
              borderColor: { duration: 1, repeat: Infinity, repeatType: 'reverse' }
            }}
          >
            <div className="w-3 h-3 rounded-full bg-[#F5A623] animate-pulse" />
            <h4 className="text-white font-medium">{agent}</h4>
          </motion.div>
        ))}
      </div>

      {/* Campaign Studio (Phase 2) */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center z-20"
        initial={{ opacity: 0, y: 50 }}
        animate={phase === 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50, pointerEvents: 'none' }}
        transition={{ duration: 0.8 }}
      >
        <div className="bg-[#0E2841] border border-white/20 rounded-2xl p-10 w-3/4 max-w-4xl shadow-2xl">
          <h3 className="text-[#F5A623] text-xl font-bold mb-8">Kampanya Stratejisti: Tavsiye Edilen Yanıt</h3>
          
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-white/5 p-4 rounded-lg">
              <span className="text-lg font-bold text-white">İstanbul</span>
              <span className="text-[#E30613] font-bold">Fiyatı Eşitle (-7%)</span>
            </div>
            <div className="flex items-center justify-between bg-white/5 p-4 rounded-lg">
              <span className="text-lg font-bold text-white">Konya</span>
              <span className="text-green-400 font-bold">Fiyatı Koru (Marjı Koru)</span>
            </div>
            <div className="flex items-center justify-between bg-white/5 p-4 rounded-lg">
              <span className="text-lg font-bold text-white">Antalya</span>
              <span className="text-blue-400 font-bold">Paket Satış Yap (Turizm Sezonu)</span>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <div className="bg-[#F5A623] text-[#0B1B2E] px-8 py-3 rounded-lg font-bold">
              Tek Tıkla Onayla
            </div>
          </div>
        </div>
      </motion.div>

      {/* Dealer Portal Screenshot (Phase 3 & 4) */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center z-30 bg-[#0B1B2E]"
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0, pointerEvents: 'none' }}
        transition={{ duration: 1 }}
      >
        <motion.div
          className="relative w-[90%] h-[85%] rounded-3xl overflow-hidden border-[8px] border-[#1E3A8A]"
          initial={{ scale: 0.8, y: 50 }}
          animate={phase >= 3 ? { scale: 1, y: 0 } : { scale: 0.8, y: 50 }}
          transition={{ type: "spring", damping: 25 }}
        >
          <img src={dealerImg} alt="Dealer Portal" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40" />

          {/* Callouts over Dealer Portal */}
          <motion.div
            className="absolute top-[20%] left-[10%] bg-white text-[#0B1B2E] p-4 rounded-xl font-bold shadow-2xl flex items-center gap-3"
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ delay: 1 }}
          >
            <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center text-white">WA</div>
            Yeni fiyat listesi 3,000 bayiye itildi
          </motion.div>

          <motion.div
            className="absolute bottom-[30%] right-[10%] bg-[#E30613] text-white p-4 rounded-xl font-bold shadow-2xl"
            initial={{ opacity: 0, x: 50 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
            transition={{ delay: 1.5 }}
          >
            POS kreatifleri anında güncellendi
          </motion.div>

          {/* Final Summary Overlay (Phase 4) */}
          <motion.div
            className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[80%] bg-[#0B1B2E]/90 backdrop-blur-md border border-[#F5A623] p-6 rounded-2xl flex justify-around text-center"
            initial={{ opacity: 0, y: 50 }}
            animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ duration: 0.8 }}
          >
            <div>
              <div className="text-sm text-slate-400">Haftalık Döngü</div>
              <div className="text-2xl font-bold text-white">5 Gün → &lt; 2 Saat</div>
            </div>
            <div className="w-px bg-white/20" />
            <div>
              <div className="text-sm text-slate-400">Tavsiyeler</div>
              <div className="text-2xl font-bold text-white">Bölgesel ve Gerçek Zamanlı</div>
            </div>
            <div className="w-px bg-white/20" />
            <div>
              <div className="text-sm text-slate-400">Kontrol</div>
              <div className="text-2xl font-bold text-[#F5A623]">İnsanda</div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>

    </motion.div>
  );
}
