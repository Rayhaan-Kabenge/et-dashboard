"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Field, GeoPolygon } from "./types";
import { createField, getActiveField } from "./api";

interface FieldCtx {
  field: Field | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  refresh: () => Promise<void>;
  saveField: (name: string, geometry: GeoPolygon, crop?: string | null) => Promise<Field>;
}

const Ctx = createContext<FieldCtx>({
  field: null,
  loading: true,
  error: null,
  saving: false,
  refresh: async () => {},
  saveField: async () => {
    throw new Error("FieldProvider missing");
  },
});

export function FieldProvider({ children }: { children: React.ReactNode }) {
  const [field, setField] = useState<Field | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setField(await getActiveField());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load field");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveField = useCallback(async (name: string, geometry: GeoPolygon, crop?: string | null) => {
    setSaving(true);
    try {
      const f = await createField(name, geometry, crop);
      setField(f); // changing the active field re-runs every panel (they read context)
      setError(null);
      return f;
    } catch (e: any) {
      setError(e?.message ?? "Failed to save field");
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<FieldCtx>(
    () => ({ field, loading, error, saving, refresh, saveField }),
    [field, loading, error, saving, refresh, saveField]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useField = () => useContext(Ctx);
