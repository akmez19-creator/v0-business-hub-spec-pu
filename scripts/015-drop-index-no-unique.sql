-- Drop the unique constraint on index_no to allow duplicate values
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_index_no_unique;
DROP INDEX IF EXISTS deliveries_index_no_unique;
