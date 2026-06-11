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
import RequestVacationPage from "./pages/RequestVacationPage";
import MyVacationRequestsPage from "./pages/MyVacationRequestsPage";
import OnCallPage from "./pages/OnCallPage";
import OnCallAdminPage from "./pages/OnCallAdminPage";
import OnCallManagerPage from "./pages/OnCallManagerPage";
import PidTuningPage from "./pages/PidTuningPage";
import TwilioPage from "./pages/TwilioPage";
import DispatchPage from "./pages/DispatchPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import PropertiesPage from "./pages/PropertiesPage";
import PropertyDetailPage from "./pages/PropertyDetailPage";
import VendorsPage from "./pages/VendorsPage";
import PricebookPage from "./pages/PricebookPage";
import JobDetailPage from "./pages/JobDetailPage";
import VisitDetailPage from "./pages/VisitDetailPage";
import PayrollPage from "./pages/PayrollPage";
import LaborRatesPage from "./pages/LaborRatesPage";
import OperationsJobsPage from "./pages/OperationsJobsPage";
import OperationsQuotesPage from "./pages/OperationsQuotesPage";
import OperationsPurchaseOrdersPage from "./pages/OperationsPurchaseOrdersPage";
import OperationsReceiptsBillsPage from "./pages/OperationsReceiptsBillsPage";
import PODetailPage from "./pages/PODetailPage";
import ImportJobsPage from "./pages/ImportJobsPage";
import Nav from "./components/Nav";
import { ToastProvider } from "./components/Toast";
import Spinner from "./components/Spinner";

function RequireAuth({ children }: { children: JSX.Element }) {
  const [user, setUser] = useState<User | null | "loading">("loading");
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    // Auto-link: if a Firestore doc has this email but empty uid, fill it in
    if (u?.email) {
      try {
        const { getDocs, collection, query, where, doc, updateDoc } = await import("firebase/firestore");
        const { db } = await import("./firebase");
        const snap = await getDocs(query(collection(db, "users"), where("email", "==", u.email), where("uid", "==", "")));
        for (const d of snap.docs) {
          await updateDoc(doc(db, "users", d.id), { uid: u.uid });
        }
      } catch {}
    }
  }), []);
  if (user === "loading") return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

import { useLocation } from "react-router-dom";

function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const fullWidth = pathname.startsWith("/dispatch") || pathname.startsWith("/on-call") || pathname.startsWith("/time-off") || pathname.startsWith("/customers") || pathname.startsWith("/properties") || pathname.startsWith("/vendors") || pathname.startsWith("/pricebook") || pathname.startsWith("/jobs") || pathname.startsWith("/accounting") || pathname.startsWith("/operations") || pathname.startsWith("/purchase-orders") || pathname.startsWith("/import");
  return (
    <>
      <Nav />
      <div className="page-content" style={{ padding: fullWidth ? "0" : "24px 32px", maxWidth: fullWidth ? "100%" : 1100, margin: "0 auto" }}>
        {children}
      </div>
    </>
  );
}

// Redirect OAuth callback code to the On-Call page; otherwise go to dashboard
function OAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("code")) {
    window.location.replace(`/on-call${window.location.search}`);
    return null;
  }
  return <Navigate to="/dashboard" replace />;
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
                <AppLayout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<DashboardPage />} />
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
                      <Route path="/time-off/request" element={<RequestVacationPage />} />
                      <Route path="/time-off/my-requests" element={<MyVacationRequestsPage />} />
                      <Route path="/on-call" element={<OnCallManagerPage />} />
                      <Route path="/on-call/admin" element={<OnCallManagerPage adminMode={true} />} />
                      <Route path="/on-call/legacy" element={<OnCallPage />} />
                      <Route path="/on-call/manage" element={<OnCallAdminPage />} />
                      <Route path="/pid-tuning" element={<PidTuningPage />} />
                      <Route path="/twilio" element={<TwilioPage />} />
                      <Route path="/dispatch" element={<DispatchPage />} />
                      <Route path="/customers" element={<CustomersPage />} />
                      <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
                      <Route path="/properties" element={<PropertiesPage />} />
                      <Route path="/properties/:propertyId" element={<PropertyDetailPage />} />
                      <Route path="/vendors" element={<VendorsPage />} />
                      <Route path="/pricebook" element={<PricebookPage />} />
                      <Route path="/jobs/:jobId" element={<JobDetailPage />} />
                      <Route path="/jobs/:jobId/visits/:visitId" element={<VisitDetailPage />} />
                      <Route path="/accounting/payroll" element={<PayrollPage />} />
                      <Route path="/accounting/labor-rates" element={<LaborRatesPage />} />
                      <Route path="/operations/jobs" element={<OperationsJobsPage />} />
                      <Route path="/operations/quotes" element={<OperationsQuotesPage />} />
                      <Route path="/operations/purchase-orders" element={<OperationsPurchaseOrdersPage />} />
                      <Route path="/purchase-orders/:poId" element={<PODetailPage />} />
                      <Route path="/operations/receipts-bills" element={<OperationsReceiptsBillsPage />} />
                      <Route path="/import/jobs" element={<ImportJobsPage />} />
                    </Routes>
                </AppLayout>
              </RequireAuth>
            }
          />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
