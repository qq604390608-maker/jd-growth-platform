-- db/probes/type/schema.sql
-- 探针表：仅用于 T-11 实测（D1 类型亲和与长度行为），**不是业务迁移**
-- 上游：../../../docs/03-locks/tech-stack.md §3（类型映射表）/ §8 T-11
-- 类型写法来源：docs/03-locks/schema.md 实际出现的 20 种 + 你点名的 integer / real / boolean
-- 禁止：本文件不得移入业务 migration 目录；不得据此给全表加 CHECK
--
-- 覆盖的声明类型（原样照抄，含大小写）：
--   varchar(24) varchar(200) text datetime int tinyint bigint integer real boolean
-- 其余 varchar(n) 写法（8/16/20/32/40/48/64/80/100/120/128/160/300）与上列同属 TEXT 亲和，
-- 长度是否强制由同一机制决定，故不再逐长度建列，实测结论按亲和类推广。

DROP TABLE IF EXISTS probe_type;
DROP TABLE IF EXISTS probe_nn;
DROP TABLE IF EXISTS probe_dt;
DROP TABLE IF EXISTS probe_cn;
DROP TABLE IF EXISTS probe_uk;
DROP TABLE IF EXISTS probe_check;

-- G1 / G4：长度强制、存储类、boolean 实际存储值
CREATE TABLE probe_type (
  row_id   INTEGER PRIMARY KEY,
  tag      TEXT,
  c_v24    varchar(24),
  c_v200   varchar(200),
  c_text   text,
  c_dt     datetime,      -- schema.md 用 32 次；本探针用于验证其亲和与存储类
  c_int    int,           -- schema.md 用 19 次
  c_tiny   tinyint,       -- schema.md 用 17 次
  c_big    bigint,        -- schema.md 用 1 次
  c_int2   integer,       -- schema.md 未出现，你点名
  c_real   real,          -- schema.md 未出现，你点名
  c_bool   boolean        -- schema.md 未出现，你点名
);

-- G2：空串 vs NULL；NOT NULL 语义；UNIQUE 遇空串 / NULL
CREATE TABLE probe_nn (
  id        INTEGER PRIMARY KEY,
  tag       TEXT,
  c_nn      varchar(24) NOT NULL,
  c_u       varchar(24) UNIQUE
);

-- G3：datetime 排序 —— 三列对照
--   local_txt：带时区偏移的本地时间串
--   utc_txt  ：归一化到 UTC 的 ISO 8601 串（Z 结尾）
--   dt_col   ：声明为 datetime 的列（验证亲和与存储类）
CREATE TABLE probe_dt (
  pid       TEXT PRIMARY KEY,
  grp       TEXT,      -- TZ 跨时区 / MONTH 跨月 / LEAP 闰日 / PAD 零填充反例 / MIX 混合存储类
  local_txt TEXT,
  utc_txt   TEXT,
  dt_col    datetime
);

-- G5：中文在 BINARY 排序下的行为
CREATE TABLE probe_cn (
  cid      INTEGER PRIMARY KEY,
  name     TEXT,
  name_v24 varchar(24)
);

-- G6：复合 UNIQUE
CREATE TABLE probe_uk (
  id         INTEGER PRIMARY KEY,
  goal_id    TEXT,
  version_no INTEGER,
  UNIQUE (goal_id, version_no)
);

-- G6：CHECK —— length() / glob() / typeof() 是否可用、NULL 是否穿透
-- 注意：probe_check 是「多约束同表」，用于观察多约束同时失败时 D1 报哪一条；
--       结论性判定一律用下面四张**隔离约束**的表，避免一条约束掩盖另一条的结论。
CREATE TABLE probe_check (
  id   INTEGER PRIMARY KEY,
  tag  TEXT,
  code varchar(24) CHECK (length(code) <= 24),
  opt  varchar(24) CHECK (length(opt) <= 24),
  kind TEXT CHECK (kind GLOB 'F-[0-9]*'),
  ts   datetime CHECK (typeof(ts) = 'text')
);

-- G6b：隔离约束表（第一轮探针未隔离，导致 length/glob 的 NULL 行为无法判定，此轮补测）
DROP TABLE IF EXISTS probe_check_len;
DROP TABLE IF EXISTS probe_check_glob;
DROP TABLE IF EXISTS probe_check_type;
DROP TABLE IF EXISTS probe_check_multi;

CREATE TABLE probe_check_len (
  id   INTEGER PRIMARY KEY,
  tag  TEXT,
  code varchar(24) CHECK (length(code) <= 24)
);

CREATE TABLE probe_check_glob (
  id   INTEGER PRIMARY KEY,
  tag  TEXT,
  kind TEXT CHECK (kind GLOB 'F-[0-9]*')
);

CREATE TABLE probe_check_type (
  id  INTEGER PRIMARY KEY,
  tag TEXT,
  ts  datetime CHECK (typeof(ts) = 'text')
);

-- 多约束同时失败时，报哪一条？
CREATE TABLE probe_check_multi (
  id   INTEGER PRIMARY KEY,
  tag  TEXT,
  code varchar(24) CHECK (length(code) <= 24),
  kind TEXT CHECK (kind GLOB 'F-[0-9]*')
);

-- G6c：CHECK 能否表达「字节」上限（length() 对中文返回字符数，需 cast 成 blob 才是字节）
DROP TABLE IF EXISTS probe_check_bytes;
CREATE TABLE probe_check_bytes (
  id   INTEGER PRIMARY KEY,
  tag  TEXT,
  code TEXT CHECK (length(cast(code AS blob)) <= 24)
);
