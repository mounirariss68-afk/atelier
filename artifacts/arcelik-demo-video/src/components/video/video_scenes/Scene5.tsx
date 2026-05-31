import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import marketplaceImg from '@assets/arcelik/marketplace.jpg';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0B1B2E]">
      <div className="absolute inset-0 opacity-[0.35]">
        <img src={marketplaceImg} alt="" className="w-full h-full object-cover filter blur-xl" />
      </div>
      {/* Cognirise amber radial highlight behind lockup */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(245,166,35,0.22), transparent 60%)' }}
      />
      <div className="absolute inset-0 bg-[#0B1B2E]/40" />

      <div className="relative z-10 text-center flex flex-col items-center px-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8"
        >
          <div className="text-[#F5A623] font-bold tracking-widest uppercase text-sm mb-4">
            Arçelik Fiyat İstihbaratı
          </div>
          <div className="text-[4.4vw] font-bold text-white leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Döngü nihayet pazarın <br />hızında hareket ettiğinde.
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.7 }}
          className="mt-8 pt-8 border-t border-white/15 flex flex-col items-center gap-4"
        >
          <div className="text-2xl font-bold tracking-tight text-white flex items-center">
            <span className="w-9 h-9 rounded bg-[#F5A623] inline-block mr-3" />
            COGNIRISE
          </div>
          <div className="text-slate-300 text-base">
            MENAT işletmeleri için ajan zekası · cognirise.com
          </div>
        </motion.div>

        {/* Stat strip */}
        <motion.div
          className="mt-10 flex items-center gap-6 bg-white/[0.06] border border-white/15 rounded-full px-8 py-4 backdrop-blur-sm"
          initial={{ opacity: 0, y: 16 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.7 }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[#F5A623] font-bold text-lg">5 gün → 2 saat</span>
          </div>
          <span className="text-white/30">·</span>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">3.000 bayi</span>
          </div>
          <span className="text-white/30">·</span>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">20 şehir</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
