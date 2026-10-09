ALTER TABLE public.measures
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMP WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS progress_note TEXT;

CREATE TABLE IF NOT EXISTS public.incident_reports (
  id BIGSERIAL PRIMARY KEY,
  kind VARCHAR NOT NULL CHECK (kind IN ('crash', 'near_miss')),
  cell_id VARCHAR NOT NULL REFERENCES public.cells(cell_id),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  severity INTEGER CHECK (severity BETWEEN 1 AND 4),
  reasons JSONB,
  note VARCHAR(1000),
  status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  reported_by VARCHAR NOT NULL,
  reviewed_by VARCHAR,
  review_note VARCHAR(1000),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_incident_reports_cell_id ON public.incident_reports (cell_id);
CREATE INDEX IF NOT EXISTS ix_incident_reports_status ON public.incident_reports (status);
CREATE INDEX IF NOT EXISTS ix_incident_reports_cell_status ON public.incident_reports (cell_id, status);
CREATE INDEX IF NOT EXISTS ix_incident_reports_reported_by ON public.incident_reports (reported_by);

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
