CREATE TABLE config_lost_reasons (
  reason VARCHAR(80) PRIMARY KEY,
  sort_order INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_lost_reason CHECK (reason IN ('Price','Chose another provider','Staying with current IT','No decision / went dark','Not a fit (disqualified)','Timing (revisit later)','Other'))
);
INSERT INTO config_lost_reasons (reason,sort_order) VALUES
('Price',0),('Chose another provider',1),('Staying with current IT',2),
('No decision / went dark',3),('Not a fit (disqualified)',4),('Timing (revisit later)',5),('Other',6);
