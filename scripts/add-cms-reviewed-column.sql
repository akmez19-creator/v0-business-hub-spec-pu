-- Add column to track if CMS delivery has been reviewed by admin
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cms_reviewed BOOLEAN DEFAULT FALSE;
