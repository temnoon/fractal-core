-- 002_indexes.sql
-- GIN indexes for JSONB containment queries

-- Fast label search on eidetic objects
CREATE INDEX IF NOT EXISTS idx_objects_labels_gin
  ON eidetic_objects USING GIN (labels_jsonb);

-- Fast timeline queries: "which events invoked object X?"
CREATE INDEX IF NOT EXISTS idx_events_invoked_objects_gin
  ON noesis_events USING GIN (invoked_objects_jsonb);
