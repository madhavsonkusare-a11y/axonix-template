/**
 * Launcher content.
 *
 * This file used to hold every placeholder figure in the tracker. Those are
 * gone: finance numbers are derived from real data in `ledger.ts`, and the
 * Finance tile reads them live. What remains is copy for the tiles without live
 * figures: Social opens its own app (Axonix Social), and Portfolio is not built yet.
 */
import type { Hue } from './types';

export interface LauncherApp {
  id: string;
  title: string;
  subtitle: string;
  hue: Hue;
  figure: string;
  secondary: string;
  /** Finance, Tasks and Social have destinations; the rest render but do not navigate. */
  ready: boolean;
}

export const launcherApps: LauncherApp[] = [
  { id: 'finance',   title: 'Finance tracker', subtitle: 'Net worth, spending, accounts, IDs', hue: 'blue',   figure: '',            secondary: '',           ready: true },
  { id: 'tasks',     title: 'Task tracker',    subtitle: 'Projects, today, blocked',           hue: 'violet', figure: '',            secondary: '',           ready: true },
  { id: 'portfolio', title: 'My portfolio',    subtitle: 'Projects, resume, shipping log',     hue: 'green',  figure: '12 projects', secondary: '3 live',     ready: false },
  { id: 'social',    title: 'Social network',  subtitle: 'Instagram, X, Threads and more',     hue: 'amber',  figure: '6 apps',      secondary: '',           ready: true },
];

/** Picks a creative greeting based on the current time of day. */
export function getGreeting(): string {
  const hour = new Date().getHours();
  const select = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  
  if (hour >= 5 && hour < 12) {
    return select([
      'Good morning.',
      'A fresh start.',
      'Let’s conquer the day.',
      'Morning hustle.',
      'Rise and shine.',
      'Early bird gets the worm.',
      'New day, new goals.',
      'Ready for action.'
    ]);
  }
  if (hour >= 12 && hour < 17) {
    return select([
      'Good afternoon.',
      'Keep the momentum going.',
      'Halfway there.',
      'Stay focused.',
      'Afternoon grind.',
      'Making progress.',
      'Productivity mode.',
      'Steady pace.'
    ]);
  }
  if (hour >= 17 && hour < 22) {
    return select([
      'Good evening.',
      'Winding down.',
      'Reflect on the day.',
      'Evening calm.',
      'Time to relax.',
      'Great work today.',
      'Sunset vibes.',
      'Unwind and recharge.'
    ]);
  }
  return select([
    'Night owl.',
    'Burning the midnight oil.',
    'Late night focus.',
    'Quiet hours.',
    'Rest well soon.',
    'Still awake?',
    'Midnight thoughts.',
    'The world is quiet.'
  ]);
}
