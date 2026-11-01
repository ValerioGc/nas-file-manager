-- Trash settings, whether deletions go to the trash and how many days items are kept. A single
-- row, absent until the defaults (on, 30 days) are changed.
CREATE TABLE trash (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    days    INTEGER NOT NULL
) STRICT;

-- Deletion times the disk cannot provide, keyed by the path inside the trash. They cover the
-- deletions made by Explorer and the first sighting of other items on disks without a reliable
-- ctime.
CREATE TABLE trash_dates (
    path       TEXT    PRIMARY KEY,
    deleted_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
