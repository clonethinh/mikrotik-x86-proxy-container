import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast } from '@heroui/react';
import App from './App';
import MotionProvider from './components/MotionProvider';
import './globals.css';

document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <Toast.Provider placement="top" />
      <App />
    </MotionProvider>
  </StrictMode>,
);