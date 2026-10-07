import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SocialApp from './SocialApp';
import '../styles/tokens.css';
import '../styles/fonts.css';
import '../styles/social.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SocialApp />
  </StrictMode>,
);
