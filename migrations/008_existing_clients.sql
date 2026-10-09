ALTER TABLE prospects ADD COLUMN relationship_type ENUM('new_client','existing_client') NOT NULL DEFAULT 'new_client';
CREATE INDEX prospects_client_id ON prospects (client_id);
CREATE TABLE additional_service_discoveries (prospect_id BIGINT UNSIGNED PRIMARY KEY, answers JSON NOT NULL, revision INT NOT NULL DEFAULT 0, complete BOOLEAN NOT NULL DEFAULT FALSE, updated_by VARCHAR(254) NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (prospect_id) REFERENCES prospects(id));
CREATE TABLE client_request_locks (client_id VARCHAR(80) PRIMARY KEY);
