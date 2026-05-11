import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // title + race panels appear
      setTimeout(() => setPhase(2), 1800),  // pipeline starts crawling, competitor banner stays "queued"
      setTimeout(() => setPhase(3), 4200),  // competitor goes LIVE while team still loading
      setTimeout(() => setPhase(4), 7000),  // consequence band: margin/phones/clock
      setTimeout(() => setPhase(5), 13500), // closing line
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const teamSteps = [
    'Veri toplanıyor',
    'Excel\'e aktarılıyor',
    'Yöneticiye e-posta',
    'Toplantı planlanıyor',
  ];

  return (
    <div className="absolute inset-0 flex flex-col items-center px-12 pt-10 pb-8">
      {/* Title */}
      <motion.div
        className="text-center z-20"
        initial={{ opacity: 0, y: -10 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
        transition={{ duration: 0.6 }}
      >
        <div className="text-[#F5A623] text-base uppercase tracking-[0.25em] font-semibold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          Sorun
        </div>
        <h2 className="text-[3vw] font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Pazarlama hızı, ekip hızını aştı.
        </h2>
      </motion.div>

      {/* Race: Your Team vs Competitor */}
      <div className="flex gap-8 w-full max-w-6xl mt-8 z-10">
        {/* LEFT — Your Team (slow pipeline) */}
        <motion.div
          className="flex-1 bg-white/[0.04] border border-white/10 rounded-2xl p-7 min-h-[36vh] flex flex-col"
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
          transition={{ duration: 0.7 }}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
              <span className="text-sm uppercase tracking-widest text-slate-400 font-semibold">Ekibiniz</span>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">Pzt 06:00 → 11:00</span>
          </div>

          <div className="flex-1 space-y-3">
            {teamSteps.map((step, i) => {
              const stepDelay = 0.4 + i * 0.7;
              const isCurrent = phase >= 2 && i === 1;
              return (
                <motion.div
                  key={step}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: -10 }}
                  animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
                  transition={{ duration: 0.4, delay: stepDelay }}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    i === 0 ? 'bg-slate-500/30 border-slate-500' : 'border-slate-600'
                  }`}>
                    {i === 0 && <div className="w-2 h-2 rounded-full bg-slate-300" />}
                    {isCurrent && (
                      <motion.div
                        className="w-1.5 h-1.5 rounded-full bg-[#F5A623]"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                  </div>
                  <span className={`text-base ${i === 0 ? 'text-slate-300 line-through' : isCurrent ? 'text-white font-medium' : 'text-slate-500'}`}>
                    {step}
                  </span>
                </motion.div>
              );
            })}
          </div>

          {/* Crawling progress */}
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>İlerleme</span>
              <span className="tabular-nums">~ 5 gün</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-slate-400 rounded-full"
                initial={{ width: 0 }}
                animate={phase >= 2 ? { width: '28%' } : { width: 0 }}
                transition={{ duration: 5, ease: 'linear' }}
              />
            </div>
          </div>
        </motion.div>

        {/* RIGHT — Competitor (already live) */}
        <motion.div
          className="flex-1 bg-[#E30613]/[0.06] border border-[#E30613]/30 rounded-2xl p-7 min-h-[36vh] flex flex-col relative overflow-hidden"
          initial={{ opacity: 0, x: 30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
          transition={{ duration: 0.7, delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <motion.div
                className="w-2.5 h-2.5 rounded-full bg-[#E30613]"
                animate={phase >= 3 ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.6 }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
              <span className="text-sm uppercase tracking-widest text-[#E30613] font-semibold">Rakip</span>
            </div>
            <span className="text-xs text-slate-500 tabular-nums">Pzt 06:42</span>
          </div>

          {/* Campaign card — appears as "going live" */}
          <motion.div
            className="bg-[#0E2841] border border-white/10 rounded-xl p-5 flex-1 flex flex-col"
            initial={{ opacity: 0.5 }}
            animate={phase >= 3 ? { opacity: 1, borderColor: 'rgba(227,6,19,0.5)' } : { opacity: 0.5 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Vestel · Hepsiburada</span>
              <motion.span
                className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded"
                animate={
                  phase >= 3
                    ? { backgroundColor: '#E30613', color: '#ffffff' }
                    : { backgroundColor: 'rgba(255,255,255,0.05)', color: '#94a3b8' }
                }
                transition={{ duration: 0.4 }}
              >
                {phase >= 3 ? '● Canlı' : 'Hazırlanıyor'}
              </motion.span>
            </div>

            <div className="text-white text-lg font-semibold mb-1">Buzdolabı kampanyası</div>
            <div className="text-slate-400 text-sm mb-4">İstanbul · Ankara · İzmir</div>

            <div className="flex items-baseline gap-3 mb-4">
              <span className="text-slate-400 line-through text-lg tabular-nums">29.999 ₺</span>
              <motion.span
                className="text-3xl font-bold text-[#F5A623] tabular-nums"
                initial={{ opacity: 0 }}
                animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                27.899 ₺
              </motion.span>
              <motion.span
                className="text-base font-bold text-[#ef4444]"
                initial={{ opacity: 0 }}
                animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.4, delay: 0.3 }}
              >
                ▼ %7
              </motion.span>
            </div>

            <div className="mt-auto h-2 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-[#E30613] rounded-full"
                initial={{ width: 0 }}
                animate={phase >= 3 ? { width: '100%' } : { width: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Consequence band */}
      <motion.div
        className="w-full max-w-6xl mt-6 grid grid-cols-3 gap-5 z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.7 }}
      >
        {/* Margin eroding */}
        <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 flex items-center gap-4">
          <svg viewBox="0 0 60 30" className="w-16 h-8 shrink-0">
            <motion.polyline
              points="0,8 12,12 24,16 36,18 48,22 60,26"
              fill="none"
              stroke="#ef4444"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={phase >= 4 ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 1.2, delay: 0.2 }}
            />
            <motion.polygon
              points="56,22 64,28 50,30"
              fill="#ef4444"
              initial={{ opacity: 0 }}
              animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.3, delay: 1.4 }}
            />
          </svg>
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Marj</div>
            <div className="text-white font-semibold">Eriyor</div>
          </div>
        </div>

        {/* Dealer phones ringing */}
        <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 flex items-center gap-4">
          <div className="relative w-12 h-10 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-[#F5A623]" fill="currentColor">
              <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1 1 0 00-1.02.24l-2.2 2.2a15.05 15.05 0 01-6.59-6.59l2.2-2.21a1 1 0 00.25-1A11.36 11.36 0 018.5 4a1 1 0 00-1-1H4a1 1 0 00-1 1c0 9.39 7.61 17 17 17a1 1 0 001-1v-3.5a1 1 0 00-1-1z"/>
            </svg>
            <motion.div
              className="absolute -top-1 -right-1 bg-[#E30613] text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center"
              initial={{ scale: 0 }}
              animate={phase >= 4 ? { scale: [0, 1.2, 1] } : { scale: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              47
            </motion.div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Bayiler</div>
            <div className="text-white font-semibold">Telefon susmuyor</div>
          </div>
        </div>

        {/* Decision lag clock */}
        <div className="bg-white/[0.04] border border-white/10 rounded-xl px-5 py-4 flex items-center gap-4">
          <svg viewBox="0 0 24 24" className="w-9 h-9 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9" />
            <motion.path
              d="M12 7v5l3 2"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={phase >= 4 ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
          </svg>
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Karar</div>
            <div className="text-white font-semibold">Bir adım geriden</div>
          </div>
        </div>
      </motion.div>

      {/* Closing punchline */}
      <motion.p
        className="mt-5 text-base md:text-lg text-slate-300 text-center max-w-3xl z-10"
        initial={{ opacity: 0 }}
        animate={phase >= 5 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6 }}
      >
        Açıkçası fiyatlandırma artık <span className="text-white font-bold">ekipten hızlı.</span>
      </motion.p>
    </div>
  );
}
