-- 探针表：最小外键关系，仅用于 T-14 实测
-- parent(pid) ← child(pid)  REFERENCES parent(pid)
DROP TABLE IF EXISTS child;
DROP TABLE IF EXISTS parent;

CREATE TABLE parent (
  pid TEXT PRIMARY KEY
);

CREATE TABLE child (
  cid TEXT PRIMARY KEY,
  pid TEXT REFERENCES parent(pid)
);
