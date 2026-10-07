import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import StoreroomWindow from './storeroom/StoreroomWindow';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/tailwind.css';
import './styles/app.css';
import './styles/finance.css';
import './styles/finance-interactions.css';
import './styles/tasks.css';
import './styles/notes.css';
import './styles/notes-v2.css';
import './styles/calendar.css';
import './styles/social.css';
import './styles/storeroom.css';
import './styles/next.css';
import './styles/next-modules.css';
import './styles/assistant.css';

// `#storeroom` is the Storeroom's own window: only the library, never the other modules.
const storeroomOnly = window.location.hash === '#storeroom';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {storeroomOnly ? <StoreroomWindow /> : <App />}
  </StrictMode>,
);
