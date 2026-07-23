import { useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotebookPen, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { appointmentHasNotes, hasAppointmentPassed, appointmentStartMs } from "@/lib/appointment-notes";
import type { Appointment, Physician } from "@shared/schema";

export function RecentVisitNotesCard({
  appointments,
  physicians,
}: {
  appointments: Appointment[];
  physicians: Physician[];
}) {
  const withNotes = useMemo(
    () =>
      appointments
        .filter((a) => hasAppointmentPassed(a) && appointmentHasNotes(a))
        .sort((a, b) => appointmentStartMs(b) - appointmentStartMs(a)),
    [appointments],
  );

  const latest = withNotes.slice(0, 3);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-lg font-semibold flex items-center gap-2">
          <NotebookPen className="w-5 h-5 text-primary" />
          Recent Visit Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {latest.length === 0 ? (
          <div className="text-center py-8">
            <NotebookPen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-base text-muted-foreground">No visit notes yet</p>
            <Link
              href="/appointments"
              className="text-sm font-semibold text-primary hover:underline mt-2 inline-block"
            >
              Add notes to a past visit
            </Link>
          </div>
        ) : (
          <>
            {latest.map((apt) => {
              const doc = physicians.find((p) => p.id === apt.physicianId);
              const preview = (apt.visitSummary || apt.diagnosisFindings || apt.providerInstructions || "").trim();
              return (
                <Link
                  key={apt.id}
                  href="/appointments?tab=timeline"
                  className="flex items-center gap-2.5 sm:gap-3 p-3 rounded-lg bg-secondary/50 hover-elevate min-w-0"
                  data-testid={`recent-visit-note-${apt.id}`}
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg gradient-primary flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-white text-[10px] font-heading font-bold leading-none uppercase tracking-wide">
                      {format(parseISO(apt.date), "MMM")}
                    </span>
                    <span className="text-white text-lg sm:text-xl font-heading font-bold leading-none mt-0.5">
                      {format(parseISO(apt.date), "dd")}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base sm:text-lg font-semibold truncate leading-tight">{apt.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">
                      {doc ? doc.name : format(parseISO(apt.date), "EEE MMM d")}
                    </p>
                    {preview && (
                      <p className="text-sm text-foreground/70 mt-1 line-clamp-1 break-words">{preview}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </Link>
              );
            })}
            <Link
              href="/appointments?tab=timeline"
              className="flex items-center justify-center gap-1 text-sm font-semibold text-primary hover:underline pt-1"
              data-testid="link-view-all-visit-notes"
            >
              View full visit timeline <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
