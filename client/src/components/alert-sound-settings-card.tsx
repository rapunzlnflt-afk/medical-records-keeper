import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, HeartPulse, Pill, Volume2, VolumeX } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ReminderSoundPreferences } from "@shared/schema";

type AlertSoundSettingsCardProps = {
  patientId: number;
  className?: string;
};

const SOUND_OPTIONS = [
  { value: "chime", label: "Chime" },
  { value: "ding", label: "Ding" },
  { value: "soft-bell", label: "Soft Bell" },
  { value: "pulse", label: "Pulse" },
] as const;

type ReminderSoundKey = "appointmentsSound" | "medicationsSound" | "vitalsSound";
type ReminderEnabledKey = "appointmentsEnabled" | "medicationsEnabled" | "vitalsEnabled";

const rows: Array<{
  soundKey: ReminderSoundKey;
  enabledKey: ReminderEnabledKey;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    soundKey: "appointmentsSound",
    enabledKey: "appointmentsEnabled",
    label: "Appointments",
    description: "Reminder date alerts on the dashboard",
    icon: Bell,
  },
  {
    soundKey: "medicationsSound",
    enabledKey: "medicationsEnabled",
    label: "Medications",
    description: "Future medication and refill reminder alerts",
    icon: Pill,
  },
  {
    soundKey: "vitalsSound",
    enabledKey: "vitalsEnabled",
    label: "Vitals",
    description: "Future check-in and logging reminder alerts",
    icon: HeartPulse,
  },
];

const DEFAULT_PREFERENCES: ReminderSoundPreferences = {
  patientId: 0,
  appointmentsEnabled: 0,
  appointmentsSound: "chime",
  medicationsEnabled: 0,
  medicationsSound: "ding",
  vitalsEnabled: 0,
  vitalsSound: "soft-bell",
};

function playPreviewSound(_sound: string) {
  const audio = new Audio("/sounds/notification.mp3");
  audio.volume = 0.7;
  audio.play().catch(() => {});
}

export function AlertSoundSettingsCard({
  patientId,
  className,
}: AlertSoundSettingsCardProps) {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState("");
  const statusTimeoutRef = useRef<number | null>(null);

  const { data } = useQuery<ReminderSoundPreferences>({
    queryKey: ["/api/patients", patientId, "reminder-sound-preferences"],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/reminder-sound-preferences`, {
        credentials: "include",
      });

      if (!res.ok) {
        return {
          ...DEFAULT_PREFERENCES,
          patientId,
        };
      }

      const json = await res.json();
      return {
        ...DEFAULT_PREFERENCES,
        ...json,
        patientId,
      };
    },
  });

  const prefs = useMemo(
    () => ({
      ...DEFAULT_PREFERENCES,
      ...data,
      patientId,
    }),
    [data, patientId],
  );

  const mutation = useMutation({
    mutationFn: async (updates: Partial<ReminderSoundPreferences>) => {
      const response = await apiRequest(
        "PATCH",
        `/api/patients/${patientId}/reminder-sound-preferences`,
        updates,
      );
      return response.json();
    },
    onSuccess: (updated: ReminderSoundPreferences) => {
      queryClient.setQueryData(
        ["/api/patients", patientId, "reminder-sound-preferences"],
        updated,
      );
      setStatusMessage("Alert sound settings saved.");
    },
  });

  useEffect(() => {
    if (!statusMessage) return;

    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current);
    }

    statusTimeoutRef.current = window.setTimeout(() => {
      setStatusMessage("");
      statusTimeoutRef.current = null;
    }, 2500);

    return () => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
    };
  }, [statusMessage]);

  const previewSound = (sound: string, label: string) => {
    playPreviewSound(sound);
    setStatusMessage(`Previewing ${label.toLowerCase()} sound.`);
  };

  const enabledCount = rows.filter((row) => prefs[row.enabledKey] === 1).length;
  const totalCount = rows.length;

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabledCount > 0 ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          Alert sounds
        </CardTitle>
        <CardDescription>
          Choose which reminder types play sounds for this patient profile.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-3">
          {rows.map((row) => {
            const Icon = row.icon;
            const selected = prefs[row.soundKey];
            const isEnabled = prefs[row.enabledKey] === 1;

            return (
              <div key={row.soundKey} className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">{row.label}</p>
                      <p className="text-xs text-muted-foreground">{row.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {isEnabled ? "On" : "Off"}
                    </span>
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={(checked) =>
                        mutation.mutate({
                          [row.enabledKey]: checked ? 1 : 0,
                        } as Partial<ReminderSoundPreferences>)
                      }
                      data-testid={`switch-${row.enabledKey}`}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={selected}
                    onValueChange={(value) =>
                      mutation.mutate({
                        [row.soundKey]: value,
                      } as Partial<ReminderSoundPreferences>)
                    }
                    disabled={!isEnabled}
                  >
                    <SelectTrigger
                      className="sm:flex-1"
                      data-testid={`select-${row.soundKey}`}
                    >
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
                    variant="outline"
                    disabled={!isEnabled}
                    onClick={() => previewSound(selected, row.label)}
                    data-testid={`button-test-${row.soundKey}`}
                  >
                    Test sound
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {statusMessage || (
            enabledCount > 0 ? (
              `Alert sounds are enabled for ${enabledCount} of ${totalCount} reminder types.`
            ) : (
              <span className="inline-flex items-center gap-1">
                <VolumeX className="h-3.5 w-3.5" />
                Alert sounds are currently off for all reminder types.
              </span>
            )
          )}
        </p>
      </CardContent>
    </Card>
  );
}
