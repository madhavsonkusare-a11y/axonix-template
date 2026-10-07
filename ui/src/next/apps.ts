/**
 * The rail's modules, in one order everywhere, with what is waiting in each.
 *
 * A badge is amber and means "something here wants you": transactions a
 * machine categorised, tasks due today or late.
 */
import { useMemo } from 'react';
import { Archive, CalendarDays, House, NotebookPen, SquareCheck, Users, Wallet } from 'lucide-react';
import { useFinance } from '../finance/FinanceContext';
import { needsReview } from '../finance/ledger';
import { useDay } from './scrub/Scrub';
import { useTasks } from '../tasks/TasksContext';
import { todaySummary } from '../tasks/derive';
import type { DockApp } from './Dock';

const DOCK: DockApp[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'tasks', label: 'Tasks', icon: SquareCheck },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'storeroom', label: 'Storeroom', icon: Archive },
  { id: 'social', label: 'Social', icon: Users },
];

export function useDockApps(): DockApp[] {
  const { data } = useFinance();
  const { tasks } = useTasks();
  const review = needsReview(data).length;
  const today = useDay();
  const due = useMemo(() => {
    const sum = todaySummary(tasks, today);
    return sum.dueToday + sum.late;
  }, [tasks, today]);
  return useMemo(() => DOCK.map((a) => (a.id === 'finance' && review ? { ...a, badge: review } : a.id === 'tasks' && due ? { ...a, badge: due } : a)), [review, due]);
}
