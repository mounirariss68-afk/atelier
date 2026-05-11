import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import dashboardImg from '@assets/arcelik/dashboard.jpg';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Intro text
      setTimeout(() => setPhase(2), 2500), // Dashboard reveals
      setTimeout(() => setPhase(3), 4500), // Alert banner pulses
      setTimeout(() => setPhase(4), 8000), // Focus on specific region
      setTimeout(() => setPhase(5), 28000), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-[#0B1B2E]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 1 }}
    >
      {/* Intro Text */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-center z-30"
        initial={{ opacity: 0 }}
        animate={phase === 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.2, pointerEvents: 'none' }}
        transition={{ duration: 1 }}
      >
        <h2 className="text-[4vw] font-bold text-white text-center" style={{ fontFamily: 'var(--font-display)' }}>
          Arçelik Fiyat İstihbaratı
          <br/>
          <span className="text-[#F5A623] text-[2vw]">Otonom Fiyatlama Odası</span>
        </h2>
      </motion.div>

      {/* Dashboard Image */}
      <motion.div
        className="absolute w-full h-full flex items-center justify-center z-10"
        initial={{ opacity: 0, scale: 1.2, y: 50 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 1.2, y: 50 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="relative w-[85%] h-[80%] rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(245,166,35,0.15)] border border-white/10">
          <img 
            src={dashboardImg} 
            alt="Business Dashboard" 
            className="w-full h-full object-cover object-top"
          />
          
          {/* Overlay gradient to make text readable */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B1B2E]/80 via-transparent to-[#0B1B2E]/30" />
        </div>
      </motion.div>

      {/* Critical Alert Banner */}
      <motion.div
        className="absolute top-10 w-[60%] left-[20%] bg-[#E30613]/90 backdrop-blur-md border border-[#E30613] rounded-xl p-4 shadow-2xl z-40 flex items-center gap-4"
        initial={{ opacity: 0, y: -50, scale: 0.9 }}
        animate={phase >= 3 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -50, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-[#E30613] font-bold text-xl">!</span>
        </div>
        <div>
          <h3 className="font-bold text-white text-lg">Kritik Uyarı: Rakip Fiyat Hareketi</h3>
          <p className="text-white/90 text-sm">Vestel buzdolabı fiyatlarını %7 düşürdü — İstanbul & Ankara (Trendyol)</p>
        </div>
      </motion.div>

      {/* Parallax Pan & Focus */}
      <motion.div
        className="absolute z-30 bottom-16 left-1/2 -translate-x-1/2 w-full max-w-4xl text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.8 }}
      >
        <p className="text-2xl text-white font-medium bg-[#0B1B2E]/80 backdrop-blur-sm p-6 rounded-2xl border border-white/10 inline-block">
          Pazartesi, 06:14. Fiyat İzleme Ajanı gece yaşanan hareketi çoktan tespit etti.
        </p>
      </motion.div>

    </motion.div>
  );
}
