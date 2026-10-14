-- The room the previews may take on the disk, chosen in the settings: one row, none until the
-- limit is changed from its default.
CREATE TABLE preview_cache (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    limit_bytes INTEGER NOT NULL
) STRICT;
