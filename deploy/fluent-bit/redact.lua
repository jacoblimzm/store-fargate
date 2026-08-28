-- Fluent Bit Lua filter: redacts obvious PII from the raw `log` line at
-- ingestion, BEFORE it ships to Datadog. This proves log obfuscation works in
-- the FireLens pipeline (targets the python/app stream in extra.conf).
--
-- Return codes: 0 = record unchanged, 2 = record modified (Fluent Bit re-emits).
-- Lua patterns (not full regex): %d = digit, %f[set] = frontier/boundary.
function redact_sensitive(tag, timestamp, record)
    local log = record["log"]
    if type(log) ~= "string" then
        return 0, timestamp, record
    end

    -- 16-digit card starting with 4 (Visa-style). The %f[%d]..%f[%D] frontiers
    -- bound it to an exact 16-digit run so we don't clip longer numeric IDs
    -- (e.g. dd.span_id).
    local masked, n1 = string.gsub(
        log,
        "%f[%d]4%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%f[%D]",
        "[masked_credit_card]"
    )

    -- email addresses
    local n2
    masked, n2 = string.gsub(masked, "[%w%.%-_]+@[%w%.%-]+%.%a+", "[masked_email]")

    if (n1 + n2) > 0 then
        record["log"] = masked
        return 2, timestamp, record
    end
    return 0, timestamp, record
end
