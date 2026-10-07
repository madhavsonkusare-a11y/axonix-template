import { useTasks } from '../../tasks/TasksContext';

/** Speaks only when saving a task fails, as the first Tasks' rail did. A working save is silent. */
export default function SaveNotice() {
  const { save, loadError, loading, retry } = useTasks();
  if (loading) return null;
  if (loadError) {
    return (
      <span className="nx-save" title={loadError}>
        <span className="fin-dot" /> Not saving this session
      </span>
    );
  }
  if (save.state === 'error') {
    return (
      <span className="nx-save" title={save.message}>
        <span className="fin-dot" /> Last change not saved
        <button type="button" className="fin-link" onClick={retry}>
          Try again
        </button>
      </span>
    );
  }
  return null;
}
