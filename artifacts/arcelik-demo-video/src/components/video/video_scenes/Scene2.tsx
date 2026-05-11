import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 3200),  // BI dims
      setTimeout(() => setPhase(3), 5200),  // Email dims
      setTimeout(() => setPhase(4), 7200),  // PPT dims
      setTimeout(() => setPhase(5), 9000),  // gap diagram in
      setTimeout(() => setPhase(6), 12500), // closing line
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center p-12"
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute top-12 text-center w-full z-20">
        <motion.h2
          initial={{ opacity: 0, filter: 'blur(8px)' }}
          animate={phase >= 1 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(8px)' }}
          transition={{ duration: 0.7 }}
          className="text-[3.2vw] font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Eski yöntemler artık çalışmıyor.
        </motion.h2>
      </div>

      <div className="flex gap-8 w-full max-w-6xl mt-32 relative z-10">
        {/* BI */}
        <motion.div
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[34vh]"
          initial={{ opacity: 0, y: 30 }}
          animate={
            phase >= 2 ? { opacity: 0.2, scale: 0.95, filter: 'grayscale(100%)' } :
            phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
          }
          transition={{ duration: 0.8 }}
        >
          <div className="w-16 h-16 rounded bg-blue-500/20 mb-4" />
          <div className="w-3/4 h-2 bg-white/20 rounded mb-2" />
          <div className="w-1/2 h-2 bg-white/20 rounded mb-8" />
          <p className="text-[#F5A623] font-medium text-sm">BI: Sadece geçmişi gösterir</p>
        </motion.div>

        {/* Email */}
        <motion.div
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[34vh]"
          initial={{ opacity: 0, y: 30 }}
          animate={
            phase >= 3 ? { opacity: 0.2, scale: 0.95, filter: 'grayscale(100%)' } :
            phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
          }
          transition={{ duration: 0.8, delay: 0.15 }}
        >
          <div className="text-left w-full mb-8">
            <div className="text-xs text-white/40 mb-1">Kimden: Bölge Müdürü</div>
            <div className="text-sm font-bold mb-4">RE: RE: FW: Vestel fiyat indirimi?</div>
            <div className="w-full h-1 bg-white/10 rounded mb-1" />
            <div className="w-5/6 h-1 bg-white/10 rounded" />
          </div>
          <p className="text-[#F5A623] font-medium text-sm">E-posta: Çok yavaş</p>
        </motion.div>

        {/* PPT */}
        <motion.div
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[34vh]"
          initial={{ opacity: 0, y: 30 }}
          animate={
            phase >= 4 ? { opacity: 0.2, scale: 0.95, filter: 'grayscale(100%)' } :
            phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
          }
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          <div className="w-full h-32 bg-white/10 rounded-lg mb-4 flex items-center justify-center">
            <span className="text-xs text-white/30">Kampanya_Plan_v4_FINAL.pptx</span>
          </div>
          <p className="text-[#F5A623] font-medium text-sm">Sunumlar: Aksiyona dönüşmez</p>
        </motion.div>
      </div>

      {/* Gap diagram fills the lower band once cards dim */}
      <motion.div
        className="absolute bottom-12 left-1/2 -translate-x-1/2 w-full max-w-4xl bg-white/[0.04] border border-white/10 rounded-2xl px-8 py-6 backdrop-blur-sm z-20"
        initial={{ opacity: 0, y: 30 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration: 0.8 }}
      >
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-[#F5A623]/15 border border-[#F5A623]/40 shrink-0">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#F5A623]" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="text-sm uppercase tracking-widest text-slate-400 mb-3 font-semibold">
              Pazarlama hızı vs. ekip hızı
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="w-32 text-sm text-slate-300 shrink-0">Rakip fiyat değişimi</span>
                <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[#ef4444] rounded-full"
                    initial={{ width: 0 }}
                    animate={phase >= 5 ? { width: '92%' } : { width: 0 }}
                    transition={{ duration: 1.2, delay: 0.2, ease: 'easeOut' }}
                  />
                </div>
                <span className="text-sm font-semibold text-[#ef4444] w-16 text-right">~2 saat</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-32 text-sm text-slate-300 shrink-0">Bayi yanıt süresi</span>
                <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={phase >= 5 ? { width: '22%' } : { width: 0 }}
                    transition={{ duration: 1.2, delay: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-400 w-16 text-right">~5 gün</span>
              </div>
            </div>
          </div>
        </div>

        <motion.p
          className="text-lg text-slate-300 leading-relaxed mt-5 text-center"
          initial={{ opacity: 0 }}
          animate={phase >= 6 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.7 }}
        >
          Fiyatlandırma döngüsü artık ekipten daha hızlı.{' '}
          <span className="text-white font-bold">Marj da işte tam o boşluktan sızıyor.</span>
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
