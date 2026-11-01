-- Ties a date to one version of an entry rather than to every later file at the same path.
ALTER TABLE trash_dates ADD COLUMN signature TEXT;
