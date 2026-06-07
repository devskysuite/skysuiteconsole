import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import Login from "./pages/Login";
import DashboardPage from "./pages/DashboardPage";
import ToolsPage from "./pages/ToolsPage";
import ToolDetailPage from "./pages/ToolDetailPage";
import AddToolPage from "./pages/AddToolPage";
import PrintLabelPage from "./pages/PrintLabelPage";
import UsersPage from "./pages/UsersPage";
import BookingsPage from "./pages/BookingsPage";
import CategoriesPage from "./pages/CategoriesPage";
import RepairContactsPage from "./pages/RepairContactsPage";
import ContactsPage from "./pages/ContactsPage";
import VehiclesPage from "./pages/VehiclesPage";
import AddVehiclePage from "./pages/AddVehiclePage";
import VehicleDetailPage from "./pages/VehicleDetailPage";
import TimeOffPage from "./pages/TimeOffPage";
import TimeOffApprovalsPage from "./pages/TimeOffApprovalsPage";
import OnCallPage from "./pages/OnCallPage";
import OnCallAdminPage from "./pages/OnCallAdminPage";
import OnCallManagerPage from "./pages/OnCallManagerPage";
import PidTuningPage from "./pages/PidTuningPage";
import Nav from "./components/Nav";
import { ToastProvider } from "./components/Toast";
import Spinner from "./components/Spinner";

function RequireAuth({ children }: { children: JSX.Element }) {
  const [user, setUser] = useState<User | null | "loading">("loading");
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === "loading") return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Redirect OAuth callback code to the On-Call page
function OAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("code")) {
    window.location.replace(`/on-call${window.location.search}`);
    return null;
  }
  return <Navigate to="/on-call" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<OAuthRedirect />} />
          <Route path="/tools/:toolId/print" element={<PrintLabelPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <>
                  <Nav />
                  <div className="page-content" style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
                    <Routes>
                      <Route path="/" element={<DashboardPage />} />
                      <Route path="/tools" element={<ToolsPage />} />
                      <Route path="/tools/new" element={<AddToolPage />} />
                      <Route path="/tools/:toolId" element={<ToolDetailPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/bookings" element={<BookingsPage />} />
                      <Route path="/categories" element={<CategoriesPage />} />
                      <Route path="/contacts" element={<ContactsPage />} />
                      <Route path="/vehicles" element={<VehiclesPage />} />
                      <Route path="/vehicles/new" element={<AddVehiclePage />} />
                      <Route path="/vehicles/:vehicleId" element={<VehicleDetailPage />} />
                      <Route path="/repair-contacts" element={<RepairContactsPage />} />
                      <Route path="/time-off" element={<TimeOffPage />} />
                      <Route path="/time-off/approvals" element={<TimeOffApprovalsPage />} />
                      <Route path="/on-call" element={<OnCallManagerPage />} />
                      <Route path="/on-call/legacy" element={<OnCallPage />} />
                      <Route path="/on-call/manage" element={<OnCallAdminPage />} />
                      <Route path="/pid-tuning" element={<PidTuningPage />} />
                    </Routes>
                  </div>
                </>
              </RequireAuth>
            }
          />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
