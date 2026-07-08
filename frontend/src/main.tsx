import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import viVN from 'antd/locale/vi_VN';
import 'dayjs/locale/vi';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { proxyTheme } from './theme/proxyTheme';
import './styles/proxy.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={viVN} theme={proxyTheme}>
      <AntApp>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);