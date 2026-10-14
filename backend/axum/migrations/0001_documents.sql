-- The documents of the application: its settings and its favorites, one JSON value each, read by
-- their name.
CREATE TABLE documents (
    name       TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
