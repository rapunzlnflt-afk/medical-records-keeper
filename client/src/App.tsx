import { Switch, Route, Router } from "wouter";
import { VerseFooter } from "@/components/verse-footer";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { PurchaseGate } from "@/components/purchase-gate";
import { ThemeProvider } from "@/lib/theme";
import { PatientProvider } from "@/lib/patient-context";
import { useIsMobile } from "@/hooks/use-mobile";
import Dashboard from "@/pages/dashboard";
import Profile from "@/pages/profile";
import Appointments from "@/pages/appointments";
import Medications from "@/pages/medications";
import MedicationHistory from "@/pages/medication-history";
import DoseConfirm from "@/pages/dose-confirm";
import Physicians from "@/pages/physicians";
import MedicalRecords from "@/pages/medical-records";
import Vitals from "@/pages/vitals";
import EmergencyContacts from "@/pages/emergency-contacts";
import Pharmacies from "@/pages/pharmacies";
import Notes from "@/pages/notes";
import Timeline from "@/pages/timeline";
import MaxPage from "@/pages/max";
import CareLog from "@/pages/care-log";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { syncCaregiverDoses } from "@/lib/caregiver-share";
import { syncAllOwnerEntries, syncCareEntries, syncCarePeople } from "@/lib/care-share";
import { hasCare } from "@/lib/care-plan";

/** Copies settled caregiver doses into the local history on open and on return. */
function useCaregiverDoseSync() {
  useEffect(() => {
    const run = () => {
      syncCaregiverDoses()
        .then((n) => {
          if (n > 0) queryClient.invalidateQueries({ queryKey: ["medication-logs"] });
        })
        .catch(() => {});
      // MedRecords Care: settled caregiver care-log entries.
      if (hasCare()) {
        syncCarePeople()
          .then(() => syncAllOwnerEntries())
          .catch(() => {});
        syncCareEntries()
          .then((n) => {
            if (n > 0) queryClient.invalidateQueries({ queryKey: ["care-entries"] });
          })
          .catch(() => {});
      }
    };
    run();
    const onVis = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(run, 10 * 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(t);
    };
  }, []);
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/profile" component={Profile} />
      <Route path="/appointments/:aptId" component={Appointments} />
      <Route path="/appointments" component={Appointments} />
      {/* Landing target for a dose notification. Kept above /medications/:id
          so an event id is never read as a medication id. */}
      <Route path="/dose/:eventId" component={DoseConfirm} />
      <Route path="/medications/:id" component={MedicationHistory} />
      <Route path="/medications" component={Medications} />
      <Route path="/physicians" component={Physicians} />
      <Route path="/records/:recordId" component={MedicalRecords} />
      <Route path="/records" component={MedicalRecords} />
      <Route path="/vitals" component={Vitals} />
      <Route path="/emergency" component={EmergencyContacts} />
      <Route path="/pharmacies" component={Pharmacies} />
      <Route path="/notes" component={Notes} />
      <Route path="/care" component={CareLog} />
      <Route path="/timeline" component={Timeline} />
      <Route path="/max" component={MaxPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const isMobile = useIsMobile();
  useCaregiverDoseSync();

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AppSidebar />
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        {isMobile && (
         <header
           // Mirrors Pawfolio's mobile top bar: pinned, 56px tall, 22px bold
           // title, app icon on the right. iPhone Safari treats a fixed top bar
           // as a toolbar and carries its color behind the status bar, so the
           // title is never blurred while the page scrolls.
           className="fixed top-0 inset-x-0 h-[56px] flex items-center gap-[12px] px-[16px] gradient-primary text-white border-b border-white/15 z-40"
         >
  <SidebarTrigger
    data-testid="button-sidebar-toggle"
    className="h-[40px] w-[40px] text-white hover:bg-white/15 hover:text-white [&_svg]:!h-[26px] [&_svg]:!w-[26px] [&_svg]:stroke-[3]"
  />
  <span className="flex-1 pl-[4px] font-heading text-[22px] leading-none font-bold text-white">
    MedRecords
  </span>
  <img
    src={`${import.meta.env.BASE_URL}icon-192.png`}
    alt=""
    className="h-[40px] w-[40px] shrink-0 rounded-[8px] bg-white p-[1px] shadow-[0_2px_6px_rgba(0,0,0,0.15)]"
  />
</header>
        )}
        {/* Holds the space the pinned band covers. */}
        {isMobile && <div className="h-[56px] shrink-0" aria-hidden="true" />}
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 flex flex-col">
          <div className="flex-1">
            <AppRouter />
          </div>
          <VerseFooter />
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
      <PurchaseGate>
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
      </PurchaseGate>
    </ThemeProvider>
  );
}
