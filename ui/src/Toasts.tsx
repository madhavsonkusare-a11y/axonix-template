/**
 * The toast host, shared by the Axonix window and the Storeroom's own window,
 * so both speak with the same bottom-centre, Undo-carrying toasts.
 */
import { Toaster } from 'sonner';

export default function Toasts() {
  return (
    <Toaster
      position="bottom-center"
      theme="dark"
      duration={5000}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'fin-toast',
          title: 'fin-toast__title',
          description: 'fin-toast__desc',
          actionButton: 'fin-toast__action',
          cancelButton: 'fin-toast__action fin-toast__action--quiet',
        },
      }}
    />
  );
}
