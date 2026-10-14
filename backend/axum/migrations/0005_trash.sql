-- The trash of the disks: whether a deletion goes there and after how many days it leaves. One
-- row, none until the settings are changed from their defaults (on, 30 days).
CREATE TABLE trash (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    days    INTEGER NOT NULL
) STRICT;

-- When something went into the trash, for what the disk cannot say itself: the deletions of the
-- Explorer, and the first time the others were found on a disk without a reliable ctime. By the
-- path of the entry inside the trash.
CREATE TABLE trash_dates (
    path       TEXT    PRIMARY KEY,
    deleted_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
