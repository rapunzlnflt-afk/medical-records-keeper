// Plain TypeScript types — no Drizzle, no server dependencies.
// These are used by both the Dexie DB layer and all UI components.

export interface Patient {
  id?: number;
  name: string;
  relationship: string | null;
  dateOfBirth: string | null;
  color: string;
}

export interface Physician {
  id?: number;
  patientId: number;
  name: string;
  specialty: string;
  phone: string | null;
  fax: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  npi: string | null;
  notes: string | null;
}

export interface Appointment {
  id?: number;
  patientId: number;
  title: string;
  physicianId: number | null;
  date: string;
  time: string;
  location: string | null;
  type: string;
  status: string;
  notes: string | null;
  reminderDate: string | null;
}

export interface Medication {
  id?: number;
  patientId: number;
  name: string;
  type: string;
  dosage: string;
  frequency: string;
  timeOfDay: string | null;
  prescribedBy: string | null;
  pharmacy: string | null;
  startDate: string | null;
  endDate: string | null;
  refillDate: string | null;
  purpose: string | null;
  sideEffects: string | null;
  notes: string | null;
  active: number;
}

export interface MedicationLog {
  id?: number;
  medicationId: number;
  date: string;
  taken: number;
  time: string | null;
  notes: string | null;
}

export interface MedicalRecord {
  id?: number;
  patientId: number;
  title: string;
  category: string;
  date: string;
  physicianId: number | null;
  description: string | null;
  notes: string | null;
  imageUrl: string | null;
}

export interface Vital {
  id?: number;
  patientId: number;
  date: string;
  weight: string | null;
  bloodPressureSystolic: string | null;
  bloodPressureDiastolic: string | null;
  heartRate: string | null;
  temperature: string | null;
  bloodSugar: string | null;
  oxygenSaturation: string | null;
  notes: string | null;
}

export interface EmergencyContact {
  id?: number;
  patientId: number;
  name: string;
  relationship: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  isPrimary: number;
}

export interface Pharmacy {
  id?: number;
  patientId: number;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hours: string | null;
  website: string | null;
  notes: string | null;
  isPrimary: number;
}
