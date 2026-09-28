ALTER TABLE sp_requests ADD COLUMN acknowledged_at DATETIME NULL, ADD COLUMN acknowledged_by VARCHAR(255) NULL, ADD COLUMN target_item_id INT NULL;
