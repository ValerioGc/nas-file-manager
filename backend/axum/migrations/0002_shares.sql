-- The folders shared on the local network, by their path in the Explorer. The launcher keeps the
-- copy Samba reads; the name is the one the computers of the network see.
CREATE TABLE shares (
    path       TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    writable   INTEGER NOT NULL CHECK (writable IN (0, 1)),
    protected  INTEGER NOT NULL CHECK (protected IN (0, 1)),
    created_at INTEGER NOT NULL
) STRICT;
