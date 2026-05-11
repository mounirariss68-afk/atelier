import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import marketplaceImg from '@assets/arcelik/marketplace.jpg';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-[#0B1B2E]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <div className="absolute inset-0 opacity-20">
         <img src={marketplaceImg} alt="Background" className="w-full h-full object-cover filter blur-xl" />
      </div>

      <div className="relative z-10 text-center flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1, type: "spring" }}
          className="mb-8"
        >
          <div className="text-[#F5A623] font-bold tracking-widest uppercase text-sm mb-4">
            Arçelik Fiyat İstihbaratı
          </div>
          <div className="text-[4vw] font-bold text-white leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Döngü nihayet pazarın <br/>hızında hareket ettiğinde.
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
          className="mt-12 pt-12 border-t border-white/10 flex flex-col items-center gap-4"
        >
          <div className="flex items-center gap-3">
             <div className="text-xl font-bold tracking-tight text-white flex items-center">
               <span className="w-8 h-8 rounded bg-[#F5A623] inline-block mr-2" />
               MAVEN AI
             </div>
          </div>
          <div className="text-slate-400 text-sm">
            MENAT işletmeleri için ajan zekası. <br/>maven-ai.com
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
