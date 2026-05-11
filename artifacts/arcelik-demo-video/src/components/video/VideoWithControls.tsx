import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const PROGRESS_TICK_MS = 60;
const AUDIO_FADE_MS = 400;

interface ControlBarProps {
  visible: boolean;
  collapsed: boolean;
  locked: boolean;
  muted: boolean;
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  onToggleLock: () => void;
  onToggleMute: () => void;
  onJumpTo: (index: number) => void;
  onToggleCollapsed: () => void;
}

function ProgressSegments({
  sceneKeys,
  activeIndex,
  activeDuration,
  tick,
  onJumpTo,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  onJumpTo: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const start = performance.now();
    const id = window.setInterval(() => {
      setElapsed(performance.now() - start);
    }, PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  const progress = activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;

  return (
    <div className="flex-1 flex items-center gap-1.5">
      {sceneKeys.map((key, i) => {
        const isActive = i === activeIndex;
        const fill = isActive ? progress * 100 : 0;
        return (
          <button
            key={key}
            onClick={() => onJumpTo(i)}
            className="flex-1 h-3 bg-white/20 rounded-full overflow-hidden cursor-pointer hover:h-4 hover:bg-white/25 transition-all relative min-h-[12px]"
            aria-label={`Jump to scene ${i + 1}`}
            aria-current={isActive ? 'true' : undefined}
          >
            <div
              className="absolute inset-y-0 left-0 bg-white/90 rounded-full transition-[width] duration-100"
              style={{ width: `${fill}%` }}
            />
          </button>
        );
      })}
    </div>
  );
}

function ControlBar({
  visible,
  collapsed,
  locked,
  muted,
  sceneKeys,
  activeIndex,
  activeDuration,
  tick,
  onToggleLock,
  onToggleMute,
  onJumpTo,
  onToggleCollapsed,
}: ControlBarProps) {
  return (
    <div
      className={`flex items-center gap-3 bg-black/50 backdrop-blur-sm px-5 py-4 transition-all duration-200 ease-out ${
        visible
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      aria-hidden={!visible}
    >
      <button
        onClick={onToggleLock}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          locked
            ? 'text-white bg-white/15 hover:bg-white/25'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
        aria-label={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
        aria-pressed={locked}
      >
        <Repeat className="w-8 h-8" />
      </button>

      <div className="w-px self-stretch bg-white/15" aria-hidden="true" />

      <ProgressSegments
        sceneKeys={sceneKeys}
        activeIndex={activeIndex}
        activeDuration={activeDuration}
        tick={tick}
        onJumpTo={onJumpTo}
      />

      <div className="text-xl text-white/60 font-mono tabular-nums shrink-0">
        {activeIndex + 1}/{sceneKeys.length}
      </div>

      <button
        onClick={onToggleMute}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          muted
            ? 'text-white/60 hover:text-white hover:bg-white/10'
            : 'text-white bg-white/15 hover:bg-white/25'
        }`}
        title={muted ? 'Unmute Turkish narration' : 'Mute Turkish narration'}
        aria-label={muted ? 'Unmute Turkish narration' : 'Mute Turkish narration'}
        aria-pressed={!muted}
      >
        {muted ? <VolumeX className="w-8 h-8" /> : <Volume2 className="w-8 h-8" />}
      </button>

      <button
        onClick={onToggleCollapsed}
        className="w-14 h-14 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-lg shrink-0"
        title={collapsed ? 'Show controls' : 'Hide controls'}
        aria-label={collapsed ? 'Show controls' : 'Hide controls'}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronUp className="w-10 h-10" /> : <ChevronDown className="w-10 h-10" />}
      </button>
    </div>
  );
}

/** Floating mute pill for browser-tab viewing (auto-hides after inactivity). */
function FloatingMutePill({
  muted,
  onToggle,
  pulse,
}: {
  muted: boolean;
  onToggle: () => void;
  pulse: boolean;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let timeoutId: number;
    const reset = () => {
      setHidden(false);
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setHidden(true), 4000);
    };
    reset();
    window.addEventListener('mousemove', reset);
    window.addEventListener('touchstart', reset);
    window.addEventListener('keydown', reset);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('touchstart', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);

  return (
    <button
      onClick={onToggle}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-full bg-black/70 backdrop-blur-md border border-white/15 text-white text-sm font-medium hover:bg-black/85 transition-all ${
        hidden && !muted ? 'opacity-0 pointer-events-none' : 'opacity-100'
      } ${pulse && muted ? 'animate-pulse ring-2 ring-[#F5A623]/70' : ''}`}
      aria-label={muted ? 'Sesi aç' : 'Sesi kapat'}
    >
      {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      <span>{muted ? 'Sesi aç' : 'Sesi kapat'}</span>
    </button>
  );
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;

  const {
    sceneKeys,
    activeIndex,
    locked,
    mountKey,
    tick,
    durations,
    activeDuration,
    onSceneChange,
    jumpTo,
    toggleLock,
  } = useSceneControls(SCENE_DURATIONS);

  const sensorRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRafRef = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const [muted, setMuted] = useState(true);

  const activeSceneKey = sceneKeys[activeIndex];
  const audioSrc = `${import.meta.env.BASE_URL}audio/${activeSceneKey}.mp3`;

  // Audio cross-fade on scene change: ramp out -> swap src -> ramp in.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);

    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const startVol = clamp(el.volume);
    const fadeStart = performance.now();

    const fadeOut = (now: number) => {
      const t = Math.min(1, (now - fadeStart) / AUDIO_FADE_MS);
      el.volume = clamp(startVol * (1 - t));
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(fadeOut);
      } else {
        el.currentTime = 0;
        el.volume = 0;
        el.play().catch(() => {});
        const inStart = performance.now();
        const fadeIn = (inNow: number) => {
          const ti = Math.min(1, (inNow - inStart) / AUDIO_FADE_MS);
          el.volume = clamp(ti);
          if (ti < 1) fadeRafRef.current = requestAnimationFrame(fadeIn);
        };
        fadeRafRef.current = requestAnimationFrame(fadeIn);
      }
    };
    fadeRafRef.current = requestAnimationFrame(fadeOut);

    return () => {
      if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
    };
  }, [activeSceneKey, mountKey, tick]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      const el = audioRef.current;
      if (el) {
        el.muted = next;
        if (!next) el.play().catch(() => {});
      }
      return next;
    });
  }, []);

  const handlePointerEnter = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setHovering(false);
  }, []);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse') return;
      if (collapsed) setTapPinned(true);
    },
    [collapsed],
  );
  const handleToggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      if (!c) {
        setHovering(false);
        setTapPinned(false);
      }
      return !c;
    });
  }, []);

  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const sensor = sensorRef.current;
      if (sensor && !sensor.contains(e.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [collapsed, tapPinned]);

  const barVisible = !collapsed || hovering || tapPinned;

  return (
    <div className="relative w-full h-screen">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        onSceneChange={onSceneChange}
      />
      <audio
        ref={audioRef}
        src={audioSrc}
        autoPlay
        muted={muted}
        preload="auto"
      />
      {isIframed ? (
        <div
          ref={sensorRef}
          className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end"
          style={{ height: '25%' }}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onPointerDown={handlePointerDown}
        >
          <div className="flex-1 w-full" aria-hidden="true" />
          <ControlBar
            visible={barVisible}
            collapsed={collapsed}
            locked={locked}
            muted={muted}
            sceneKeys={sceneKeys}
            activeIndex={activeIndex}
            activeDuration={activeDuration}
            tick={tick}
            onToggleLock={toggleLock}
            onToggleMute={toggleMute}
            onJumpTo={jumpTo}
            onToggleCollapsed={handleToggleCollapsed}
          />
        </div>
      ) : (
        <FloatingMutePill muted={muted} onToggle={toggleMute} pulse={true} />
      )}
    </div>
  );
}
