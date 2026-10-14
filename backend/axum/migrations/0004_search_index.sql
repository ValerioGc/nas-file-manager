-- The index of the search: every file and folder of the disks, by the path the machine knows it by,
-- with its name in lower case for the search by part of the name. A cache: emptied, it is built
-- again from the disks.
CREATE TABLE search_entries (
    id     INTEGER PRIMARY KEY,
    path   TEXT    NOT NULL UNIQUE,
    parent TEXT    NOT NULL,
    volume TEXT    NOT NULL,
    folded TEXT    NOT NULL
) STRICT;
CREATE INDEX search_entries_parent ON search_entries (parent);

-- The names by their trigrams: a part of three letters or more is found without reading them all.
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

-- Every folder read, with the time it changed then: one that has another time since gained, lost
-- or renamed something, and is read again.
CREATE TABLE search_folders (
    path        TEXT    PRIMARY KEY,
    volume      TEXT    NOT NULL,
    modified_ns INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- The disks whose index is whole: until then their search reads the disk.
CREATE TABLE search_volumes (
    volume TEXT PRIMARY KEY,
    path   TEXT NOT NULL
) STRICT, WITHOUT ROWID;
