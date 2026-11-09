import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router-dom';
import { AuthProvider, homeForRole, useAuth } from './app/AuthContext';
import { GuestRoute, ProtectedRoute } from './app/ProtectedRoute';
import { AppShell } from './app/AppShell';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { OrdersPage } from './pages/admin/OrdersPage';
import { NewOrderPage } from './pages/admin/NewOrderPage';
import { OrderDetailPage } from './pages/admin/OrderDetailPage';
import { InventoryPage } from './pages/admin/InventoryPage';
import { MasterDataPage } from './pages/admin/MasterDataPage';
import { NotificationsPage } from './pages/admin/NotificationsPage';
import { AuditPage } from './pages/admin/AuditPage';
import { ExceptionsPage } from './pages/admin/ExceptionsPage';
import { LogisticsPage } from './pages/tablet/LogisticsPage';
import { ProductionPage } from './pages/tablet/ProductionPage';
import { QcPage } from './pages/tablet/QcPage';
import { PackingPage } from './pages/tablet/PackingPage';
import { TabletExceptionsPage } from './pages/tablet/ExceptionsPage';
import { MessagesPage } from './pages/MessagesPage';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? homeForRole(user.role) : '/login'} replace />;
}

function NotFound() {
  return (
    <div className="not-found">
      <span className="eyebrow">404</span>
      <h1>页面不存在</h1>
      <p>链接可能已失效，或该页面不在当前角色的访问范围内。</p>
      <Link to="/" className="btn btn-primary btn-md">
        返回首页
      </Link>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomeRedirect />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/orders"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <OrdersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/orders/new"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <NewOrderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/orders/:id"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <OrderDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/inventory"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <InventoryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/master"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <MasterDataPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/notifications"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <NotificationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <AuditPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/exceptions"
                element={
                  <ProtectedRoute roles={['ADMIN']}>
                    <ExceptionsPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/tablet/logistics"
                element={
                  <ProtectedRoute roles={['LOGISTICS']}>
                    <LogisticsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tablet/production"
                element={
                  <ProtectedRoute roles={['PRODUCTION']}>
                    <ProductionPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tablet/qc"
                element={
                  <ProtectedRoute roles={['QC']}>
                    <QcPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tablet/packing"
                element={
                  <ProtectedRoute roles={['PACKING']}>
                    <PackingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tablet/exceptions"
                element={
                  <ProtectedRoute roles={['LOGISTICS', 'PRODUCTION', 'QC', 'PACKING']}>
                    <TabletExceptionsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/messages"
                element={
                  <ProtectedRoute>
                    <MessagesPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
