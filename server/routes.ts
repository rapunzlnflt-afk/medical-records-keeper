import type { Express } from "express";
import type { Server } from "http";
import { storage, db } from "./storage";
import {
  physicians, appointments, medications, medicationLogs,
  medicalRecords, vitals, emergencyContacts,
} from "@shared/schema";

export function registerRoutes(server: Server, app: Express) {
  // === Physicians ===
  app.get("/api/physicians", (_req, res) => {
    res.json(storage.getPhysicians());
  });
  app.get("/api/physicians/:id", (req, res) => {
    const p = storage.getPhysician(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.post("/api/physicians", (req, res) => {
    const p = storage.createPhysician(req.body);
    res.status(201).json(p);
  });
  app.patch("/api/physicians/:id", (req, res) => {
    const p = storage.updatePhysician(Number(req.params.id), req.body);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.delete("/api/physicians/:id", (req, res) => {
    storage.deletePhysician(Number(req.params.id));
    res.status(204).send();
  });

  // === Appointments ===
  app.get("/api/appointments", (_req, res) => {
    res.json(storage.getAppointments());
  });
  app.get("/api/appointments/:id", (req, res) => {
    const a = storage.getAppointment(Number(req.params.id));
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });
  app.post("/api/appointments", (req, res) => {
    const a = storage.createAppointment(req.body);
    res.status(201).json(a);
  });
  app.patch("/api/appointments/:id", (req, res) => {
    const a = storage.updateAppointment(Number(req.params.id), req.body);
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });
  app.delete("/api/appointments/:id", (req, res) => {
    storage.deleteAppointment(Number(req.params.id));
    res.status(204).send();
  });

  // === Medications ===
  app.get("/api/medications", (_req, res) => {
    res.json(storage.getMedications());
  });
  app.get("/api/medications/:id", (req, res) => {
    const m = storage.getMedication(Number(req.params.id));
    if (!m) return res.status(404).json({ error: "Not found" });
    res.json(m);
  });
  app.post("/api/medications", (req, res) => {
    const m = storage.createMedication(req.body);
    res.status(201).json(m);
  });
  app.patch("/api/medications/:id", (req, res) => {
    const m = storage.updateMedication(Number(req.params.id), req.body);
    if (!m) return res.status(404).json({ error: "Not found" });
    res.json(m);
  });
  app.delete("/api/medications/:id", (req, res) => {
    storage.deleteMedication(Number(req.params.id));
    res.status(204).send();
  });

  // === Medication Logs ===
  app.get("/api/medication-logs", (req, res) => {
    const medId = req.query.medicationId ? Number(req.query.medicationId) : undefined;
    res.json(storage.getMedicationLogs(medId));
  });
  app.post("/api/medication-logs", (req, res) => {
    const l = storage.createMedicationLog(req.body);
    res.status(201).json(l);
  });
  app.delete("/api/medication-logs/:id", (req, res) => {
    storage.deleteMedicationLog(Number(req.params.id));
    res.status(204).send();
  });

  // === Medical Records ===
  app.get("/api/medical-records", (_req, res) => {
    res.json(storage.getMedicalRecords());
  });
  app.get("/api/medical-records/:id", (req, res) => {
    const r = storage.getMedicalRecord(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });
  app.post("/api/medical-records", (req, res) => {
    const r = storage.createMedicalRecord(req.body);
    res.status(201).json(r);
  });
  app.patch("/api/medical-records/:id", (req, res) => {
    const r = storage.updateMedicalRecord(Number(req.params.id), req.body);
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });
  app.delete("/api/medical-records/:id", (req, res) => {
    storage.deleteMedicalRecord(Number(req.params.id));
    res.status(204).send();
  });

  // === Vitals ===
  app.get("/api/vitals", (_req, res) => {
    res.json(storage.getVitals());
  });
  app.post("/api/vitals", (req, res) => {
    const v = storage.createVital(req.body);
    res.status(201).json(v);
  });
  app.delete("/api/vitals/:id", (req, res) => {
    storage.deleteVital(Number(req.params.id));
    res.status(204).send();
  });

  // === Emergency Contacts ===
  app.get("/api/emergency-contacts", (_req, res) => {
    res.json(storage.getEmergencyContacts());
  });
  app.post("/api/emergency-contacts", (req, res) => {
    const c = storage.createEmergencyContact(req.body);
    res.status(201).json(c);
  });
  app.patch("/api/emergency-contacts/:id", (req, res) => {
    const c = storage.updateEmergencyContact(Number(req.params.id), req.body);
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  });
  app.delete("/api/emergency-contacts/:id", (req, res) => {
    storage.deleteEmergencyContact(Number(req.params.id));
    res.status(204).send();
  });

  // === Backup: Save My Data ===
  app.get("/api/backup/export", (_req, res) => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      physicians: storage.getPhysicians(),
      appointments: storage.getAppointments(),
      medications: storage.getMedications(),
      medicationLogs: storage.getMedicationLogs(),
      medicalRecords: storage.getMedicalRecords(),
      vitals: storage.getVitals(),
      emergencyContacts: storage.getEmergencyContacts(),
    };
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="medical-records-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.json(data);
  });

  // === Backup: Load My Data ===
  app.post("/api/backup/import", (req, res) => {
    try {
      const data = req.body;
      if (!data || !data.version) {
        return res.status(400).json({ error: "Invalid backup file" });
      }

      // Clear all existing data
      db.delete(medicationLogs).run();
      db.delete(appointments).run();
      db.delete(medicalRecords).run();
      db.delete(medications).run();
      db.delete(vitals).run();
      db.delete(emergencyContacts).run();
      db.delete(physicians).run();

      // Import physicians first (other tables may reference them)
      let physicianIdMap: Record<number, number> = {};
      if (data.physicians?.length) {
        for (const p of data.physicians) {
          const oldId = p.id;
          const { id, ...rest } = p;
          const created = db.insert(physicians).values(rest).returning().get();
          physicianIdMap[oldId] = created.id;
        }
      }

      // Import appointments (remap physician_id)
      if (data.appointments?.length) {
        for (const a of data.appointments) {
          const { id, ...rest } = a;
          if (rest.physicianId && physicianIdMap[rest.physicianId]) {
            rest.physicianId = physicianIdMap[rest.physicianId];
          }
          db.insert(appointments).values(rest).returning().get();
        }
      }

      // Import medications
      let medicationIdMap: Record<number, number> = {};
      if (data.medications?.length) {
        for (const m of data.medications) {
          const oldId = m.id;
          const { id, ...rest } = m;
          const created = db.insert(medications).values(rest).returning().get();
          medicationIdMap[oldId] = created.id;
        }
      }

      // Import medication logs (remap medication_id)
      if (data.medicationLogs?.length) {
        for (const l of data.medicationLogs) {
          const { id, ...rest } = l;
          if (rest.medicationId && medicationIdMap[rest.medicationId]) {
            rest.medicationId = medicationIdMap[rest.medicationId];
          }
          db.insert(medicationLogs).values(rest).returning().get();
        }
      }

      // Import medical records (remap physician_id)
      if (data.medicalRecords?.length) {
        for (const r of data.medicalRecords) {
          const { id, ...rest } = r;
          if (rest.physicianId && physicianIdMap[rest.physicianId]) {
            rest.physicianId = physicianIdMap[rest.physicianId];
          }
          db.insert(medicalRecords).values(rest).returning().get();
        }
      }

      // Import vitals
      if (data.vitals?.length) {
        for (const v of data.vitals) {
          const { id, ...rest } = v;
          db.insert(vitals).values(rest).returning().get();
        }
      }

      // Import emergency contacts
      if (data.emergencyContacts?.length) {
        for (const c of data.emergencyContacts) {
          const { id, ...rest } = c;
          db.insert(emergencyContacts).values(rest).returning().get();
        }
      }

      res.json({ success: true, message: "Data loaded successfully" });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load data: " + err.message });
    }
  });
}
