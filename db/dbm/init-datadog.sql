-- Datadog Database Monitoring (DBM) setup for Postgres.
-- Runs once on a fresh volume via /docker-entrypoint-initdb.d.
-- Docs: https://docs.datadoghq.com/database_monitoring/setup_postgres/

CREATE USER datadog WITH PASSWORD 'datadog';
GRANT pg_monitor TO datadog;
GRANT SELECT ON pg_stat_activity TO datadog;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE SCHEMA IF NOT EXISTS datadog;
GRANT USAGE ON SCHEMA datadog TO datadog;
GRANT USAGE ON SCHEMA public TO datadog;

-- Function used by the Agent to collect EXPLAIN plans for query samples.
CREATE OR REPLACE FUNCTION datadog.explain_statement(
   l_query TEXT,
   OUT explain JSON
)
RETURNS SETOF JSON AS
$$
DECLARE
   curs REFCURSOR;
   plan JSON;
BEGIN
   OPEN curs FOR EXECUTE pg_catalog.concat('EXPLAIN (FORMAT JSON) ', l_query);
   FETCH curs INTO plan;
   CLOSE curs;
   RETURN QUERY SELECT plan;
END;
$$
LANGUAGE 'plpgsql'
RETURNS NULL ON NULL INPUT
SECURITY DEFINER;
