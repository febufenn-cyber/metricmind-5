CREATE SCHEMA analytics;

CREATE TABLE analytics.product_events (
  event_id uuid PRIMARY KEY,
  user_id text NOT NULL,
  event_name text NOT NULL,
  occurred_at timestamptz NOT NULL,
  inserted_at timestamptz NOT NULL,
  platform text,
  source text,
  country text,
  app_version text
);

CREATE INDEX product_events_occurred_at_idx
  ON analytics.product_events (occurred_at DESC);
CREATE INDEX product_events_inserted_at_idx
  ON analytics.product_events (inserted_at DESC);
CREATE INDEX product_events_metric_idx
  ON analytics.product_events (event_name, occurred_at DESC, user_id);

INSERT INTO analytics.product_events
  (event_id, user_id, event_name, occurred_at, inserted_at, platform, source, country, app_version)
SELECT
  gen_random_uuid(),
  'user-' || series,
  CASE
    WHEN series % 7 = 0 THEN 'subscription_started'
    WHEN series % 3 = 0 THEN 'workspace_created'
    ELSE 'signup_completed'
  END,
  now() - make_interval(hours => series),
  now() - make_interval(hours => series) + interval '1 minute',
  (ARRAY['ios', 'android', 'web'])[(series % 3) + 1],
  (ARRAY['organic', 'paid', 'referral'])[(series % 3) + 1],
  (ARRAY['IN', 'US', 'GB'])[(series % 3) + 1],
  '1.0.' || (series % 4)
FROM generate_series(1, 120) AS series;

CREATE ROLE metricmind_reader LOGIN PASSWORD 'metricmind_local';
ALTER ROLE metricmind_reader SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE metricmind TO metricmind_reader;
GRANT USAGE ON SCHEMA analytics TO metricmind_reader;
GRANT SELECT ON analytics.product_events TO metricmind_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA analytics
  GRANT SELECT ON TABLES TO metricmind_reader;
