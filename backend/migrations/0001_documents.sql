-- App documents such as settings and favorites, one JSON value per name.
CREATE TABLE documents (
    name       TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
