import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { CurrencyProvider } from "@/hooks/useCurrency";
import { TenantProvider } from "@/hooks/useTenant";
import { LicenseGate } from "@/components/LicenseGate";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import AuthCallback from "./pages/AuthCallback";
import Platform from "./pages/Platform";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

// Use HashRouter in Electron (file://), BrowserRouter on the web
const isElectron = typeof window !== "undefined" && window.location.protocol === "file:";
const Router = isElectron ? HashRouter : BrowserRouter;

const GatedRoutes = () => {
  const { isAuthenticated } = useAuth();
  const isPlatformRoute = typeof window !== "undefined" && window.location.hash.includes("/platform");
  const routes = (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/login" element={<Index />} />
      <Route path="/signup" element={<Index />} />
      <Route path="/settings" element={<Navigate to="/?tab=settings" replace />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/platform" element={<Platform />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
  return isAuthenticated && !isPlatformRoute ? <LicenseGate>{routes}</LicenseGate> : routes;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TenantProvider>
        <CurrencyProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Router>
              <GatedRoutes />
            </Router>
          </TooltipProvider>
        </CurrencyProvider>
      </TenantProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
