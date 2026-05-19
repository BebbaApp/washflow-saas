import { useState, useEffect } from "react";

export interface Worker {
  id: string;
  name: string;
  role: "admin" | "supervisor" | "washer" | "driver" | "manager" | "cashier";
  phone: string;
  active: boolean;
}

const STORAGE_KEY = "aquawash-workers";

export function useWorkers() {
  const [workers, setWorkers] = useState<Worker[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workers));
  }, [workers]);

  const addWorker = (data: Omit<Worker, "id">) => {
    setWorkers((prev) => [...prev, { ...data, id: crypto.randomUUID() }]);
  };

  const updateWorker = (id: string, updates: Partial<Omit<Worker, "id">>) => {
    setWorkers((prev) => prev.map((w) => (w.id === id ? { ...w, ...updates } : w)));
  };

  const removeWorker = (id: string) => {
    setWorkers((prev) => prev.filter((w) => w.id !== id));
  };

  return { workers, addWorker, updateWorker, removeWorker };
}
