-- Search index of every file and folder on the disks, keyed by machine path, with the name in
-- lower case for partial matches. It is a cache and is rebuilt from the disks once emptied.
CREATE TABLE search_entries (
    id     INTEGER PRIMARY KEY,
    path   TEXT    NOT NULL UNIQUE,
    parent TEXT    NOT NULL,
    volume TEXT    NOT NULL,
    folded TEXT    NOT NULL
) STRICT;
CREATE INDEX search_entries_parent ON search_entries (parent);

-- Trigram index on the names, so a fragment of three or more letters is found without a full scan.
CREATE VIRTUAL TABLE search_names USING fts5 (
    folded,
    content = 'search_entries',
    content_rowid = 'id',
    tokenize = 'trigram'
);
CREATE TRIGGER search_entries_added AFTER INSERT ON search_entries BEGIN
    INSERT INTO search_names (rowid, folded) VALUES (new.id, new.folded);
END;
CREATE TRIGGER search_entries_removed AFTER DELETE ON search_entries BEGIN
    INSERT INTO search_names (search_names, rowid, folded) VALUES ('delete', old.id, old.folded);
END;

-- Every folder read, with its modification time at that moment. A different time later means
-- its content changed, so it is read again.
CREATE TABLE search_folders (
    path        TEXT    PRIMARY KEY,
    volume      TEXT    NOT NULL,
    modified_ns INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- Disks with a complete index. Until then their search walks the disk.
CREATE TABLE search_volumes (
    volume TEXT PRIMARY KEY,
    path   TEXT NOT NULL
) STRICT, WITHOUT ROWID;
