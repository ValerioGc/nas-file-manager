-- A date belongs to one version of an entry, not to every future file at the same path.
ALTER TABLE trash_dates ADD COLUMN signature TEXT;
