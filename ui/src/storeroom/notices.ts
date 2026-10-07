/**
 * What Social's "Save … to Storeroom" says when it finishes. The save runs in
 * the main process (it needs the app's signed-in session), so the toast comes
 * back as a message to every Axonix window.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { storeroomBackend } from './backend';

export function useStoreroomNotices(open: (id: string) => void) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const offSaved = storeroomBackend.onSaved((n) => {
      toast(n.duplicate ? `Already kept as ${n.id}` : `Kept ${n.id}`, {
        description: n.title,
        action: { label: 'Open', onClick: () => openRef.current(n.id) },
      });
    });
    const offFailed = storeroomBackend.onFailed((f) => toast('Couldn’t save to the Storeroom', { description: f.message }));
    return () => {
      offSaved();
      offFailed();
    };
  }, []);
}
