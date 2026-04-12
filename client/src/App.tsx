import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/lib/theme";
import { PatientProvider } from "@/lib/patient-context";
import { useIsMobile } from "@/hooks/use-mobile";
import Dashboard from "@/pages/dashboard";
import Appointments from "@/pages/appointments";
import Medications from "@/pages/medications";
import Physicians from "@/pages/physicians";
import MedicalRecords from "@/pages/medical-records";
import Vitals from "@/pages/vitals";
import EmergencyContacts from "@/pages/emergency-contacts";
import Pharmacies from "@/pages/pharmacies";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/appointments" component={Appointments} />
      <Route path="/medications" component={Medications} />
      <Route path="/physicians" component={Physicians} />
      <Route path="/records" component={MedicalRecords} />
      <Route path="/vitals" component={Vitals} />
      <Route path="/emergency" component={EmergencyContacts} />
      <Route path="/pharmacies" component={Pharmacies} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen w-full">
      <AppSidebar />
      <div className="flex flex-col flex-1 min-w-0">
        {isMobile && (
          <header className="flex items-center gap-2 p-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex-1" />
          </header>
        )}
        <main className="flex-1 overflow-auto">
          <AppRouter />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <PatientProvider>
          <TooltipProvider>
            <Router hook={useHashLocation}>
              <SidebarProvider style={style as React.CSSProperties}>
                <AppLayout />
              </SidebarProvider>
            </Router>
            <Toaster />
          </TooltipProvider>
        </PatientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
