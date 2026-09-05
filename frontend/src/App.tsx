import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { api } from "./api/client";
import Header from "./components/Header";
import Advisor from "./components/Advisor";
import BottomNav from "./components/BottomNav";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import Profile from "./pages/Profile";
import ComingSoon from "./pages/ComingSoon";
import Lab from "./pages/Lab";
import Status from "./pages/Status";

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
      <Advisor />
      <BottomNav />
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
        <Route path="lab" element={<Lab />} />
        <Route path="status" element={<Status />} />
        <Route path="soon/:name" element={<ComingSoon />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
