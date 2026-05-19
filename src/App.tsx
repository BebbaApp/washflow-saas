import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CurrencyProvider } from "@/hooks/useCurrency";
import { TenantProvider } from "@/hooks/useTenant";
import { LicenseGate } from "@/components/LicenseGate";
import { useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const GatedRoutes = () => {
  const { isAuthenticated } = useAuth();
  const routes = (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
  // Only gate when authenticated; login/reset/invite pages render freely.
  return isAuthenticated ? <LicenseGate>{routes}</LicenseGate> : routes;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TenantProvider>
      <CurrencyProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <GatedRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </CurrencyProvider>
    </TenantProvider>
  </QueryClientProvider>
);

export default App;
