import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Patients (family members — up to 6)
export const patients = sqliteTable("patients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  relationship: text("relationship"), // e.g. "Self", "Spouse", "Child", "Parent"
  dateOfBirth: text("date_of_birth"),
  color: text("color").notNull().default("#3b82f6"), // avatar color
});

export const insertPatientSchema = createInsertSchema(patients).omit({ id: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patients.$inferSelect;

// Physicians
export const physicians = sqliteTable("physicians", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  phone: text("phone"),
  fax: text("fax"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  npi: text("npi"),
  notes: text("notes"),
});

export const insertPhysicianSchema = createInsertSchema(physicians).omit({ id: true });
export type InsertPhysician = z.infer<typeof insertPhysicianSchema>;
export type Physician = typeof physicians.$inferSelect;

// Appointments
export const appointments = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  title: text("title").notNull(),
  physicianId: integer("physician_id"),
  date: text("date").notNull(),
  time: text("time").notNull(),
  location: text("location"),
  type: text("type").notNull(), // checkup, specialist, lab, imaging, procedure, other
  status: text("status").notNull().default("upcoming"), // upcoming, completed, cancelled
  notes: text("notes"),
  reminderDate: text("reminder_date"),
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

// Medications
export const medications = sqliteTable("medications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  name: text("name").notNull(),
  type: text("type").notNull(), // prescription, otc, supplement, vitamin
  dosage: text("dosage").notNull(),
  frequency: text("frequency").notNull(), // daily, twice-daily, weekly, as-needed, etc.
  timeOfDay: text("time_of_day"), // morning, afternoon, evening, bedtime
  prescribedBy: text("prescribed_by"),
  pharmacy: text("pharmacy"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  refillDate: text("refill_date"),
  purpose: text("purpose"),
  sideEffects: text("side_effects"),
  notes: text("notes"),
  active: integer("active").notNull().default(1),
});

export const insertMedicationSchema = createInsertSchema(medications).omit({ id: true });
export type InsertMedication = z.infer<typeof insertMedicationSchema>;
export type Medication = typeof medications.$inferSelect;

// Medication Log (tracking daily adherence)
export const medicationLogs = sqliteTable("medication_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  medicationId: integer("medication_id").notNull(),
  date: text("date").notNull(),
  taken: integer("taken").notNull().default(1), // 1=taken, 0=skipped
  time: text("time"),
  notes: text("notes"),
});

export const insertMedicationLogSchema = createInsertSchema(medicationLogs).omit({ id: true });
export type InsertMedicationLog = z.infer<typeof insertMedicationLogSchema>;
export type MedicationLog = typeof medicationLogs.$inferSelect;

// Medical Records / Documents
export const medicalRecords = sqliteTable("medical_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  title: text("title").notNull(),
  category: text("category").notNull(), // lab-results, imaging, vaccination, allergy, condition, insurance, receipt, other
  date: text("date").notNull(),
  physicianId: integer("physician_id"),
  description: text("description"),
  notes: text("notes"),
  imageUrl: text("image_url"), // link to photo of actual results
});

export const insertMedicalRecordSchema = createInsertSchema(medicalRecords).omit({ id: true });
export type InsertMedicalRecord = z.infer<typeof insertMedicalRecordSchema>;
export type MedicalRecord = typeof medicalRecords.$inferSelect;

// Vitals / Health Metrics
export const vitals = sqliteTable("vitals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  date: text("date").notNull(),
  weight: text("weight"),
  bloodPressureSystolic: text("blood_pressure_systolic"),
  bloodPressureDiastolic: text("blood_pressure_diastolic"),
  heartRate: text("heart_rate"),
  temperature: text("temperature"),
  bloodSugar: text("blood_sugar"),
  oxygenSaturation: text("oxygen_saturation"),
  notes: text("notes"),
});

export const insertVitalSchema = createInsertSchema(vitals).omit({ id: true });
export type InsertVital = z.infer<typeof insertVitalSchema>;
export type Vital = typeof vitals.$inferSelect;

// Emergency Contacts
export const emergencyContacts = sqliteTable("emergency_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  name: text("name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  altPhone: text("alt_phone"),
  email: text("email"),
  isPrimary: integer("is_primary").notNull().default(0),
});

export const insertEmergencyContactSchema = createInsertSchema(emergencyContacts).omit({ id: true });
export type InsertEmergencyContact = z.infer<typeof insertEmergencyContactSchema>;
export type EmergencyContact = typeof emergencyContacts.$inferSelect;

// Preferred Pharmacies
export const pharmacies = sqliteTable("pharmacies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull().default(1),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  hours: text("hours"),
  website: text("website"),
  notes: text("notes"),
  isPrimary: integer("is_primary").notNull().default(0),
});

export const insertPharmacySchema = createInsertSchema(pharmacies).omit({ id: true });
export type InsertPharmacy = z.infer<typeof insertPharmacySchema>;
export type Pharmacy = typeof pharmacies.$inferSelect;
