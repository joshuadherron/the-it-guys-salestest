ALTER TABLE prospects
  ADD COLUMN street_address VARCHAR(500) NULL AFTER email,
  ADD COLUMN zip VARCHAR(10) NULL AFTER street_address,
  ADD COLUMN state VARCHAR(80) NULL AFTER city;
