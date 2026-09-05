import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { api } from "./api/client";
import Header from "./components/Header";
import Assistant from "./components/Assistant";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import Profile from "./pages/Profile";

function ProtectedLayout() {
  const { loading } = useAuth();
  if (!api.getToken()) return <Navigate to="/login" replace />;
  if (loading) return null;
  return (
    <>
      <Header />
      <main className="container">
        <Outlet />
      </main>
      <Assistant />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="accounts/:id" element={<AccountDetail />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
