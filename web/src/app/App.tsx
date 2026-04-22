import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';
import { AppShell } from './AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LearningPage } from '@/pages/LearningPage';
import { JobsPage } from '@/pages/JobsPage';
import { TodosPage } from '@/pages/TodosPage';
import { FinancePage } from '@/pages/FinancePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
      <Route element={<AuthGuard><AppShell /></AuthGuard>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/learning" element={<LearningPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
