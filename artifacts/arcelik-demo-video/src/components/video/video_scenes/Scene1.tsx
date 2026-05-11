import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 10000),
      setTimeout(() => setPhase(5), 23000), // Exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const cities = [
    { name: 'İstanbul', x: '25%', y: '30%' },
    { name: 'Ankara', x: '45%', y: '40%' },
    { name: 'İzmir', x: '15%', y: '55%' },
    { name: 'Konya', x: '42%', y: '60%' },
    { name: 'Samsun', x: '60%', y: '20%' },
    { name: 'Antalya', x: '35%', y: '75%' },
  ];

  const brands = ['Trendyol', 'Hepsiburada', 'n11', 'Vestel', 'Bosch', 'Samsung'];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute top-12 left-12 max-w-2xl text-left z-20">
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-[#F5A623] font-bold tracking-widest uppercase text-sm mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Beyaz eşyada fiyat istihbaratı. Türkiye, 2026.
        </motion.div>
        
        <motion.h1 
          className="text-[4vw] font-bold leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {'HER HAFTA AYNI SORU.'.split('').map((char, i) => (
            <motion.span key={i} style={{ display: 'inline-block' }}
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: phase >= 2 ? i * 0.05 : 0, duration: 0.5 }}>
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </motion.h1>

        <motion.div 
          className="mt-8 space-y-4 text-xl text-slate-300"
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 4 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 1 }}
        >
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 bg-[#E30613] rounded-full" />
            <p>8 rakip marka takipte</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 bg-[#E30613] rounded-full" />
            <p>20 şehir, 3 pazaryeri</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 bg-[#E30613] rounded-full" />
            <p>3,000+ bayi fiyat ve kampanya bekliyor</p>
          </div>
        </motion.div>
      </div>

      {/* Map visualization */}
      <motion.div 
        className="absolute right-[10%] top-[20%] w-[40vw] h-[60vh] border border-[#1E3A8A]/30 rounded-3xl bg-[#0E2841]/50 backdrop-blur-md overflow-hidden z-10"
        initial={{ opacity: 0, x: 100 }}
        animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 100 }}
        transition={{ duration: 1, type: "spring", stiffness: 100 }}
      >
        {cities.map((city, i) => (
          <motion.div
            key={city.name}
            className="absolute flex flex-col items-center"
            style={{ left: city.x, top: city.y }}
            initial={{ opacity: 0, scale: 0 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
            transition={{ delay: 0.5 + (i * 0.2) }}
          >
            <motion.div 
              className="w-3 h-3 bg-[#F5A623] rounded-full"
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
            />
            <span className="text-xs mt-2 text-slate-400 font-medium">{city.name}</span>
          </motion.div>
        ))}

        {brands.map((brand, i) => (
          <motion.div
            key={brand}
            className="absolute px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs"
            initial={{ opacity: 0, y: 50, x: Math.random() * 200 - 100 }}
            animate={phase >= 4 ? { 
              opacity: [0, 1, 1, 0],
              y: [-20, Math.random() * -100 - 50],
              x: Math.random() * 100 - 50
            } : { opacity: 0 }}
            transition={{ 
              duration: 4, 
              repeat: Infinity, 
              delay: i * 1.2,
              ease: "linear"
            }}
            style={{ left: `${20 + (i * 10)}%`, bottom: '20%' }}
          >
            {brand}
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
