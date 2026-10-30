// Who a screen is about. Used wherever something is shared with caregivers,
// so the owner can tell family members apart at a glance (color, initials,
// full name and relationship) before sharing.

import type { Patient } from "@shared/schema";

export function PersonAvatar({ patient, size = "md" }: { patient: Patient; size?: "xs" | "sm" | "md" }) {
  const s = size === "xs" ? "w-5 h-5 text-[10px]" : size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  const initials = patient.name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className={`${s} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
      style={{ backgroundColor: patient.color || "#3b82f6" }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

/** Avatar, full name and relationship in a tinted box in the person's color. */
export function PersonChip({ patient, children, testId }: { patient: Patient; children?: React.ReactNode; testId?: string }) {
  const color = patient.color || "#3b82f6";
  return (
    <div
      className="flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 min-w-0"
      style={{ borderColor: color, backgroundColor: `${color}14` }}
      data-testid={testId}
    >
      <PersonAvatar patient={patient} />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-base font-semibold leading-tight break-words">{patient.name}</p>
        {patient.relationship && <p className="text-xs text-muted-foreground mt-0.5">{patient.relationship}</p>}
      </div>
      {children}
    </div>
  );
}
