import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { TopBar } from './components/layout/TopBar';
import { LoginPage } from './components/login/LoginPage';
import { HomePage } from './components/home/HomePage';
import { EVA } from './components/eva/EVA';
import { Toast } from './components/common/Toast';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { EstimatesPanel } from './components/estimates/EstimatesPanel';
import { CAPABILITIES } from './constants/capabilities';
import { useEVA } from './hooks/useEVA';
import KnowledgeHubPage from './pages/KnowledgeHubPage';
import { ROICostCalculatorPage } from './pages/ROICostCalculatorPage';
import { OracleFusionEstimatorPage } from './pages/OracleFusionEstimatorPage';
import './styles/eva.css';

// EVA only exists once authenticated — useEVA() reads RoleContext's
// currentRole (for the role-scoped greeting/suggestions), which is null
// pre-login, and there's no meaningful assistant to show on the login
// screen anyway. Nesting <Routes> here is a standard v6 pattern for a
// "everything past this point requires auth" wildcard branch.
function AuthenticatedApp() {
  const evaState = useEVA();
  const [manageUsersOpen, setManageUsersOpen] = useState(false);
  const [estimatesOpen, setEstimatesOpen] = useState(false);

  const handleLockedCardClick = (cardTitle) => {
    evaState.sendRestrictedMessage(cardTitle);
  };

  return (
    <>
      <Routes>
        <Route
          path="/home"
          element={
            <>
              <TopBar
                manageUsersOpen={manageUsersOpen}
                setManageUsersOpen={setManageUsersOpen}
                onOpenEstimates={() => setEstimatesOpen(true)}
              />
              <HomePage
                onLockedCardClick={handleLockedCardClick}
                onManageUsers={() => setManageUsersOpen(true)}
                onOpenEstimates={() => setEstimatesOpen(true)}
              />
            </>
          }
        />
        <Route
          path="/estimate/guide"
          element={
            <>
              <TopBar
                manageUsersOpen={manageUsersOpen}
                setManageUsersOpen={setManageUsersOpen}
                onOpenEstimates={() => setEstimatesOpen(true)}
              />
              <KnowledgeHubPage />
            </>
          }
        />
        <Route
          path="/estimate/roi-cost"
          element={
            <>
              <TopBar
                manageUsersOpen={manageUsersOpen}
                setManageUsersOpen={setManageUsersOpen}
                onOpenEstimates={() => setEstimatesOpen(true)}
              />
              <ROICostCalculatorPage />
            </>
          }
        />
        <Route
          path="/estimate/create"
          element={
            <ProtectedRoute requires={CAPABILITIES.ESTIMATE_RUN}>
              <TopBar
                manageUsersOpen={manageUsersOpen}
                setManageUsersOpen={setManageUsersOpen}
                onOpenEstimates={() => setEstimatesOpen(true)}
              />
              <OracleFusionEstimatorPage onOpenMyEstimates={() => setEstimatesOpen(true)} />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>

      {/* Global overlays — present on every authenticated route */}
      {estimatesOpen && <EstimatesPanel onClose={() => setEstimatesOpen(false)} />}
      <EVA evaStateOverride={evaState} />
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AuthenticatedApp />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
