import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and } from "drizzle-orm";
import {
  patients, insertPatientSchema, type InsertPatient, type Patient,
  physicians, insertPhysicianSchema, type InsertPhysician, type Physician,
  appointments, insertAppointmentSchema, type InsertAppointment, type Appointment,
  medications, insertMedicationSchema, type InsertMedication, type Medication,
  medicationLogs, insertMedicationLogSchema, type InsertMedicationLog, type MedicationLog,
  medicalRecords, insertMedicalRecordSchema, type InsertMedicalRecord, type MedicalRecord,
  vitals, insertVitalSchema, type InsertVital, type Vital,
  emergencyContacts, insertEmergencyContactSchema, type InsertEmergencyContact, type EmergencyContact,
  pharmacies, insertPharmacySchema, type InsertPharmacy, type Pharmacy,
} from "@shared/schema";

const sqlite = new Database("medical_records.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    relationship TEXT,
    date_of_birth TEXT,
    color TEXT NOT NULL DEFAULT '#3b82f6'
  );
  CREATE TABLE IF NOT EXISTS physicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    phone TEXT,
    fax TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    npi TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    physician_id INTEGER,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    location TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'upcoming',
    notes TEXT,
    reminder_date TEXT
  );
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    time_of_day TEXT,
    prescribed_by TEXT,
    pharmacy TEXT,
    start_date TEXT,
    end_date TEXT,
    refill_date TEXT,
    purpose TEXT,
    side_effects TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS medication_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    taken INTEGER NOT NULL DEFAULT 1,
    time TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS medical_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    physician_id INTEGER,
    description TEXT,
    notes TEXT,
    image_url TEXT
  );
  CREATE TABLE IF NOT EXISTS vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    date TEXT NOT NULL,
    weight TEXT,
    blood_pressure_systolic TEXT,
    blood_pressure_diastolic TEXT,
    heart_rate TEXT,
    temperature TEXT,
    blood_sugar TEXT,
    oxygen_saturation TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS emergency_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    relationship TEXT NOT NULL,
    phone TEXT NOT NULL,
    alt_phone TEXT,
    email TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS pharmacies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    hours TEXT,
    website TEXT,
    notes TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0
  );
`);

// Migrations: add patient_id columns if missing (for existing DBs)
const migrations = [
  "ALTER TABLE physicians ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE appointments ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE medications ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE medical_records ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE vitals ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE emergency_contacts ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE pharmacies ADD COLUMN patient_id INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE medical_records ADD COLUMN image_url TEXT",
];
for (const sql of migrations) {
  try { sqlite.exec(sql); } catch (e: any) { /* column already exists */ }
}

// Seed a default patient if none exist
const patientCount = sqlite.prepare("SELECT COUNT(*) as cnt FROM patients").get() as any;
if (patientCount.cnt === 0) {
  sqlite.prepare("INSERT INTO patients (name, relationship, color) VALUES (?, ?, ?)").run("My Records", "Self", "#3b82f6");
}

export interface IStorage {
  // Patients
  getPatients(): Patient[];
  getPatient(id: number): Patient | undefined;
  createPatient(data: InsertPatient): Patient;
  updatePatient(id: number, data: Partial<InsertPatient>): Patient | undefined;
  deletePatient(id: number): void;

  // Physicians
  getPhysicians(patientId: number): Physician[];
  getPhysician(id: number): Physician | undefined;
  createPhysician(data: InsertPhysician): Physician;
  updatePhysician(id: number, data: Partial<InsertPhysician>): Physician | undefined;
  deletePhysician(id: number): void;

  // Appointments
  getAppointments(patientId: number): Appointment[];
  getAppointment(id: number): Appointment | undefined;
  createAppointment(data: InsertAppointment): Appointment;
  updateAppointment(id: number, data: Partial<InsertAppointment>): Appointment | undefined;
  deleteAppointment(id: number): void;

  // Medications
  getMedications(patientId: number): Medication[];
  getMedication(id: number): Medication | undefined;
  createMedication(data: InsertMedication): Medication;
  updateMedication(id: number, data: Partial<InsertMedication>): Medication | undefined;
  deleteMedication(id: number): void;

  // Medication Logs
  getMedicationLogs(medicationId?: number): MedicationLog[];
  createMedicationLog(data: InsertMedicationLog): MedicationLog;
  deleteMedicationLog(id: number): void;

  // Medical Records
  getMedicalRecords(patientId: number): MedicalRecord[];
  getMedicalRecord(id: number): MedicalRecord | undefined;
  createMedicalRecord(data: InsertMedicalRecord): MedicalRecord;
  updateMedicalRecord(id: number, data: Partial<InsertMedicalRecord>): MedicalRecord | undefined;
  deleteMedicalRecord(id: number): void;

  // Vitals
  getVitals(patientId: number): Vital[];
  createVital(data: InsertVital): Vital;
  deleteVital(id: number): void;

  // Emergency Contacts
  getEmergencyContacts(patientId: number): EmergencyContact[];
  createEmergencyContact(data: InsertEmergencyContact): EmergencyContact;
  updateEmergencyContact(id: number, data: Partial<InsertEmergencyContact>): EmergencyContact | undefined;
  deleteEmergencyContact(id: number): void;

  // Pharmacies
  getPharmacies(patientId: number): Pharmacy[];
  getPharmacy(id: number): Pharmacy | undefined;
  createPharmacy(data: InsertPharmacy): Pharmacy;
  updatePharmacy(id: number, data: Partial<InsertPharmacy>): Pharmacy | undefined;
  deletePharmacy(id: number): void;
}

export class DatabaseStorage implements IStorage {
  // Patients
  getPatients(): Patient[] {
    return db.select().from(patients).all();
  }
  getPatient(id: number): Patient | undefined {
    return db.select().from(patients).where(eq(patients.id, id)).get();
  }
  createPatient(data: InsertPatient): Patient {
    return db.insert(patients).values(data).returning().get();
  }
  updatePatient(id: number, data: Partial<InsertPatient>): Patient | undefined {
    return db.update(patients).set(data).where(eq(patients.id, id)).returning().get();
  }
  deletePatient(id: number): void {
    // Delete all data belonging to this patient
    db.delete(pharmacies).where(eq(pharmacies.patientId, id)).run();
    db.delete(emergencyContacts).where(eq(emergencyContacts.patientId, id)).run();
    db.delete(vitals).where(eq(vitals.patientId, id)).run();
    db.delete(medicalRecords).where(eq(medicalRecords.patientId, id)).run();
    // Delete medication logs for this patient's medications
    const patientMeds = db.select().from(medications).where(eq(medications.patientId, id)).all();
    for (const med of patientMeds) {
      db.delete(medicationLogs).where(eq(medicationLogs.medicationId, med.id)).run();
    }
    db.delete(medications).where(eq(medications.patientId, id)).run();
    db.delete(appointments).where(eq(appointments.patientId, id)).run();
    db.delete(physicians).where(eq(physicians.patientId, id)).run();
    db.delete(patients).where(eq(patients.id, id)).run();
  }

  // Physicians
  getPhysicians(patientId: number): Physician[] {
    return db.select().from(physicians).where(eq(physicians.patientId, patientId)).all();
  }
  getPhysician(id: number): Physician | undefined {
    return db.select().from(physicians).where(eq(physicians.id, id)).get();
  }
  createPhysician(data: InsertPhysician): Physician {
    return db.insert(physicians).values(data).returning().get();
  }
  updatePhysician(id: number, data: Partial<InsertPhysician>): Physician | undefined {
    return db.update(physicians).set(data).where(eq(physicians.id, id)).returning().get();
  }
  deletePhysician(id: number): void {
    db.delete(physicians).where(eq(physicians.id, id)).run();
  }

  // Appointments
  getAppointments(patientId: number): Appointment[] {
    return db.select().from(appointments).where(eq(appointments.patientId, patientId)).orderBy(desc(appointments.date)).all();
  }
  getAppointment(id: number): Appointment | undefined {
    return db.select().from(appointments).where(eq(appointments.id, id)).get();
  }
  createAppointment(data: InsertAppointment): Appointment {
    return db.insert(appointments).values(data).returning().get();
  }
  updateAppointment(id: number, data: Partial<InsertAppointment>): Appointment | undefined {
    return db.update(appointments).set(data).where(eq(appointments.id, id)).returning().get();
  }
  deleteAppointment(id: number): void {
    db.delete(appointments).where(eq(appointments.id, id)).run();
  }

  // Medications
  getMedications(patientId: number): Medication[] {
    return db.select().from(medications).where(eq(medications.patientId, patientId)).all();
  }
  getMedication(id: number): Medication | undefined {
    return db.select().from(medications).where(eq(medications.id, id)).get();
  }
  createMedication(data: InsertMedication): Medication {
    return db.insert(medications).values(data).returning().get();
  }
  updateMedication(id: number, data: Partial<InsertMedication>): Medication | undefined {
    return db.update(medications).set(data).where(eq(medications.id, id)).returning().get();
  }
  deleteMedication(id: number): void {
    db.delete(medicationLogs).where(eq(medicationLogs.medicationId, id)).run();
    db.delete(medications).where(eq(medications.id, id)).run();
  }

  // Medication Logs
  getMedicationLogs(medicationId?: number): MedicationLog[] {
    if (medicationId) {
      return db.select().from(medicationLogs).where(eq(medicationLogs.medicationId, medicationId)).orderBy(desc(medicationLogs.date)).all();
    }
    return db.select().from(medicationLogs).orderBy(desc(medicationLogs.date)).all();
  }
  createMedicationLog(data: InsertMedicationLog): MedicationLog {
    return db.insert(medicationLogs).values(data).returning().get();
  }
  deleteMedicationLog(id: number): void {
    db.delete(medicationLogs).where(eq(medicationLogs.id, id)).run();
  }

  // Medical Records
  getMedicalRecords(patientId: number): MedicalRecord[] {
    return db.select().from(medicalRecords).where(eq(medicalRecords.patientId, patientId)).orderBy(desc(medicalRecords.date)).all();
  }
  getMedicalRecord(id: number): MedicalRecord | undefined {
    return db.select().from(medicalRecords).where(eq(medicalRecords.id, id)).get();
  }
  createMedicalRecord(data: InsertMedicalRecord): MedicalRecord {
    return db.insert(medicalRecords).values(data).returning().get();
  }
  updateMedicalRecord(id: number, data: Partial<InsertMedicalRecord>): MedicalRecord | undefined {
    return db.update(medicalRecords).set(data).where(eq(medicalRecords.id, id)).returning().get();
  }
  deleteMedicalRecord(id: number): void {
    db.delete(medicalRecords).where(eq(medicalRecords.id, id)).run();
  }

  // Vitals
  getVitals(patientId: number): Vital[] {
    return db.select().from(vitals).where(eq(vitals.patientId, patientId)).orderBy(desc(vitals.date)).all();
  }
  createVital(data: InsertVital): Vital {
    return db.insert(vitals).values(data).returning().get();
  }
  deleteVital(id: number): void {
    db.delete(vitals).where(eq(vitals.id, id)).run();
  }

  // Emergency Contacts
  getEmergencyContacts(patientId: number): EmergencyContact[] {
    return db.select().from(emergencyContacts).where(eq(emergencyContacts.patientId, patientId)).all();
  }
  createEmergencyContact(data: InsertEmergencyContact): EmergencyContact {
    return db.insert(emergencyContacts).values(data).returning().get();
  }
  updateEmergencyContact(id: number, data: Partial<InsertEmergencyContact>): EmergencyContact | undefined {
    return db.update(emergencyContacts).set(data).where(eq(emergencyContacts.id, id)).returning().get();
  }
  deleteEmergencyContact(id: number): void {
    db.delete(emergencyContacts).where(eq(emergencyContacts.id, id)).run();
  }

  // Pharmacies
  getPharmacies(patientId: number): Pharmacy[] {
    return db.select().from(pharmacies).where(eq(pharmacies.patientId, patientId)).all();
  }
  getPharmacy(id: number): Pharmacy | undefined {
    return db.select().from(pharmacies).where(eq(pharmacies.id, id)).get();
  }
  createPharmacy(data: InsertPharmacy): Pharmacy {
    return db.insert(pharmacies).values(data).returning().get();
  }
  updatePharmacy(id: number, data: Partial<InsertPharmacy>): Pharmacy | undefined {
    return db.update(pharmacies).set(data).where(eq(pharmacies.id, id)).returning().get();
  }
  deletePharmacy(id: number): void {
    db.delete(pharmacies).where(eq(pharmacies.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
