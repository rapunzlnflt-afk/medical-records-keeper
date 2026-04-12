import { useState, useRef } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Pill,
  Stethoscope,
  FileText,
  HeartPulse,
  Phone,
  Building2,
  Sun,
  Moon,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/lib/theme";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Appointments", url: "/appointments", icon: CalendarDays },
  { title: "Medications", url: "/medications", icon: Pill },
  { title: "Physicians", url: "/physicians", icon: Stethoscope },
  { title: "Medical Records", url: "/records", icon: FileText },
  { title: "Vitals", url: "/vitals", icon: HeartPulse },
  { title: "Pharmacies", url: "/pharmacies", icon: Building2 },
  { title: "Emergency Contacts", url: "/emergency", icon: Phone },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const { toast } = useToast();
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSaveData = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("GET", "/api/backup/export");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medical-records-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Data Saved", description: "Your backup file has been downloaded." });
    } catch {
      toast({ title: "Error", description: "Could not save data. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version) throw new Error("Invalid backup file");
      await apiRequest("POST", "/api/backup/import", data);
      // Refresh all queries so the UI updates
      await queryClient.invalidateQueries();
      toast({ title: "Data Loaded", description: "Your records have been restored." });
    } catch {
      toast({ title: "Error", description: "Could not load data. Make sure you selected a valid backup file.", variant: "destructive" });
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L12 6M12 18L12 22M6 12H2M22 12H18" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              <rect x="7" y="7" width="10" height="10" rx="2" stroke="white" strokeWidth="2" fill="none"/>
              <path d="M10 12H14M12 10V14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-sm font-bold text-sidebar-foreground leading-tight truncate">
              Medical Records
            </h1>
            <p className="text-xs text-muted-foreground leading-tight">Keeper</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-heading text-xs font-semibold uppercase tracking-wider">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className={
                        isActive
                          ? "gradient-primary text-white font-semibold"
                          : ""
                      }
                    >
                      <Link
                        href={item.url}
                        data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => { if (isMobile) setOpenMobile(false); }}
                      >
                        <item.icon className="w-4 h-4" />
                        <span className="font-body text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 border-t border-sidebar-border space-y-2">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveData}
            disabled={saving}
            className="flex-1 gap-1 font-body text-[11px] px-2"
            data-testid="button-save-data"
          >
            <Download className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{saving ? "Saving..." : "Save My Data"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="flex-1 gap-1 font-body text-[11px] px-2"
            data-testid="button-load-data"
          >
            <Upload className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{loading ? "Loading..." : "Load My Data"}</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleLoadData}
            className="hidden"
            data-testid="input-load-file"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={toggle}
          className="w-full gap-2 font-body text-xs"
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
