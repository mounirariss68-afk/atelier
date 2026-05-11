import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000), // BI dims
      setTimeout(() => setPhase(3), 4000), // Email dims
      setTimeout(() => setPhase(4), 6000), // PPT dims
      setTimeout(() => setPhase(5), 8000), // Text changes
      setTimeout(() => setPhase(6), 23000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute top-12 text-center w-full z-20">
        <motion.h2
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 1 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.8 }}
          className="text-[3vw] font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Eski yöntemler artık çalışmıyor.
        </motion.h2>
      </div>

      <div className="flex gap-8 w-full max-w-6xl mt-20 relative z-10">
        {/* Legacy Tool 1: BI Dashboard */}
        <motion.div 
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[40vh]"
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

        {/* Legacy Tool 2: Email */}
        <motion.div 
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[40vh]"
          initial={{ opacity: 0, y: 30 }}
          animate={
            phase >= 3 ? { opacity: 0.2, scale: 0.95, filter: 'grayscale(100%)' } :
            phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
          }
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="text-left w-full mb-8">
            <div className="text-xs text-white/40 mb-1">Kimden: Bölge Müdürü</div>
            <div className="text-sm font-bold mb-4">RE: RE: FW: Vestel fiyat indirimi?</div>
            <div className="w-full h-1 bg-white/10 rounded mb-1" />
            <div className="w-5/6 h-1 bg-white/10 rounded" />
          </div>
          <p className="text-[#F5A623] font-medium text-sm">E-posta: Çok yavaş</p>
        </motion.div>

        {/* Legacy Tool 3: PPT */}
        <motion.div 
          className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[40vh]"
          initial={{ opacity: 0, y: 30 }}
          animate={
            phase >= 4 ? { opacity: 0.2, scale: 0.95, filter: 'grayscale(100%)' } :
            phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }
          }
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <div className="w-full h-32 bg-white/10 rounded-lg mb-4 flex items-center justify-center">
            <span className="text-xs text-white/30">Kampanya_Plan_v4_FINAL.pptx</span>
          </div>
          <p className="text-[#F5A623] font-medium text-sm">Sunumlar: Aksiyona dönüşmez</p>
        </motion.div>
      </div>

      <motion.div
        className="absolute bottom-20 text-center w-full max-w-3xl z-20"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.8 }}
      >
        <p className="text-2xl text-slate-300 leading-relaxed">
          Fiyatlama döngüsü artık onu yöneten ekiplerden daha hızlı. <br/>
          <span className="text-white font-bold">Ve marj kaybı tam da bu boşlukta yaşanıyor.</span>
        </p>
      </motion.div>

    </motion.div>
  );
}
