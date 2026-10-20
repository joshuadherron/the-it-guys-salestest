ALTER TABLE prospects
  ADD COLUMN planned_service_lanes JSON NULL,
  ADD COLUMN starting_service_lane VARCHAR(80) NULL,
  ADD COLUMN service_sequence_reason VARCHAR(1000) NULL;
