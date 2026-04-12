import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and } from "drizzle-orm";
import {
  physicians, insertPhysicianSchema, type InsertPhysician, type Physician,
  appointments, insertAppointmentSchema, type InsertAppointment, type Appointment,
  medications, insertMedicationSchema, type InsertMedication, type Medication,
  medicationLogs, insertMedicationLogSchema, type InsertMedicationLog, type MedicationLog,
  medicalRecords, insertMedicalRecordSchema, type InsertMedicalRecord, type MedicalRecord,
  vitals, insertVitalSchema, type InsertVital, type Vital,
  emergencyContacts, insertEmergencyContactSchema, type InsertEmergencyContact, type EmergencyContact,
} from "@shared/schema";

const sqlite = new Database("medical_records.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS physicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    name TEXT NOT NULL,
    relationship TEXT NOT NULL,
    phone TEXT NOT NULL,
    alt_phone TEXT,
    email TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0
  );
`);

// Migration: add image_url column if it doesn't exist
try {
  sqlite.exec(`ALTER TABLE medical_records ADD COLUMN image_url TEXT`);
} catch (e: any) {
  // Column already exists — ignore
}

export interface IStorage {
  // Physicians
  getPhysicians(): Physician[];
  getPhysician(id: number): Physician | undefined;
  createPhysician(data: InsertPhysician): Physician;
  updatePhysician(id: number, data: Partial<InsertPhysician>): Physician | undefined;
  deletePhysician(id: number): void;

  // Appointments
  getAppointments(): Appointment[];
  getAppointment(id: number): Appointment | undefined;
  createAppointment(data: InsertAppointment): Appointment;
  updateAppointment(id: number, data: Partial<InsertAppointment>): Appointment | undefined;
  deleteAppointment(id: number): void;

  // Medications
  getMedications(): Medication[];
  getMedication(id: number): Medication | undefined;
  createMedication(data: InsertMedication): Medication;
  updateMedication(id: number, data: Partial<InsertMedication>): Medication | undefined;
  deleteMedication(id: number): void;

  // Medication Logs
  getMedicationLogs(medicationId?: number): MedicationLog[];
  createMedicationLog(data: InsertMedicationLog): MedicationLog;
  deleteMedicationLog(id: number): void;

  // Medical Records
  getMedicalRecords(): MedicalRecord[];
  getMedicalRecord(id: number): MedicalRecord | undefined;
  createMedicalRecord(data: InsertMedicalRecord): MedicalRecord;
  updateMedicalRecord(id: number, data: Partial<InsertMedicalRecord>): MedicalRecord | undefined;
  deleteMedicalRecord(id: number): void;

  // Vitals
  getVitals(): Vital[];
  createVital(data: InsertVital): Vital;
  deleteVital(id: number): void;

  // Emergency Contacts
  getEmergencyContacts(): EmergencyContact[];
  createEmergencyContact(data: InsertEmergencyContact): EmergencyContact;
  updateEmergencyContact(id: number, data: Partial<InsertEmergencyContact>): EmergencyContact | undefined;
  deleteEmergencyContact(id: number): void;
}

export class DatabaseStorage implements IStorage {
  // Physicians
  getPhysicians(): Physician[] {
    return db.select().from(physicians).all();
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
  getAppointments(): Appointment[] {
    return db.select().from(appointments).orderBy(desc(appointments.date)).all();
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
  getMedications(): Medication[] {
    return db.select().from(medications).all();
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
  getMedicalRecords(): MedicalRecord[] {
    return db.select().from(medicalRecords).orderBy(desc(medicalRecords.date)).all();
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
  getVitals(): Vital[] {
    return db.select().from(vitals).orderBy(desc(vitals.date)).all();
  }
  createVital(data: InsertVital): Vital {
    return db.insert(vitals).values(data).returning().get();
  }
  deleteVital(id: number): void {
    db.delete(vitals).where(eq(vitals.id, id)).run();
  }

  // Emergency Contacts
  getEmergencyContacts(): EmergencyContact[] {
    return db.select().from(emergencyContacts).all();
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
}

export const storage = new DatabaseStorage();
