/**
 * The Axonix title strip over Home and Finance: the mark, and agent activity.
 *
 * Height is `--toolbar-h` (38px) to stay on the density grid. Minimise,
 * maximise and close are Windows' own buttons, drawn by Electron's title bar
 * overlay (electron/main.ts `titleBarOverlay`) in the top-right corner.
 */
import { motion } from 'motion/react';

/**
 * Axon-pulse — the agent-activity signal in the titlebar.
 *
 * "The signal travels the axon": a bright segment sweeps across the 56×2px
 * track while an agent is active. It is driven by `motion@13` rather than the
 * old CSS keyframes, so the component owns a smooth, continuous signal.
 */
function AxonPulse() {
  return (
    <span
      className="titlebar__pulse"
      aria-hidden="true"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <motion.span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: '40%',
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, var(--signal) 50%, transparent 100%)',
          backgroundRepeat: 'no-repeat',
        }}
        initial={{ transform: 'translateX(-100%)' }}
        animate={{ transform: ['translateX(-100%)', 'translateX(250%)'] }}
        transition={{
          duration: 1.2,
          ease: 'linear',
          repeat: Infinity,
        }}
      />
    </span>
  );
}

export default function Titlebar({ status }: { status?: string }) {
  return (
    <header className="titlebar">
      <div className="titlebar__id">
        <svg className="titlebar__logo" viewBox="20 -5 260 260" aria-hidden="true">
          <path
            fill="currentColor"
            d="M150 10C161.046 10 170 18.9543 170 30C170 35.8385 165.25 41.0916 160.328 44.7471C155.714 48.1745 152.045 53.2567 152.002 58.9971C152.001 58.998 152.001 58.9991 152 59V59.0996C152 59.1716 152.002 59.2436 152.003 59.3154C152.004 59.3862 152.005 59.4579 152.007 59.5303C152.008 59.5749 152.01 59.6195 152.012 59.6641C152.705 80.8667 185.343 167.803 223.87 167.998C223.893 167.998 223.916 168 223.939 168C223.946 168 223.952 167.999 223.958 167.999C223.972 167.999 223.986 168 224 168L224.001 167.998C227.93 167.972 231.421 165.494 233.532 162.175C237.139 156.503 243.169 150 250 150C261.046 150 270 158.954 270 170C270 181.046 261.046 190 250 190C243.57 190 237.85 184.239 234.192 178.833C231.57 174.957 227.412 172 222.732 172C222.496 172 222.261 172.009 222.027 172.023C222.018 172.016 222.009 172.008 222 172C183 172 150 232 150 240C150 232 117 172 78 172C77.9906 172.008 77.9811 172.016 77.9717 172.023C77.7379 172.009 77.5032 172 77.2676 172C72.5875 172 68.4302 174.957 65.8076 178.833C62.1497 184.239 56.4296 190 50 190C38.9543 190 30 181.046 30 170C30 158.954 38.9543 150 50 150C56.8312 150 62.8606 156.503 66.4678 162.175C68.5785 165.494 72.0695 167.972 75.998 167.998L76 168C76.0137 168 76.0273 167.999 76.041 167.999C76.0475 167.999 76.054 168 76.0605 168C76.0833 168 76.1062 167.998 76.1289 167.998C114.656 167.804 147.294 80.8669 147.987 59.6641C147.989 59.6195 147.991 59.5749 147.992 59.5303C147.994 59.4579 147.995 59.3862 147.996 59.3154C147.997 59.2435 148 59.1716 148 59.0996C148 59.0869 147.999 59.0742 147.999 59.0615C147.999 59.0409 148 59.0204 148 59C147.999 58.9989 147.998 58.9982 147.997 58.9971C147.954 53.2567 144.286 48.1745 139.672 44.7471C134.75 41.0916 130 35.8385 130 30C130 18.9543 138.954 10 150 10Z"
          />
        </svg>
        <span>AXONIX</span>
      </div>

      {/* Agent activity lives here rather than in a spinner — "the signal travels
          the axon". The pulse is motion@13-driven. */}
      {status && (
        <div className="titlebar__status">
          <AxonPulse />
          <span>{status}</span>
        </div>
      )}

    </header>
  );
}
