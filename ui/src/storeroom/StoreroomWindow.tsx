/**
 * The Storeroom in a window of its own (`#storeroom`): the pop-out from
 * Axonix, and what its pinned taskbar button opens.
 *
 * It mounts the Storeroom and nothing else — no Finance, Tasks or Notes
 * state — so this window never reads or writes anything but the library.
 *
 * It shows the same Storeroom the main window does (`next/storeroom`), without
 * the dock: there is nowhere else to go from here. The first version is kept
 * and opens from the sidebar's foot; its name in the corner comes back.
 */
import { useCallback, useEffect, useState } from 'react';
import Titlebar from '../Titlebar';
import Toasts from '../Toasts';
import { AlertHost } from '../finance/components/Alert';
import { StoreroomAlone } from '../next/storeroom/StoreroomNext';
import StoreroomApp from './StoreroomApp';
import { useStoreroomNotices } from './notices';

export default function StoreroomWindow() {
  const [request, setRequest] = useState<{ id: string; n: number } | null>(null);
  const [legacy, setLegacy] = useState(false);
  const open = useCallback((id: string) => setRequest((r) => ({ id, n: (r?.n ?? 0) + 1 })), []);
  useStoreroomNotices(open);
  useEffect(() => {
    document.title = 'Storeroom';
  }, []);
  return (
    <>
      <Titlebar />
      <AlertHost />
      <div className="shell">
        {legacy ? (
          <StoreroomApp standalone request={request} onHome={() => setLegacy(false)} homeTitle="Back to the new Storeroom" />
        ) : (
          <StoreroomAlone request={request} onLegacy={() => setLegacy(true)} />
        )}
      </div>
      <Toasts />
    </>
  );
}
