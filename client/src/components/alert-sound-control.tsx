import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Volume2, VolumeX } from "lucide-react";
import type { ReminderSoundPreferences } from "@shared/schema";
import { getReminderSoundPreferences, updateReminderSoundPreferences } from "@/lib/db";
import { usePatient } from "@/lib/patient-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const SOUND_PLAY_FRACTION: Record<string, number> = { "urgent-tone": 0.5 };

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
        src.buffer = buf; src.connect(ctx.destination); src.start(0);
      }
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

interface AlertSoundControlProps {
  reminderType: ReminderType;
  label?: string;
}

export default function AlertSoundControl({ reminderType, label = "Alert sound" }: AlertSoundControlProps) {
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

  function playHtmlAudio(file: string, soundValue: string) {
    const audio = new Audio(file);
    const fraction = SOUND_PLAY_FRACTION[soundValue];
    if (fraction && fraction > 0 && fraction < 1) {
      const onLoaded = () => {
        const stopAt = audio.duration * fraction;
        const onTime = () => {
          if (audio.currentTime >= stopAt) {
            audio.pause();
            audio.removeEventListener("timeupdate", onTime);
          }
        };
        audio.addEventListener("timeupdate", onTime);
      };
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    }
    return audio.play();
  }

  async function previewSound(soundValue: string) {
    const file = soundFiles[soundValue];
    if (!file) return;
    const ctx = getAudioContext();
    if (!ctx) {
      try { await playHtmlAudio(file, soundValue); setStatusMessage("Playing."); }
      catch { setStatusMessage("Sound preview was blocked. Tap again after interacting with the app."); }
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
      const fraction = SOUND_PLAY_FRACTION[soundValue];
      if (fraction && fraction > 0 && fraction < 1) {
        try { source.stop(ctx.currentTime + buffer.duration * fraction); } catch {}
      }
      setStatusMessage("Playing.");
    } catch (error) {
      console.error(error);
      try { await playHtmlAudio(file, soundValue); setStatusMessage("Playing."); }
      catch { setStatusMessage("Sound preview was blocked. Tap again after interacting with the app."); }
    }
  }

  if (!prefs) return null;

  const selected = prefs[reminderType];
  const enabled = prefs.enabled === 1;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        {enabled ? (
          <Volume2 className="mt-0.5 h-5 w-5 text-primary" />
        ) : (
          <VolumeX className="mt-0.5 h-5 w-5 text-muted-foreground" />
        )}
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? (statusMessage || "Choose a sound and test it on this device.")
              : "Alert sounds are off. Toggle to enable."}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => mutation.mutate({ enabled: checked ? 1 : 0 })}
            data-testid={`switch-enable-${reminderType}`}
          />
          <span className="text-xs text-muted-foreground">{enabled ? "On" : "Off"}</span>
        </div>
        <Select
          value={selected}
          onValueChange={(value) => mutation.mutate({ [reminderType]: value } as Partial<ReminderSoundPreferences>)}
        >
          <SelectTrigger className="sm:w-[160px]" data-testid={`select-${reminderType}`}>
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
          onClick={() => previewSound(selected)}
          data-testid={`button-test-${reminderType}`}
        >
          Test sound
        </Button>
      </div>
    </div>
  );
}
