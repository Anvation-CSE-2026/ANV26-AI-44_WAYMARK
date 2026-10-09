ALTER TABLE public.incident_reports
  ADD COLUMN IF NOT EXISTS reasons JSONB;