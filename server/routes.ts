import type { Express } from "express";
import type { Server } from "http";
import path from "path";
import fs from "fs";
import multer from "multer";
import { storage, db } from "./storage";
import {
  patients, physicians, appointments, medications, medicationLogs,
  medicalRecords, vitals, emergencyContacts, pharmacies,
} from "@shared/schema";

function getPid(req: any): number {
  return Number(req.query.patientId) || 1;
}

export function registerRoutes(server: Server, app: Express) {
  // === File Uploads ===
  const uploadDir = path.resolve("uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
        cb(null, true);
      } else {
        cb(new Error("Only images and PDFs are allowed"));
      }
    },
  });

  // Serve uploaded files
  app.use("/api/uploads", (req, res, next) => {
    const filePath = path.join(uploadDir, path.basename(req.path));
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    res.status(404).json({ error: "File not found" });
  });

  app.post("/api/upload", upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const url = `/api/uploads/${req.file.filename}`;
    res.json({ url, filename: req.file.filename });
  });

  // === Patients ===
  app.get("/api/patients", (_req, res) => {
    res.json(storage.getPatients());
  });
  app.get("/api/patients/:id", (req, res) => {
    const p = storage.getPatient(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.post("/api/patients", (req, res) => {
    // Enforce max 6
    const existing = storage.getPatients();
    if (existing.length >= 6) {
      return res.status(400).json({ error: "Maximum of 6 family members allowed" });
    }
    const p = storage.createPatient(req.body);
    res.status(201).json(p);
  });
  app.patch("/api/patients/:id", (req, res) => {
    const p = storage.updatePatient(Number(req.params.id), req.body);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.delete("/api/patients/:id", (req, res) => {
    // Don't allow deleting the last patient
    const existing = storage.getPatients();
    if (existing.length <= 1) {
      return res.status(400).json({ error: "Cannot delete the last family member" });
    }
    storage.deletePatient(Number(req.params.id));
    res.status(204).send();
  });

  // === Physicians ===
  app.get("/api/physicians", (req, res) => {
    res.json(storage.getPhysicians(getPid(req)));
  });
  app.get("/api/physicians/:id", (req, res) => {
    const p = storage.getPhysician(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.post("/api/physicians", (req, res) => {
    const p = storage.createPhysician({ ...req.body, patientId: req.body.patientId || getPid(req) });
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
  app.get("/api/appointments", (req, res) => {
    res.json(storage.getAppointments(getPid(req)));
  });
  app.get("/api/appointments/:id", (req, res) => {
    const a = storage.getAppointment(Number(req.params.id));
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  });
  app.post("/api/appointments", (req, res) => {
    const a = storage.createAppointment({ ...req.body, patientId: req.body.patientId || getPid(req) });
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
  app.get("/api/medications", (req, res) => {
    res.json(storage.getMedications(getPid(req)));
  });
  app.get("/api/medications/:id", (req, res) => {
    const m = storage.getMedication(Number(req.params.id));
    if (!m) return res.status(404).json({ error: "Not found" });
    res.json(m);
  });
  app.post("/api/medications", (req, res) => {
    const m = storage.createMedication({ ...req.body, patientId: req.body.patientId || getPid(req) });
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
  app.get("/api/medical-records", (req, res) => {
    res.json(storage.getMedicalRecords(getPid(req)));
  });
  app.get("/api/medical-records/:id", (req, res) => {
    const r = storage.getMedicalRecord(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });
  app.post("/api/medical-records", (req, res) => {
    const r = storage.createMedicalRecord({ ...req.body, patientId: req.body.patientId || getPid(req) });
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
  app.get("/api/vitals", (req, res) => {
    res.json(storage.getVitals(getPid(req)));
  });
  app.post("/api/vitals", (req, res) => {
    const v = storage.createVital({ ...req.body, patientId: req.body.patientId || getPid(req) });
    res.status(201).json(v);
  });
  app.delete("/api/vitals/:id", (req, res) => {
    storage.deleteVital(Number(req.params.id));
    res.status(204).send();
  });

  // === Emergency Contacts ===
  app.get("/api/emergency-contacts", (req, res) => {
    res.json(storage.getEmergencyContacts(getPid(req)));
  });
  app.post("/api/emergency-contacts", (req, res) => {
    const c = storage.createEmergencyContact({ ...req.body, patientId: req.body.patientId || getPid(req) });
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

  // === Pharmacies ===
  app.get("/api/pharmacies", (req, res) => {
    res.json(storage.getPharmacies(getPid(req)));
  });
  app.get("/api/pharmacies/:id", (req, res) => {
    const p = storage.getPharmacy(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.post("/api/pharmacies", (req, res) => {
    const p = storage.createPharmacy({ ...req.body, patientId: req.body.patientId || getPid(req) });
    res.status(201).json(p);
  });
  app.patch("/api/pharmacies/:id", (req, res) => {
    const p = storage.updatePharmacy(Number(req.params.id), req.body);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.delete("/api/pharmacies/:id", (req, res) => {
    storage.deletePharmacy(Number(req.params.id));
    res.status(204).send();
  });

  // === Backup: Save My Data ===
  app.get("/api/backup/export", (_req, res) => {
    const allPatients = storage.getPatients();
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      patients: allPatients,
      physicians: db.select().from(physicians).all(),
      appointments: db.select().from(appointments).all(),
      medications: db.select().from(medications).all(),
      medicationLogs: db.select().from(medicationLogs).all(),
      medicalRecords: db.select().from(medicalRecords).all(),
      vitals: db.select().from(vitals).all(),
      emergencyContacts: db.select().from(emergencyContacts).all(),
      pharmacies: db.select().from(pharmacies).all(),
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
      db.delete(pharmacies).run();
      db.delete(patients).run();

      // Import patients (or create default for v1 backups)
      let patientIdMap: Record<number, number> = {};
      if (data.patients?.length) {
        for (const p of data.patients) {
          const oldId = p.id;
          const { id, ...rest } = p;
          const created = db.insert(patients).values(rest).returning().get();
          patientIdMap[oldId] = created.id;
        }
      } else {
        // v1 backup — create a default patient
        const created = db.insert(patients).values({ name: "My Records", relationship: "Self", color: "#3b82f6" }).returning().get();
        patientIdMap[1] = created.id;
      }

      // Import physicians (remap patient_id)
      let physicianIdMap: Record<number, number> = {};
      if (data.physicians?.length) {
        for (const p of data.physicians) {
          const oldId = p.id;
          const { id, ...rest } = p;
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
          const created = db.insert(physicians).values(rest).returning().get();
          physicianIdMap[oldId] = created.id;
        }
      }

      // Import appointments (remap physician_id + patient_id)
      if (data.appointments?.length) {
        for (const a of data.appointments) {
          const { id, ...rest } = a;
          if (rest.physicianId && physicianIdMap[rest.physicianId]) {
            rest.physicianId = physicianIdMap[rest.physicianId];
          }
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
          db.insert(appointments).values(rest).returning().get();
        }
      }

      // Import medications (remap patient_id)
      let medicationIdMap: Record<number, number> = {};
      if (data.medications?.length) {
        for (const m of data.medications) {
          const oldId = m.id;
          const { id, ...rest } = m;
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
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

      // Import medical records (remap physician_id + patient_id)
      if (data.medicalRecords?.length) {
        for (const r of data.medicalRecords) {
          const { id, ...rest } = r;
          if (rest.physicianId && physicianIdMap[rest.physicianId]) {
            rest.physicianId = physicianIdMap[rest.physicianId];
          }
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
          db.insert(medicalRecords).values(rest).returning().get();
        }
      }

      // Import vitals (remap patient_id)
      if (data.vitals?.length) {
        for (const v of data.vitals) {
          const { id, ...rest } = v;
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
          db.insert(vitals).values(rest).returning().get();
        }
      }

      // Import emergency contacts (remap patient_id)
      if (data.emergencyContacts?.length) {
        for (const c of data.emergencyContacts) {
          const { id, ...rest } = c;
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
          db.insert(emergencyContacts).values(rest).returning().get();
        }
      }

      // Import pharmacies (remap patient_id)
      if (data.pharmacies?.length) {
        for (const p of data.pharmacies) {
          const { id, ...rest } = p;
          rest.patientId = patientIdMap[rest.patientId] || patientIdMap[1] || 1;
          db.insert(pharmacies).values(rest).returning().get();
        }
      }

      res.json({ success: true, message: "Data loaded successfully" });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load data: " + err.message });
    }
  });
}
