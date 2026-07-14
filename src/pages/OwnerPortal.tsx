import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useOwnerScope } from "@/hooks/useOwnerScope";
import { UserMenu } from "@/components/UserMenu";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { OwnerOverviewGrid } from "@/components/owner/OwnerOverviewGrid";
import { OwnerCompareReports } from "@/components/owner/OwnerCompareReports";
import { OwnerGlobalStaff } from "@/components/owner/OwnerGlobalStaff";
import { OwnerConsolidatedReports } from "@/components/owner/OwnerConsolidatedReports";

export default function OwnerPortal() {
  const { isAuthenticated, loading } = useAuth();
  const { isOwnerOfMultiple } = useOwnerScope();
  const navigate = useNavigate();

  useEffect(() => { document.title = "Owner Portal"; }, []);

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isOwnerOfMultiple) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> App
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-5 h-5 text-primary" />
            <h1 className="font-semibold truncate">Owner Portal</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <TenantSwitcher compact />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="staff">Global staff</TabsTrigger>
            <TabsTrigger value="reports">Consolidated reports</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OwnerOverviewGrid /></TabsContent>
          <TabsContent value="compare"><OwnerCompareReports /></TabsContent>
          <TabsContent value="staff"><OwnerGlobalStaff /></TabsContent>
          <TabsContent value="reports"><OwnerConsolidatedReports /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
