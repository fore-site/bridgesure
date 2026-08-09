/**
 * Portable DDL executed at boot by both registries. Uses only the column
 * subset both SQLite and PostgreSQL accept (text / integer), so a single
 * statement set works for either driver. Idempotent: CREATE TABLE IF NOT EXISTS.
 */
export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS trades (
    id text PRIMARY KEY,
    chain_id integer NOT NULL,
    escrow text NOT NULL,
    importer text NOT NULL,
    exporter text NOT NULL,
    token text NOT NULL,
    total_amount text NOT NULL,
    status text NOT NULL,
    milestone_one_amount text NOT NULL,
    milestone_one_status text NOT NULL,
    milestone_one_evidence text,
    milestone_two_amount text NOT NULL,
    milestone_two_status text NOT NULL,
    milestone_two_evidence text,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audits (
    audit_id text PRIMARY KEY,
    trace_id text NOT NULL,
    cleanverse_request_ids text NOT NULL,
    actor_role text NOT NULL,
    operation text NOT NULL,
    decision text NOT NULL,
    reason_code text,
    trade_id text NOT NULL,
    milestone_id integer,
    evidence_age_seconds integer,
    apass_code integer,
    validator_valid integer,
    validator_available integer,
    token text NOT NULL,
    amount text NOT NULL,
    tx_hash text,
    observed_at text NOT NULL,
    redacted_context text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nonces (
    nonce_key text PRIMARY KEY,
    consumed_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency (
    idem_key text PRIMARY KEY,
    operation_id text NOT NULL,
    result_json text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS releases (
    release_id text PRIMARY KEY,
    trade_id text NOT NULL,
    auth_json text NOT NULL,
    signature text NOT NULL,
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tx_hashes (
    operation_id text PRIMARY KEY,
    tx_hash text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS disputes (
    dispute_id text PRIMARY KEY,
    trade_id text NOT NULL,
    flagged_by text NOT NULL,
    reason text NOT NULL,
    status text NOT NULL,
    resolution text,
    required_signatures integer NOT NULL,
    signers_json text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evidence (
    evidence_id text PRIMARY KEY,
    dispute_id text NOT NULL,
    submitted_by text NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    digest text NOT NULL,
    payload_json text NOT NULL,
    created_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audits_trade ON audits (trade_id)`,
  `CREATE INDEX IF NOT EXISTS idx_disputes_trade ON disputes (trade_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_dispute ON evidence (dispute_id)`,
];
