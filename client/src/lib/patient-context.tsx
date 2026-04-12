import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { getPatients, ensureDefaultPatient } from "./db";
import type { Patient } from "@shared/schema";

interface PatientContextValue {
  patients: Patient[];
  activePatient: Patient | null;
  activePatientId: number;
  setActivePatientId: (id: number) => void;
  isLoading: boolean;
}

const PatientContext = createContext<PatientContextValue>({
  patients: [],
  activePatient: null,
  activePatientId: 1,
  setActivePatientId: () => {},
  isLoading: true,
});

export function PatientProvider({ children }: { children: ReactNode }) {
  const [activePatientId, setActivePatientId] = useState(1);
  const [seeded, setSeeded] = useState(false);

  // Ensure default patient exists on first load
  useEffect(() => {
    ensureDefaultPatient().then(() => setSeeded(true));
  }, []);

  const { data: patients = [], isLoading } = useQuery<Patient[]>({
    queryKey: ["patients"],
    queryFn: getPatients,
    enabled: seeded,
  });

  // When patients load, ensure active ID is valid
  useEffect(() => {
    if (patients.length > 0) {
      const exists = patients.find((p) => p.id === activePatientId);
      if (!exists) {
        setActivePatientId(patients[0].id!);
      }
    }
  }, [patients, activePatientId]);

  const handleSetActive = (id: number) => {
    setActivePatientId(id);
    // Invalidate all data queries so they refetch with new patient
    queryClient.invalidateQueries();
  };

  const activePatient = patients.find((p) => p.id === activePatientId) || null;

  return (
    <PatientContext.Provider
      value={{ patients, activePatient, activePatientId, setActivePatientId: handleSetActive, isLoading }}
    >
      {children}
    </PatientContext.Provider>
  );
}

export function usePatient() {
  return useContext(PatientContext);
}
