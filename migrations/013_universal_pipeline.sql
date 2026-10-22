-- Shared business identity for the sales pipeline.
CREATE TABLE businesses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  name_key CHAR(64) NOT NULL,
  contact_name VARCHAR(255) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  phone VARCHAR(80) NOT NULL DEFAULT '',
  street_address VARCHAR(500) NULL, city VARCHAR(500) NULL, state VARCHAR(80) NULL, zip VARCHAR(10) NULL,
  client_id VARCHAR(80) NULL UNIQUE, client_item_id VARCHAR(80) NULL,
  relationship_status VARCHAR(30) NOT NULL DEFAULT 'Prospect',
  legacy_origin_key VARCHAR(120) NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX business_name_key (name_key)
);
CREATE TABLE business_identity_locks (name_key CHAR(64) PRIMARY KEY);
ALTER TABLE prospects
  ADD COLUMN business_id BIGINT UNSIGNED NULL,
  ADD COLUMN engagement_type VARCHAR(30) NOT NULL DEFAULT 'bii',
  ADD COLUMN opportunity_title VARCHAR(255) NOT NULL DEFAULT '',
  ADD CONSTRAINT fk_prospect_business FOREIGN KEY (business_id) REFERENCES businesses(id);
INSERT INTO businesses (name,name_key,contact_name,email,phone,street_address,city,state,zip,client_id,client_item_id,legacy_origin_key)
SELECT p.business_name,SHA2(LOWER(TRIM(p.business_name)),256),p.contact_name,p.email,p.phone,p.street_address,p.city,p.state,p.zip,NULLIF(p.client_id,''),p.client_item_id,
CASE WHEN NULLIF(p.client_id,'') IS NOT NULL THEN CONCAT('CLIENT:',p.client_id) ELSE CONCAT('OPP:',p.id) END
FROM prospects p JOIN (SELECT MIN(id) AS id FROM prospects GROUP BY CASE WHEN NULLIF(client_id,'') IS NOT NULL THEN CONCAT('CLIENT:',client_id) ELSE CONCAT('OPP:',id) END) seed ON seed.id=p.id;
UPDATE prospects p JOIN businesses b ON b.legacy_origin_key=CASE WHEN NULLIF(p.client_id,'') IS NOT NULL THEN CONCAT('CLIENT:',p.client_id) ELSE CONCAT('OPP:',p.id) END
SET p.business_id=b.id,p.engagement_type=CASE WHEN p.service_lane='Managed IT' THEN 'managed_it' ELSE 'bii' END;
UPDATE businesses b SET relationship_status='Customer' WHERE EXISTS (SELECT 1 FROM prospects p WHERE p.business_id=b.id AND p.sharepoint_stage IN ('Client Activation','Onboarding','Go-Live','Operations','Project Delivery','Acceptance'));
INSERT IGNORE INTO config_prices (name,amount) VALUES ('project_minimum_hours',0);
