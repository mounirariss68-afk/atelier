import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

// Re-timed to match actual MP3 narration lengths + ~0.8s tail.
// Sales-rep-on-a-demo-call rewrite (May 11), best of two takes per scene
// targeting ~13.5 chars/sec natural Turkish conversational rate:
//   situation 18.91s (13.43 cps), complication 17.02s (13.58 cps),
//   resolution1 18.31s (14.25 cps), resolution2 20.06s (13.41 cps),
//   closing 9.82s (12.33 cps). Total ~84s narration.
export const SCENE_DURATIONS = {
  situation: 19700,
  complication: 17800,
  resolution1: 19100,
  resolution2: 20900,
  closing: 10600,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  situation: Scene1,
  complication: Scene2,
  resolution1: Scene3,
  resolution2: Scene4,
  closing: Scene5,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0B1B2E] text-white">
      {/* Persistent background — slow drift, never restarts on scene change */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full opacity-[0.18] blur-3xl"
          style={{
            background: 'radial-gradient(circle, #F5A623, transparent 60%)',
            left: '-10%',
            top: '-15%',
          }}
          animate={{
            x: ['0%', '20%', '-5%', '0%'],
            y: ['0%', '15%', '-10%', '0%'],
            scale: [1, 1.15, 0.95, 1],
          }}
          transition={{ duration: 40, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[70vw] h-[70vw] rounded-full opacity-[0.22] blur-3xl"
          style={{
            background: 'radial-gradient(circle, #1E3A8A, transparent 60%)',
            right: '-15%',
            bottom: '-15%',
          }}
          animate={{
            x: ['0%', '-15%', '8%', '0%'],
            y: ['0%', '-10%', '12%', '0%'],
          }}
          transition={{ duration: 45, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Subtle texture grid so empty zones don't look flat */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* Foreground scenes — unified gentle cross-fade */}
      <div className="relative z-10 w-full h-full">
        <AnimatePresence mode="wait">
          {SceneComponent && (
            <motion.div
              key={currentSceneKey}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <SceneComponent />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
