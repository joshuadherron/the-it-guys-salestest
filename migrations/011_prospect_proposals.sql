ALTER TABLE prospects ADD COLUMN sharepoint_record_id VARCHAR(80) NULL, ADD COLUMN sharepoint_stage VARCHAR(100) NULL;
UPDATE prospects SET sharepoint_record_id=client_id WHERE client_id IS NOT NULL;
CREATE TABLE quote_proposal_states (
  quote_id BIGINT UNSIGNED PRIMARY KEY,
  snapshot_hash VARCHAR(64) NOT NULL,
  step VARCHAR(30) NOT NULL DEFAULT 'record_requested',
  record_request_id BIGINT UNSIGNED NULL,
  record_sync_request_id BIGINT UNSIGNED NULL,
  copy_request_id BIGINT UNSIGNED NULL,
  working_item_id VARCHAR(200) NULL UNIQUE,
  fill_id BIGINT UNSIGNED NULL,
  operation_token VARCHAR(36) NULL,
  lease_until DATETIME NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (quote_id) REFERENCES quotes(id)
);
