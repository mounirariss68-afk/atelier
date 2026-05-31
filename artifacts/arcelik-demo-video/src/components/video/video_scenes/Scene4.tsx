import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Agent {
  name: string;
  task: string;
  icon: JSX.Element;
}

const AGENTS: Agent[] = [
  {
    name: 'Talep Tahmincisi',
    task: 'Talebi tahmin ediyor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="14 7 21 7 21 14" />
      </svg>
    ),
  },
  {
    name: 'Rekabet Analisti',
    task: 'Rakibi okuyor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16" y2="16" />
      </svg>
    ),
  },
  {
    name: 'Kampanya Stratejisti',
    task: 'Kampanyayı kuruyor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l18-7v15l-18-7z" />
        <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
      </svg>
    ),
  },
  {
    name: 'Bayi Yöneticisi',
    task: 'Bayiyle konuşuyor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a4 4 0 01-4 4H8l-5 4V6a4 4 0 014-4h10a4 4 0 014 4v9z" />
      </svg>
    ),
  },
  {
    name: 'Fiyat İzleme Ajanı',
    task: 'Fiyatı izliyor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    name: 'Fiyatlama Orkestratörü',
    task: 'Hepsini koordine ediyor',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="3" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="21" />
        <line x1="3" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="21" y2="12" />
      </svg>
    ),
  },
];

// Six positions around a center hub (in % of the orchestra container).
const ORBIT_POSITIONS = [
  { x: 50, y: 8 },   // top
  { x: 88, y: 28 },  // top right
  { x: 88, y: 72 },  // bottom right
  { x: 50, y: 92 },  // bottom
  { x: 12, y: 72 },  // bottom left
  { x: 12, y: 28 },  // top left
];

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),    // title
      setTimeout(() => setPhase(2), 1500),   // agents fan out around hub
      setTimeout(() => setPhase(3), 4500),   // tasks cycle through
      setTimeout(() => setPhase(4), 11500),  // collapse → Approve button
      setTimeout(() => setPhase(5), 14000),  // counter rolls + POS grid
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col items-center px-12 pt-10 pb-8 bg-[#0B1B2E]">
      {/* Title */}
      <motion.div
        className="text-center z-30"
        initial={{ opacity: 0, y: -10 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
        transition={{ duration: 0.6 }}
      >
        <div className="text-[#F5A623] text-base uppercase tracking-[0.25em] font-semibold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          Çözüm
        </div>
        <h2 className="text-[3vw] font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Altı uzman ajan, tek bir orkestra.
        </h2>
      </motion.div>

      {/* Orchestra hub (Phases 1-3) */}
      <motion.div
        className="relative w-[78vh] h-[58vh] max-w-[900px] mt-4 z-10"
        initial={{ opacity: 0 }}
        animate={
          phase >= 2 && phase < 4 ? { opacity: 1, scale: 1 } :
          phase >= 4 ? { opacity: 0, scale: 0.85, pointerEvents: 'none' } :
          { opacity: 0, scale: 0.95 }
        }
        transition={{ duration: 0.7 }}
      >
        {/* Connector lines from hub to each agent */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {ORBIT_POSITIONS.map((pos, i) => (
            <motion.line
              key={i}
              x1="50"
              y1="50"
              x2={pos.x}
              y2={pos.y}
              stroke="#F5A623"
              strokeWidth="0.15"
              strokeDasharray="0.6 0.6"
              initial={{ opacity: 0 }}
              animate={phase >= 2 ? { opacity: 0.4 } : { opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.08 }}
            />
          ))}
        </svg>

        {/* Pulse ring on hub */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border-2 border-[#F5A623]/40"
          animate={phase >= 2 ? { scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] } : { opacity: 0 }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />

        {/* Central hub */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-[#F5A623] flex items-center justify-center shadow-[0_0_40px_rgba(245,166,35,0.5)]"
          initial={{ scale: 0 }}
          animate={phase >= 2 ? { scale: 1 } : { scale: 0 }}
          transition={{ duration: 0.6, type: 'spring', damping: 12 }}
        >
          <span className="text-[#0B1B2E] font-bold text-sm tracking-wider">COGNIRISE</span>
        </motion.div>

        {/* Agent nodes */}
        {AGENTS.map((agent, i) => {
          const pos = ORBIT_POSITIONS[i];
          // Each agent "lights up" in sequence during phase 3
          const lightIndex = phase >= 3 ? Math.floor(((Date.now() / 900) % AGENTS.length)) : -1;
          return (
            <motion.div
              key={agent.name}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              initial={{ opacity: 0, scale: 0 }}
              animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
              transition={{ duration: 0.5, delay: 0.5 + i * 0.12 }}
            >
              <AgentNode agent={agent} active={phase >= 3 && i === lightIndex} index={i} startPulse={phase >= 3} />
            </motion.div>
          );
        })}
      </motion.div>

      {/* Phase 4-5: Approve → Push → POS */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center z-20 pt-24"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 1 } : { opacity: 0, pointerEvents: 'none' }}
        transition={{ duration: 0.7 }}
      >
        {/* Approve button (phase 4 only, before counter) */}
        <motion.div
          className="bg-[#F5A623] text-[#0B1B2E] px-12 py-5 rounded-xl font-bold text-2xl shadow-[0_0_60px_rgba(245,166,35,0.4)] flex items-center gap-4"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={
            phase >= 5 ? { scale: 0.9, opacity: 0.5, y: -20 } :
            phase >= 4 ? { scale: 1, opacity: 1, y: 0 } :
            { scale: 0.8, opacity: 0 }
          }
          transition={{ duration: 0.6 }}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Onayla
        </motion.div>

        {/* Counter + POS grid (phase 5) */}
        <motion.div
          className="mt-8 flex flex-col items-center gap-8"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
        >
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-2">
              Yeni fiyat listesi gönderildi
            </div>
            <div className="flex items-baseline gap-3">
              <Counter to={3000} active={phase >= 5} className="text-[6vw] font-bold text-white tabular-nums" />
              <span className="text-2xl text-slate-300">bayi</span>
            </div>
            <div className="text-sm text-slate-400 mt-2">20 şehir · saniyeler içinde</div>
          </div>

          {/* POS grid */}
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-20 h-14 bg-[#0E2841] border border-white/10 rounded-md flex items-center justify-center"
                initial={{ opacity: 0.2 }}
                animate={phase >= 5 ? { opacity: 1, borderColor: 'rgba(34,197,94,0.5)' } : { opacity: 0.2 }}
                transition={{ duration: 0.4, delay: 0.4 + i * 0.06 }}
              >
                <motion.svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 text-[#22c55e]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={phase >= 5 ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
                  transition={{ duration: 0.4, delay: 0.5 + i * 0.06 }}
                >
                  <polyline points="20 6 9 17 4 12" />
                </motion.svg>
              </motion.div>
            ))}
          </div>

          <div className="text-sm text-slate-400">POS görselleri kendiliğinden güncellendi</div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function AgentNode({ agent, active, index, startPulse }: { agent: Agent; active: boolean; index: number; startPulse: boolean }) {
  return (
    <div className="flex flex-col items-center w-44">
      <motion.div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2 border-2"
        animate={
          active
            ? { backgroundColor: 'rgba(245,166,35,0.18)', borderColor: '#F5A623', color: '#F5A623', scale: 1.08 }
            : { backgroundColor: '#0E2841', borderColor: 'rgba(255,255,255,0.15)', color: '#cbd5e1', scale: 1 }
        }
        transition={{ duration: 0.4 }}
      >
        <div className="w-7 h-7">{agent.icon}</div>
      </motion.div>
      <div className="text-xs font-semibold text-white text-center leading-tight">{agent.name}</div>
      <motion.div
        className="text-[11px] text-[#F5A623] mt-1 text-center leading-tight h-4"
        animate={{ opacity: active ? 1 : startPulse ? 0.3 : 0 }}
        transition={{ duration: 0.3 }}
      >
        {active ? agent.task : ''}
      </motion.div>
    </div>
  );
}

function Counter({ to, active, className }: { to: number; active: boolean; className: string }) {
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!active) {
      setVal(0);
      return;
    }
    const start = performance.now();
    const dur = 1400;
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(to * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, to]);

  return <span className={className}>{val.toLocaleString('tr-TR')}</span>;
}
