-- Disk space limit for previews, set in the settings. A single row, absent until the default
-- limit is changed.
CREATE TABLE preview_cache (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    limit_bytes INTEGER NOT NULL
) STRICT;
