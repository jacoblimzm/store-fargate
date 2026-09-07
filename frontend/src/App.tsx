import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { api } from "./api/client";
import { startRumView } from "./observability/rum";
import Header from "./components/Header";
import Advisor from "./components/Advisor";
import BottomNav from "./components/BottomNav";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import Profile from "./pages/Profile";
import Contacts from "./pages/Contacts";
import Receive from "./pages/Receive";
import ComingSoon from "./pages/ComingSoon";
import Lab from "./pages/Lab";
import Status from "./pages/Status";
import SendLayout from "./pages/send/SendLayout";
import SendRecipient from "./pages/send/SendRecipient";
import SendAmount from "./pages/send/SendAmount";
import SendConfirm from "./pages/send/SendConfirm";

// Map a pathname to a stable RUM view name so Journey Monitoring sees clean,
// per-route views (multi-step Send stays legible as distinct steps).
function viewName(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/accounts/")) return "Account detail";
  if (pathname.startsWith("/soon/")) return "Coming soon";
  const map: Record<string, string> = {
    "/login": "Login",
    "/signup": "Sign up",
    "/profile": "Profile",
    "/contacts": "Contacts",
    "/receive": "Receive",
    "/lab": "Observability Lab",
    "/status": "Datadog Status",
    "/send/recipient": "Send · Recipient",
    "/send/amount": "Send · Amount",
    "/send/confirm": "Send · Confirm",
  };
  return map[pathname] || pathname;
}

function RouteViews() {
  const { pathname } = useLocation();
  useEffect(() => {
    startRumView(viewName(pathname));
  }, [pathname]);
  return null;
}

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
    <>
      <RouteViews />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="receive" element={<Receive />} />
          <Route path="lab" element={<Lab />} />
          <Route path="status" element={<Status />} />
          <Route path="send" element={<SendLayout />}>
            <Route index element={<Navigate to="recipient" replace />} />
            <Route path="recipient" element={<SendRecipient />} />
            <Route path="amount" element={<SendAmount />} />
            <Route path="confirm" element={<SendConfirm />} />
          </Route>
          <Route path="soon/:name" element={<ComingSoon />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
