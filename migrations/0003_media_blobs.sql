CREATE TABLE IF NOT EXISTS media_blobs(
  key text PRIMARY KEY,
  data bytea NOT NULL,
  content_type text NOT NULL DEFAULT 'image/webp',
  created_at timestamptz NOT NULL DEFAULT now()
);
