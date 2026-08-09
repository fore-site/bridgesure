import { pgTable, text, integer } from 'drizzle-orm/pg-core';

/**
 * PostgreSQL dialect of the registry schema. Column set and names match
 * `schema.sqlite.ts` exactly so the row mappers in `mappers.ts` are shared.
 * Only text/integer columns are used — portable across both dialects.
 */

export const trades = pgTable('trades', {
  id: text('id').primaryKey(),
  chain_id: integer('chain_id').notNull(),
  escrow: text('escrow').notNull(),
  importer: text('importer').notNull(),
  exporter: text('exporter').notNull(),
  token: text('token').notNull(),
  total_amount: text('total_amount').notNull(),
  status: text('status').notNull(),
  milestone_one_amount: text('milestone_one_amount').notNull(),
  milestone_one_status: text('milestone_one_status').notNull(),
  milestone_one_evidence: text('milestone_one_evidence'),
  milestone_two_amount: text('milestone_two_amount').notNull(),
  milestone_two_status: text('milestone_two_status').notNull(),
  milestone_two_evidence: text('milestone_two_evidence'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const audits = pgTable('audits', {
  audit_id: text('audit_id').primaryKey(),
  trace_id: text('trace_id').notNull(),
  cleanverse_request_ids: text('cleanverse_request_ids').notNull(),
  actor_role: text('actor_role').notNull(),
  operation: text('operation').notNull(),
  decision: text('decision').notNull(),
  reason_code: text('reason_code'),
  trade_id: text('trade_id').notNull(),
  milestone_id: integer('milestone_id'),
  evidence_age_seconds: integer('evidence_age_seconds'),
  apass_code: integer('apass_code'),
  validator_valid: integer('validator_valid'),
  validator_available: integer('validator_available'),
  token: text('token').notNull(),
  amount: text('amount').notNull(),
  tx_hash: text('tx_hash'),
  observed_at: text('observed_at').notNull(),
  redacted_context: text('redacted_context').notNull(),
});

export const nonces = pgTable('nonces', {
  nonce_key: text('nonce_key').primaryKey(),
  consumed_at: text('consumed_at').notNull(),
});

export const idempotency = pgTable('idempotency', {
  idem_key: text('idem_key').primaryKey(),
  operation_id: text('operation_id').notNull(),
  result_json: text('result_json').notNull(),
});

export const releases = pgTable('releases', {
  release_id: text('release_id').primaryKey(),
  trade_id: text('trade_id').notNull(),
  auth_json: text('auth_json').notNull(),
  signature: text('signature').notNull(),
  created_at: text('created_at').notNull(),
});

export const tx_hashes = pgTable('tx_hashes', {
  operation_id: text('operation_id').primaryKey(),
  tx_hash: text('tx_hash').notNull(),
});

export const disputes = pgTable('disputes', {
  dispute_id: text('dispute_id').primaryKey(),
  trade_id: text('trade_id').notNull(),
  flagged_by: text('flagged_by').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  resolution: text('resolution'),
  required_signatures: integer('required_signatures').notNull(),
  signers_json: text('signers_json').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const evidence = pgTable('evidence', {
  evidence_id: text('evidence_id').primaryKey(),
  dispute_id: text('dispute_id').notNull(),
  submitted_by: text('submitted_by').notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  digest: text('digest').notNull(),
  payload_json: text('payload_json').notNull(),
  created_at: text('created_at').notNull(),
});
