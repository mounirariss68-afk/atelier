import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { TurkeyMap, CITY_POSITIONS } from '../lib/TurkeyMap';

const CITY_KEYS = ['istanbul', 'ankara', 'izmir', 'bursa', 'samsun', 'konya', 'antalya', 'gaziantep'] as const;
const CITY_LABELS: Record<string, string> = {
  istanbul: 'İstanbul',
  ankara: 'Ankara',
  izmir: 'İzmir',
  bursa: 'Bursa',
  samsun: 'Samsun',
  konya: 'Konya',
  antalya: 'Antalya',
  gaziantep: 'Gaziantep',
};

const BRANDS = ['Trendyol', 'Hepsiburada', 'n11', 'Vestel', 'Bosch', 'Samsung'];

const TICKER = [
  { brand: 'Vestel', cat: 'Buzdolabı', city: 'İstanbul', dir: 'down', pct: '7%' },
  { brand: 'Bosch', cat: 'Çamaşır mak.', city: 'Ankara', dir: 'up', pct: '4%' },
  { brand: 'Samsung', cat: 'TV', city: 'İzmir', dir: 'down', pct: '11%' },
  { brand: 'Trendyol', cat: 'Klima', city: 'Antalya', dir: 'down', pct: '5%' },
];

export function Scene1() {
  const [phase, setPhase] = useState(0);
  const [tickerIdx, setTickerIdx] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1600),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 6500),
      setTimeout(() => setPhase(5), 9500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTickerIdx(i => (i + 1) % TICKER.length), 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 p-12">
      {/* Left column */}
      <div className="absolute top-12 left-12 w-[44%] max-w-[640px] z-20 flex flex-col gap-8">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="text-[#F5A623] font-bold tracking-widest uppercase text-base"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Beyaz eşyada fiyat istihbaratı · Türkiye, 2026
        </motion.div>

        <motion.h1
          className="text-[5.6vw] leading-[1.02] font-bold whitespace-nowrap"
          style={{ fontFamily: 'var(--font-display)' }}
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div>HER HAFTA</div>
          <div>AYNI SORU.</div>
        </motion.h1>

        <motion.div
          className="space-y-4 text-2xl text-slate-300"
          initial={{ opacity: 0, filter: 'blur(8px)' }}
          animate={phase >= 4 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(8px)' }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex items-center gap-4">
            <div className="w-2.5 h-2.5 bg-[#E30613] rounded-full" />
            <p>8 rakip marka takipte</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-2.5 h-2.5 bg-[#E30613] rounded-full" />
            <p>20 şehir, 3 pazaryeri</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-2.5 h-2.5 bg-[#E30613] rounded-full" />
            <p>3.000+ bayi fiyat ve kampanya bekliyor</p>
          </div>
        </motion.div>

        {/* Live competitor price ticker */}
        <motion.div
          className="mt-6 bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 backdrop-blur-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.7 }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-pulse" />
            <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Canlı rakip hareketleri</span>
          </div>
          <div className="h-7 overflow-hidden relative">
            {TICKER.map((t, i) => {
              const active = i === tickerIdx;
              return (
                <motion.div
                  key={i}
                  className="absolute inset-0 flex items-center gap-3 text-base"
                  initial={false}
                  animate={{ opacity: active ? 1 : 0, y: active ? 0 : 10 }}
                  transition={{ duration: 0.4 }}
                >
                  <span className="font-semibold text-white">{t.brand}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-300">{t.cat}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-300">{t.city}</span>
                  <span className="text-slate-400">·</span>
                  <span className={t.dir === 'down' ? 'text-[#ef4444] font-semibold' : 'text-[#22c55e] font-semibold'}>
                    {t.dir === 'down' ? '▼' : '▲'} {t.pct}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Right column: real Türkiye map */}
      <motion.div
        className="absolute right-[3%] top-[10%] w-[52%] h-[78%] rounded-3xl bg-[#0E2841]/40 border border-white/10 backdrop-blur-md flex flex-col z-10 overflow-hidden"
        initial={{ opacity: 0, x: 60 }}
        animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 60 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Türkiye · Pazar Kapsama</span>
          <span className="text-xs text-slate-500">Mayıs 2026</span>
        </div>

        <div className="flex-1 px-4 pb-4 flex items-center justify-center">
          <TurkeyMap viewBox="0 -10 650 205" className="w-full h-full">
            {CITY_KEYS.map((id, i) => {
              const pos = CITY_POSITIONS[id];
              if (!pos) return null;
              return (
                <g key={id}>
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={3.5}
                    fill="#F5A623"
                    opacity={phase >= 3 ? 1 : 0}
                    style={{ transition: `opacity 0.5s ${0.4 + i * 0.1}s` }}
                  />
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={6}
                    fill="none"
                    stroke="#F5A623"
                    strokeWidth={0.6}
                    opacity={0.5}
                  >
                    <animate attributeName="r" values="3.5;9;3.5" dur="2.4s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
                    <animate attributeName="opacity" values="0.6;0;0.6" dur="2.4s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
                  </circle>
                  <text
                    x={pos.x + 6}
                    y={pos.y + 1.5}
                    fontSize={4.5}
                    fill="#cbd5e1"
                    style={{ fontWeight: 600, opacity: phase >= 3 ? 1 : 0, transition: `opacity 0.5s ${0.6 + i * 0.1}s` }}
                  >
                    {CITY_LABELS[id]}
                  </text>
                </g>
              );
            })}
          </TurkeyMap>
        </div>

        {/* Brand chip strip — separated from cities */}
        <motion.div
          className="px-6 py-4 border-t border-white/10 bg-black/20"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.7 }}
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-semibold">Takip edilen rakipler</div>
          <div className="flex flex-wrap gap-2">
            {BRANDS.map((b, i) => (
              <motion.div
                key={b}
                initial={{ opacity: 0, y: 8 }}
                animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.4 }}
                className="px-3 py-1.5 bg-white/[0.06] border border-white/15 rounded-full text-sm font-medium text-slate-200"
              >
                {b}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
