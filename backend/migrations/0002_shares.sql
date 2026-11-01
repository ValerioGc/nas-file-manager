-- Folders shared on the local network, keyed by their UI path. The launcher keeps the copy Samba
-- reads, and the name is the one network clients see.
CREATE TABLE shares (
    path       TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    writable   INTEGER NOT NULL CHECK (writable IN (0, 1)),
    protected  INTEGER NOT NULL CHECK (protected IN (0, 1)),
    created_at INTEGER NOT NULL
) STRICT;
