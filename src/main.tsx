import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {initScreenWakeLock} from './utils/screenWakeLock.ts'
import './index.css';

initScreenWakeLock();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
