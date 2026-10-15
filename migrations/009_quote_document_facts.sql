ALTER TABLE quotes ADD COLUMN quote_number VARCHAR(40) NULL, ADD COLUMN document_facts JSON NULL, ADD UNIQUE KEY quotes_quote_number (quote_number);
UPDATE quotes SET quote_number=CONCAT('Q-',YEAR(created_at),'-',LPAD(id,GREATEST(3,CHAR_LENGTH(id)),'0')) WHERE quote_number IS NULL;
