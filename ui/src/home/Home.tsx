/**
 * Axonix Home — the launcher.
 *
 * The entry view: a cycling greeting and four app tiles. Finance, Tasks and
 * Social open in this window; Portfolio renders exactly as designed but does
 * not navigate, because a tile that opens an empty screen is worse than one
 * that politely does nothing.
 */
import { useState } from 'react';
import { Archive, NotebookPen } from 'lucide-react';
import { Backdrop } from '../Backdrop';
import { getGreeting, launcherApps, type LauncherApp } from '../finance/data';
import { AuroraLayers, auroraClass } from '../finance/components/Aurora';
import { Mark, appIcon } from '../finance/components/Glyphs';
import { useFinance } from '../finance/FinanceContext';
import { needsBalance, netWorth } from '../finance/ledger';
import { addDays, delta, money, todayIso } from '../finance/format';
import { useTasks } from '../tasks/TasksContext';
import { isLate, isOpen } from '../tasks/derive';

/** The Finance tile's figures, live: net worth and its 30-day move. */
function useFinanceFigure(): { figure: string; secondary: string } {
  const { data, loading } = useFinance();
  if (loading) return { figure: '', secondary: '' };
  if (data.accounts.every((a) => needsBalance(data, a))) return { figure: 'Set balances', secondary: '' };
  const now = netWorth(data).total;
  const then = netWorth(data, addDays(todayIso(), -30)).total;
  const pct = then !== 0 ? ((now - then) / Math.abs(then)) * 100 : 0;
  return { figure: money(now), secondary: Math.abs(pct) >= 0.05 ? delta(pct, { spaced: false }) : '' };
}

/** The Tasks tile's figures, live: what is due (or open) and what is late. */
function useTasksFigure(): { figure: string; secondary: string } {
  const { tasks, loading } = useTasks();
  if (loading) return { figure: '', secondary: '' };
  const today = todayIso();
  const open = tasks.filter(isOpen);
  if (!open.length) return { figure: tasks.length ? 'All done' : 'No tasks yet', secondary: '' };
  const due = open.filter((t) => t.due && t.due <= today).length;
  const late = open.filter((t) => isLate(t, today)).length;
  return { figure: due ? `${due} due` : `${open.length} open`, secondary: late ? `${late} late` : '' };
}

function AppTile({ app, onOpen }: { app: LauncherApp; onOpen: () => void }) {
  const finance = useFinanceFigure();
  const tasks = useTasksFigure();
  const { figure, secondary } = app.id === 'finance' ? finance : app.id === 'tasks' ? tasks : app;
  const Icon = appIcon[app.id];
  return (
    <button
      type="button"
      className={auroraClass(app.hue, 'tile-app')}
      data-ready={app.ready}
      onClick={app.ready ? onOpen : undefined}
      aria-disabled={!app.ready}
      title={app.ready ? undefined : `${app.title} is not built yet`}
    >
      <AuroraLayers />
      <span className="fin-aurora__body">
        <span className="tile-app__glyph">
          {Icon && <Icon size={14} strokeWidth={1.5} aria-hidden="true" />}
        </span>
        <span className="tile-app__title">{app.title}</span>
        <span className="tile-app__sub">{app.subtitle}</span>
        <span className="tile-app__foot fin-ink">
          <span className="tile-app__figure fin-num fin-num--lg">{figure}</span>
          <span className="tile-app__secondary fin-num">{secondary}</span>
        </span>
      </span>
    </button>
  );
}

export default function Home({
  onOpenApp,
}: {
  onOpenApp: (id: string) => void;
}) {
  const [greeting] = useState(getGreeting);

  return (
    <div className="home">
      <div className="home__inner">
        <Backdrop tone="home" className="home__wash" />
        <div className="fin-grain home__grain" aria-hidden="true" />

        <div className="home__center">
          <div className="home__greeting">
            <Mark className="home__logo" aria-hidden="true" />
            <h1>{greeting}</h1>
          </div>

          <div className="home__tiles">
            {launcherApps.map((app) => (
              <AppTile key={app.id} app={app} onOpen={() => onOpenApp(app.id)} />
            ))}
          </div>
          {/* Beside the tiles, not a fifth tile: the launcher is 4-up or 2×2, never 3 + 1 + 1. */}
          <div className="home__launchers">
            <button className="nv-launcher" onClick={() => onOpenApp('notes')}><NotebookPen size={16}/> Open Notes <span>Your personal writing space</span></button>
            <button className="nv-launcher nv-launcher--storeroom" onClick={() => onOpenApp('storeroom')}><Archive size={16}/> Open Storeroom <span>Inspiration and references</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}
