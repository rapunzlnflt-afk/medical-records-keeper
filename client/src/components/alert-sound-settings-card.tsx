import { useMemo, useRef, useState, type ComponentType } from "react";
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

const SOUND_OPTIONS = [
  { value: "soft-chime", label: "Soft Chime", file: "/sounds/soft-chime.mp3" },
  { value: "clear-bell", label: "Clear Bell", file: "/sounds/clear-bell.mp3" },
  { value: "urgent-tone", label: "Urgent Tone", file: "/sounds/urgent-tone.mp3" },
] as const;

type ReminderType = "appointmentsSound" | "medicationsSound" | "vitalsSound";

const rows: Array<{
  key: ReminderType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    key: "appointmentsSound",
    label: "Appointments",
    description: "Reminder date alerts on the dashboard",
    icon: Bell,
  },
  {
    key: "medicationsSound",
    label: "Medications",
    description: "Future medication and refill reminder alerts",
    icon: Pill,
  },
  {
    key: "vitalsSound",
    label: "Vitals",
    description: "Future check-in and logging reminder alerts",
    icon: HeartPulse,
  },
];

export default function AlertSoundSettingsCard() {
  const { activePatientId } = usePatient();
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const { data: prefs } = useQuery<ReminderSoundPreferences>({
    queryKey: ["reminder-sound-preferences", activePatientId],
    queryFn: () => getReminderSoundPreferences(activePatientId),
  });

  const soundFiles: Record<string, string> = useMemo(
    () => ({ "soft-chime": "/sounds/soft-chime.mp3", "clear-bell": "/sounds/clear-bell.mp3", "urgent-tone": "/sounds/urgent-tone.mp3" }),
    [],
  );

  const mutation = useMutation({
    mutationFn: (updates: Partial<ReminderSoundPreferences>) =>
      updateReminderSoundPreferences(activePatientId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminder-sound-preferences", activePatientId] });
    },
  });

  async function previewSound(soundValue: string, label: string) {
    const file = soundFiles[soundValue];
    if (!file) return;

    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      const audio = new Audio(file);
      audioRef.current = audio;
      audio.currentTime = 0;
      await audio.play();
      setStatusMessage(`Playing ${label}.`);
    } catch (error) {
      setStatusMessage("Sound preview was blocked. Tap the button again after interacting with the app.");
      console.error(error);
    }
  }

  if (!prefs) return null;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-cyan-500/5 dark:from-primary/10 dark:to-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-base font-semibold flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-primary" />
          Alert Sounds
        </CardTitle>
        <p className="text-xs text-muted-foreground font-body">
          Choose a saved sound for each reminder type and test it before you rely on it.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/15 bg-card/80 p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Enable alert sounds</p>
            <p className="text-xs text-muted-foreground">
              Sound works best after you test it once on this device.
            </p>
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
              <div
                key={row.key}
                className="rounded-lg border bg-card/90 p-3 shadow-sm"
                data-testid={`sound-row-${row.key}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-white" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">{row.label}</p>
                      <p className="text-xs text-muted-foreground">{row.description}</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Select
                        value={selected}
                        onValueChange={(value) => mutation.mutate({ [row.key]: value } as Partial<ReminderSoundPreferences>)}
                      >
                        <SelectTrigger className="sm:flex-1" data-testid={`select-${row.key}`}>
                          <SelectValue placeholder="Choose a sound" />
                        </SelectTrigger>
                        <SelectContent>
                          {SOUND_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant="default"
                        className="sm:w-auto"
                        onClick={() => previewSound(selected, row.label)}
                        data-testid={`button-test-${row.key}`}
                      >
                        <Volume2 className="w-4 h-4 mr-2" />
                        Test sound
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground font-body">
          {prefs.enabled === 1 ? (
            statusMessage || "Alert sounds are enabled for this patient profile."
          ) : (
            <span className="inline-flex items-center gap-1">
              <VolumeX className="w-3.5 h-3.5" />
              Alert sounds are currently off.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
