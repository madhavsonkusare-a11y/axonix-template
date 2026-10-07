/**
 * Overview — every app at once, after Mission Control.
 *
 * Open apps show their last frame, sleeping ones too; apps not opened yet show
 * their icon. Tiles rise in with a short stagger; picking one closes the grid
 * and that page grows back into the card.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { SOCIAL_APPS, type SocialAppId } from './apps';
import { appIcons } from './icons';

export interface OverviewProps {
  active: SocialAppId | null;
  running: Set<SocialAppId>;
  sleeping: Set<SocialAppId>;
  snapshots: Partial<Record<SocialAppId, string>>;
  badges: Partial<Record<SocialAppId, number>>;
  onPick: (id: SocialAppId) => void;
  onClose: () => void;
}

export default function Overview({ active, running, sleeping, snapshots, badges, onPick, onClose }: OverviewProps) {
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = grid.current?.querySelector<HTMLButtonElement>(`[data-app="${active ?? SOCIAL_APPS[0].id}"]`);
    start?.focus({ preventScroll: true });
  }, [active]);

  const move = (e: React.KeyboardEvent) => {
    const tiles = [...(grid.current?.querySelectorAll<HTMLButtonElement>('.soc-tile') ?? [])];
    const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const cols = 3;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols }[e.key];
    if (e.key === 'Escape') onClose();
    if (next === undefined || i < 0) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, next))]?.focus();
  };

  return (
    <motion.div
      className="soc-overview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      onKeyDown={move}
    >
      <div ref={grid} className="soc-overview__grid" role="listbox" aria-label="Apps">
        {SOCIAL_APPS.map((a, i) => {
          const badge = badges[a.id] ?? 0;
          return (
            <motion.button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === active}
              data-app={a.id}
              data-active={a.id === active}
              className="soc-tile"
              initial={{ opacity: 0, y: 18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 400, damping: 32, delay: i * 0.028 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={(e) => {
                e.stopPropagation();
                onPick(a.id);
              }}
            >
              <span className="soc-tile__preview">
                {snapshots[a.id] ? (
                  <img src={snapshots[a.id]} alt="" />
                ) : (
                  <span className="soc-tile__blank">
                    <img src={appIcons[a.id]} alt="" />
                  </span>
                )}
              </span>
              <span className="soc-tile__label">
                <img src={appIcons[a.id]} alt="" />
                <span>{a.name}</span>
                {badge > 0 && <span className="soc-badge soc-badge--inline">{badge > 99 ? '99+' : badge}</span>}
                <span className="soc-tile__state">{running.has(a.id) ? 'Open' : sleeping.has(a.id) ? 'Sleeping' : ''}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
