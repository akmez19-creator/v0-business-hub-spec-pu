-- Allow authenticated users to read contractor photo_url
CREATE POLICY "Allow read contractor photos"
ON contractors
FOR SELECT
USING (true);

-- If the above fails because a policy already exists, this is a no-op
