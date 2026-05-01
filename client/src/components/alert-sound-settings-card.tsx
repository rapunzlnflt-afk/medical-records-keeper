import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Pill, HeartPulse, Volume2, VolumeX } from "lucide-react";
import type { ReminderSoundPreferences } from "@shared/schema";
import { getReminderSoundPreferences, updateReminderSoundPreferences } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Resolve sound asset URLs against Vite's BASE_URL so they work under
// the GitHub Pages subpath deployment (e.g. /medical-records-keeper/).
const BASE = (import.meta as any).env?.BASE_URL ?? "/";
function soundUrl(name: string) {
  const base = BASE.endsWith("/") ? BASE : BASE + "/";
  return `${base}sounds/${name}`;
}

const SOUND_OPTIONS = [
  { value: "soft-chime", label: "Soft Chime", file: soundUrl("soft-chime.mp3") },
  { value: "clear-bell", label: "Clear Bell", file: soundUrl("clear-bell.mp3") },
  { value: "urgent-tone", label: "Urgent Tone", file: soundUrl("urgent-tone.mp3") },
] as const;

// --- Audio unlock helper ----------------------------------------------
let __audioUnlocked = false;
function installAudioUnlock() {
  if (typeof window === "undefined" || __audioUnlocked) return;
  const unlock = () => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      }
      document.querySelectorAll("audio").forEach((a) => {
        const el = a as HTMLAudioElement;
        el.muted = true;
        el.play().then(() => { el.pause(); el.muted = false; }).catch(() => {});
      });
    } catch {}
    __audioUnlocked = true;
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("click", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("touchstart", unlock, { once: true, passive: true });
  window.addEventListener("click", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

type ReminderType = "appointmentsSound" | "medicationsSound" | "vitalsSound";

const rows: Array<{
  key: ReminderType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { key: "appointmentsSound", label: "Appointments", description: "Reminder date alerts on the dashboard", icon: Bell },
  { key: "medicationsSound", label: "Medications", description: "Future medication and refill reminder alerts", icon: Pill },
  { key: "vitalsSound", label: "Vitals", description: "Future check-in and logging reminder alerts", icon: HeartPulse },
];

export default function AlertSoundSettingsCard() {
  const { activePatientId } = usePatient();
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => { installAudioUnlock(); }, []);

  const { data: prefs } = useQuery({
    queryKey: ["reminder-sound-preferences", activePatientId],
    queryFn: () => getReminderSoundPreferences(activePatientId),
  });

  const soundFiles: Record<string, string> = useMemo(
    () => ({
      "soft-chime": soundUrl("soft-chime.mp3"),
      "clear-bell": soundUrl("clear-bell.mp3"),
      "urgent-tone": soundUrl("urgent-tone.mp3"),
    }),
    [],
  );

  const mutation = useMutation({
    mutationFn: (updates: Partial<ReminderSoundPreferences>) =>
      updateReminderSoundPreferences(activePatientId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-sound-preferences", activePatientId] });
    },
  });

  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  function getAudioContext(): AudioContext | null {
    if (audioContextRef.current) return audioContextRef.current;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    audioContextRef.current = new Ctx();
    return audioContextRef.current;
  }

  async function previewSound(soundValue: string, label: string) {
    const file = soundFiles[soundValue];
    if (!file) return;
    const ctx = getAudioContext();
    if (!ctx) {
      try {
        const audio = new Audio(file);
        await audio.play();
        setStatusMessage(`Playing ${label}.`);
      } catch {
        setStatusMessage("Sound preview was blocked. Tap the button again after interacting with the app.");
      }
      return;
    }
    try {
      if (ctx.state === "suspended") await ctx.resume();
      let buffer = audioBuffersRef.current[soundValue];
      if (!buffer) {
        const resp = await fetch(file);
        if (!resp.ok) throw new Error(`Failed to load ${file}: ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();
        buffer = await new Promise<AudioBuffer>((resolve, reject) =>
          ctx.decodeAudioData(arrayBuf, resolve, reject)
        );
        audioBuffersRef.current[soundValue] = buffer;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      setStatusMessage(`Playing ${label}.`);
    } catch (error) {
      console.error(error);
      try {
        const audio = new Audio(file);
        await audio.play();
        setStatusMessage(`Playing ${label}.`);
      } catch {
        setStatusMessage("Sound preview was blocked. Tap the button again after interacting with the app.");
      }
    }
  }

  if (!prefs) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-primary" />
          Alert Sounds
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose a saved sound for each reminder type and test it before you rely on it.
        </p>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="font-medium">Enable alert sounds</p>
            <p className="text-xs text-muted-foreground">Sound works best after you test it once on this device.</p>
          </div>
          <Switch
            checked={prefs.enabled === 1}
            onCheckedChange={(checked) => mutation.mutate({ enabled: checked ? 1 : 0 })}
            data-testid="switch-enable-alert-sounds"
          />
        </div>
        <div className="space-y-3">
          {rows.map((row) => {
            const Icon = row.icon;
            const selected = prefs[row.key];
            return (
              <div key={row.key} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.description}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={selected}
                    onValueChange={(value) => mutation.mutate({ [row.key]: value } as Partial<ReminderSoundPreferences>)}
                  >
                    <SelectTrigger className="sm:flex-1" data-testid={`select-${row.key}`}>
                      <SelectValue placeholder="Choose a sound" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOUND_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => previewSound(selected, row.label)}
                    data-testid={`button-test-${row.key}`}
                  >
                    Test sound
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {prefs.enabled === 1 ? (
            statusMessage || "Alert sounds are enabled for this patient profile."
          ) : (
            <span className="inline-flex items-center gap-1"><VolumeX className="h-3.5 w-3.5" /> Alert sounds are currently off.</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
