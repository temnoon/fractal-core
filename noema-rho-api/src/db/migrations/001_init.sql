-- 001_init.sql (Postgres 14+)
-- Noema-Rho API: event-sourced Noesis events + periodic sparse Rho snapshots

-- SIC packs (Subjective Intentional Constraints)
CREATE TABLE IF NOT EXISTS sic_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  params_jsonb JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subject lenses (perspectives / reading subjects)
CREATE TABLE IF NOT EXISTS subject_lenses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  sic_pack_id TEXT REFERENCES sic_packs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documents (source material)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  author TEXT,
  ts TIMESTAMPTZ,
  meta_jsonb JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sentences (individual units of text within documents)
CREATE TABLE IF NOT EXISTS sentences (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx_in_doc INT,
  text TEXT NOT NULL,
  char_start INT,
  char_end INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sent_doc ON sentences(doc_id);

-- Eidetic objects (noematic nodes: things-as-meant)
CREATE TABLE IF NOT EXISTS eidetic_objects (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  labels_jsonb JSONB NOT NULL,
  facets_jsonb JSONB NOT NULL,
  provenance_jsonb JSONB NOT NULL,
  embedding_jsonb JSONB,
  canonicality_score REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eidetic_type ON eidetic_objects(type);

-- Noematic edges (weighted relationships between objects)
CREATE TABLE IF NOT EXISTS noematic_edges (
  id TEXT PRIMARY KEY,
  src_id TEXT NOT NULL REFERENCES eidetic_objects(id),
  dst_id TEXT NOT NULL REFERENCES eidetic_objects(id),
  relation_type TEXT NOT NULL,
  weights_jsonb JSONB NOT NULL,
  evidence_jsonb JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON noematic_edges(src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON noematic_edges(dst_id);
CREATE INDEX IF NOT EXISTS idx_edges_rel ON noematic_edges(relation_type);

-- Noesis events (immutable, event-sourced acts of consciousness)
CREATE TABLE IF NOT EXISTS noesis_events (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  subject_lens_id TEXT NOT NULL REFERENCES subject_lenses(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  invoked_objects_jsonb JSONB NOT NULL,
  invoked_edges_jsonb JSONB,
  acts_jsonb JSONB NOT NULL,
  delta_jsonb JSONB NOT NULL,
  metrics_jsonb JSONB NOT NULL,
  explanations_jsonb JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_lens_step
  ON noesis_events(subject_lens_id, step_index);

CREATE INDEX IF NOT EXISTS idx_events_sentence
  ON noesis_events(sentence_id);

-- Rho snapshots (periodic sparse state for fast time-travel)
CREATE TABLE IF NOT EXISTS rho_snapshots (
  id TEXT PRIMARY KEY,
  subject_lens_id TEXT NOT NULL REFERENCES subject_lenses(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  rho_objects_jsonb JSONB NOT NULL,
  rho_edges_jsonb JSONB,
  metrics_jsonb JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rho_snap_unique
  ON rho_snapshots(subject_lens_id, step_index);

-- API key auth
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes_jsonb JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
