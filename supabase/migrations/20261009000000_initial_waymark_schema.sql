-- Initial WAYMARK schema for Supabase Postgres. Apply with `supabase db push`.
CREATE TABLE accounts (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	password_hash VARCHAR NOT NULL, 
	role VARCHAR DEFAULT 'community' NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE cells (
	cell_id VARCHAR NOT NULL, 
	lat FLOAT NOT NULL, 
	lng FLOAT NOT NULL, 
	n_past_crashes INTEGER NOT NULL, 
	risk_score FLOAT, 
	risk_vs_similar_history FLOAT, 
	history_percentile FLOAT, 
	confidence VARCHAR, 
	top_factors TEXT, 
	recommendations TEXT, 
	emerging_risk INTEGER NOT NULL, 
	baseline_prob FLOAT, 
	PRIMARY KEY (cell_id)
);

CREATE TABLE chat_sessions (
	id SERIAL NOT NULL, 
	session_id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	role VARCHAR NOT NULL, 
	report_id VARCHAR, 
	report_json TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_chat_sessions_session_id ON chat_sessions (session_id);
CREATE INDEX ix_chat_sessions_user_id ON chat_sessions (user_id);

CREATE TABLE crashes (
	crash_id VARCHAR NOT NULL, 
	cell_id VARCHAR NOT NULL, 
	lat FLOAT NOT NULL, 
	lng FLOAT NOT NULL, 
	start_time VARCHAR, 
	year INTEGER, 
	severity INTEGER, 
	weather VARCHAR, 
	night INTEGER, 
	city VARCHAR, 
	county VARCHAR, 
	zipcode VARCHAR, 
	street VARCHAR, 
	PRIMARY KEY (crash_id)
);

CREATE INDEX ix_crashes_cell_id ON crashes (cell_id);
CREATE INDEX ix_crashes_city ON crashes (city);
CREATE INDEX ix_crashes_county ON crashes (county);
CREATE INDEX ix_crashes_lat ON crashes (lat);
CREATE INDEX ix_crashes_street ON crashes (street);
CREATE INDEX ix_crashes_zipcode ON crashes (zipcode);

CREATE TABLE data_quality (
	check_name VARCHAR NOT NULL, 
	status VARCHAR NOT NULL, 
	detail TEXT, 
	PRIMARY KEY (check_name)
);

CREATE TABLE metrics (
	id SERIAL NOT NULL, 
	group_name VARCHAR NOT NULL, 
	metric_name VARCHAR NOT NULL, 
	model_value FLOAT, 
	history_value FLOAT, 
	extra_json TEXT, 
	PRIMARY KEY (id)
);

CREATE TABLE reports (
	id SERIAL NOT NULL, 
	report_id VARCHAR NOT NULL, 
	region_kind VARCHAR NOT NULL, 
	region_key VARCHAR NOT NULL, 
	status VARCHAR NOT NULL, 
	error_safe TEXT, 
	payload_json TEXT, 
	pdf_path VARCHAR, 
	schema_version VARCHAR NOT NULL, 
	data_version VARCHAR, 
	created_by VARCHAR NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_reports_region ON reports (region_kind, region_key, created_at);
CREATE UNIQUE INDEX ix_reports_report_id ON reports (report_id);

CREATE TABLE risk_snapshots (
	id SERIAL NOT NULL, 
	region_kind VARCHAR NOT NULL, 
	region_key VARCHAR NOT NULL, 
	base_index FLOAT NOT NULL, 
	adjusted_index FLOAT NOT NULL, 
	implementation_pct FLOAT NOT NULL, 
	verified_pct FLOAT NOT NULL, 
	cause_measure_id INTEGER, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_risk_snapshots_region ON risk_snapshots (region_kind, region_key, created_at);

CREATE TABLE yearly_counts (
	year INTEGER NOT NULL, 
	month INTEGER NOT NULL, 
	crashes INTEGER NOT NULL, 
	PRIMARY KEY (year, month)
);

CREATE TABLE cell_scenarios (
	cell_id VARCHAR NOT NULL, 
	night INTEGER NOT NULL, 
	rain INTEGER NOT NULL, 
	low_vis INTEGER NOT NULL, 
	probability FLOAT NOT NULL, 
	PRIMARY KEY (cell_id, night, rain, low_vis), 
	FOREIGN KEY(cell_id) REFERENCES cells (cell_id)
);

CREATE TABLE cell_shap (
	cell_id VARCHAR NOT NULL, 
	rank INTEGER NOT NULL, 
	feature VARCHAR NOT NULL, 
	feature_value FLOAT, 
	shap_value FLOAT NOT NULL, 
	PRIMARY KEY (cell_id, rank), 
	FOREIGN KEY(cell_id) REFERENCES cells (cell_id)
);

CREATE TABLE chat_messages (
	id SERIAL NOT NULL, 
	session_id VARCHAR NOT NULL, 
	author VARCHAR NOT NULL, 
	content TEXT NOT NULL, 
	cards_json TEXT, 
	fallback_mode BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(session_id) REFERENCES chat_sessions (session_id)
);

CREATE INDEX ix_chat_messages_session ON chat_messages (session_id, created_at);

CREATE TABLE measures (
	id SERIAL NOT NULL, 
	report_id VARCHAR, 
	region_kind VARCHAR NOT NULL, 
	region_key VARCHAR NOT NULL, 
	title VARCHAR NOT NULL, 
	category VARCHAR NOT NULL, 
	description TEXT, 
	owner_role VARCHAR NOT NULL, 
	status VARCHAR NOT NULL, 
	effect_weight_snapshot FLOAT NOT NULL, 
	source VARCHAR NOT NULL, 
	created_by VARCHAR NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(report_id) REFERENCES reports (report_id)
);

CREATE INDEX ix_measures_region ON measures (region_kind, region_key);
CREATE INDEX ix_measures_status ON measures (status);

CREATE TABLE evidence (
	id SERIAL NOT NULL, 
	measure_id INTEGER NOT NULL, 
	kind VARCHAR NOT NULL, 
	file_name VARCHAR NOT NULL, 
	thumb_name VARCHAR NOT NULL, 
	sha256 VARCHAR NOT NULL, 
	caption VARCHAR, 
	exif_taken_at TIMESTAMP WITHOUT TIME ZONE, 
	geo_flag VARCHAR NOT NULL, 
	stale_photo BOOLEAN NOT NULL, 
	uploaded_by VARCHAR NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_evidence_measure_sha UNIQUE (measure_id, sha256), 
	FOREIGN KEY(measure_id) REFERENCES measures (id)
);

CREATE INDEX ix_evidence_measure_id ON evidence (measure_id);

CREATE TABLE measure_cells (
	measure_id INTEGER NOT NULL, 
	cell_id VARCHAR NOT NULL, 
	PRIMARY KEY (measure_id, cell_id), 
	FOREIGN KEY(measure_id) REFERENCES measures (id), 
	FOREIGN KEY(cell_id) REFERENCES cells (cell_id)
);

CREATE INDEX ix_measure_cells_cell_id ON measure_cells (cell_id);

CREATE TABLE measure_events (
	id SERIAL NOT NULL, 
	measure_id INTEGER NOT NULL, 
	type VARCHAR NOT NULL, 
	from_status VARCHAR, 
	to_status VARCHAR, 
	actor VARCHAR NOT NULL, 
	actor_role VARCHAR NOT NULL, 
	note TEXT, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(measure_id) REFERENCES measures (id)
);

CREATE INDEX ix_measure_events_measure ON measure_events (measure_id, created_at);

ALTER TABLE public."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cell_scenarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cell_shap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cells" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."chat_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."crashes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."data_quality" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."measure_cells" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."measure_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."measures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."risk_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."yearly_counts" ENABLE ROW LEVEL SECURITY;

-- Supports case-insensitive locality searches on PostgreSQL.
CREATE INDEX IF NOT EXISTS ix_crashes_city_lower ON public.crashes (lower(city));
CREATE INDEX IF NOT EXISTS ix_crashes_county_lower ON public.crashes (lower(county));
CREATE INDEX IF NOT EXISTS ix_crashes_zipcode_lower ON public.crashes (lower(zipcode));
CREATE INDEX IF NOT EXISTS ix_crashes_street_lower ON public.crashes (lower(street));
