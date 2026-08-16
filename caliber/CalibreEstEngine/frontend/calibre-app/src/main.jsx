import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { RoleProvider } from './contexts/RoleContext';
import { EstimatorContextProvider } from './contexts/EstimatorContextProvider';
import App from './App';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <RoleProvider>
        <EstimatorContextProvider>
          <App />
        </EstimatorContextProvider>
      </RoleProvider>
    </BrowserRouter>
  </StrictMode>
);
