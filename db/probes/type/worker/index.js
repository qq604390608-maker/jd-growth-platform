// 探针 Worker：T-11 实测（D1 类型亲和与长度行为）—— **不属于业务代码**
// 上游：../../../docs/03-locks/tech-stack.md §3 / §8 T-11
// 路由：/g0 引擎事实 /g1 长度强制 /g2 空串vsNULL /g3 datetime排序 /g4 boolean /g5 中文排序 /g6 UNIQUE与CHECK /all 全量
//
// 设计原则：每一步都记录「原样 SQL + 原样返回或原样错误」，不做结论、不做解释。
// 读回值走 D1 的 JS 驱动（而非 CLI 序列化），因为 item4 问的是「读回类型」。

const X200 = 'x'.repeat(200);
const X300 = 'x'.repeat(300);
const X24 = 'x'.repeat(24);
const CN30 = '中'.repeat(30);
const CN24 = '中'.repeat(24);
const CN25 = '中'.repeat(25);

// 记录 JS 侧的绑定值类型，用来判断驱动是否吞掉了 boolean 等类型
function d(v) {
  if (v === null) return { jsType: 'null', value: null };
  if (v === undefined) return { jsType: 'undefined', value: null };
  if (typeof v === 'object') return { jsType: typeof v, value: '[object]' };
  return { jsType: typeof v, value: v };
}

async function st(env, rec, label, sql, params = []) {
  const e = { label, sql, params: params.map(d) };
  try {
    const p = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
    const r = await p.all();
    e.ok = true;
    e.rows = r.results;
    if (r.meta) e.meta = r.meta;
  } catch (err) {
    e.ok = false;
    e.error = String((err && err.message) || err);
  }
  rec.steps.push(e);
  return e;
}

// 取一个有序的 pid 序列，返回「行数 + 序列串 + 原样行」
async function seq(env, rec, label, sql, params = []) {
  const e = await st(env, rec, label, sql, params);
  if (e.ok) {
    e.sequence = e.rows.map((r) => r.pid).join(',');
    e.count = e.rows.length;
  }
  return e;
}

// ---------------------------------------------------------------- G0 引擎事实
async function g0(env) {
  const rec = { group: 'g0', title: '引擎事实（不属 T-11 结论，仅作前提）', steps: [] };
  await st(env, rec, 'SQLite 引擎版本', 'SELECT sqlite_version() AS sqlite_version');
  await st(env, rec, '可用排序规则清单', 'PRAGMA collation_list');
  await st(env, rec, '编译选项', 'PRAGMA compile_options');
  await st(env, rec, '探针表 probe_type 的原样声明（declared type 是否被改写）', 'PRAGMA table_info(probe_type)');
  await st(env, rec, '探针表 probe_dt 的原样声明', 'PRAGMA table_info(probe_dt)');
  await st(env, rec, '探针表 probe_check 的原样声明', 'PRAGMA table_info(probe_check)');
  await st(env, rec, 'length() 对中文：字符 vs 字节', "SELECT length('中') AS chars, length(cast('中' as blob)) AS bytes, hex('中') AS hex");
  return rec;
}

// ---------------------------------------------------- G1 长度是否被强制（item1）
async function g1(env) {
  const rec = { group: 'g1', title: 'item1：varchar(24) 存入 200 字符 —— 是否截断 / 报错 / 读回长度', steps: [] };
  await st(env, rec, '① varchar(24) 写入 200 字符', 'INSERT INTO probe_type (tag, c_v24) VALUES (?, ?)', ['len200', X200]);
  await st(
    env, rec,
    '② 读回：字符数 / 字节数 / 存储类 / 首尾各 5 字符（尾部完整=未截断）',
    'SELECT tag, length(c_v24) AS chars, length(cast(c_v24 AS blob)) AS bytes, typeof(c_v24) AS storage_class, substr(c_v24,1,5) AS head, substr(c_v24,-5) AS tail FROM probe_type WHERE tag = ?',
    ['len200']
  );
  await st(env, rec, '③ varchar(200) 写入 300 字符', 'INSERT INTO probe_type (tag, c_v200) VALUES (?, ?)', ['len300', X300]);
  await st(
    env, rec,
    '④ 读回 varchar(200) 列',
    'SELECT tag, length(c_v200) AS chars, typeof(c_v200) AS storage_class FROM probe_type WHERE tag = ?',
    ['len300']
  );
  await st(env, rec, '⑤ varchar(24) 写入恰好 24 字符（边界值）', 'INSERT INTO probe_type (tag, c_v24) VALUES (?, ?)', ['len24', X24]);
  await st(
    env, rec,
    '⑥ varchar(24) 写入 30 个中文字符（30 字符 / 90 字节）',
    'INSERT INTO probe_type (tag, c_v24) VALUES (?, ?)',
    ['cn30', CN30]
  );
  await st(
    env, rec,
    '⑦ 读回中文行：字符数 / 字节数',
    'SELECT tag, length(c_v24) AS chars, length(cast(c_v24 AS blob)) AS bytes, typeof(c_v24) AS storage_class FROM probe_type WHERE tag = ?',
    ['cn30']
  );
  await st(
    env, rec,
    '⑧ 统计：有多少行实际超出声明长度 24',
    'SELECT count(*) AS rows_over_24 FROM probe_type WHERE c_v24 IS NOT NULL AND length(c_v24) > 24'
  );
  await st(
    env, rec,
    '⑨ 对同一列做 MIN/MAX 长度：声明长度与实存长度是否脱钩',
    'SELECT min(length(c_v24)) AS min_chars, max(length(c_v24)) AS max_chars FROM probe_type WHERE c_v24 IS NOT NULL'
  );
  return rec;
}

// ------------------------------------------- G2 空串 vs NULL（item2）与 NOT NULL
async function g2(env) {
  const rec = { group: 'g2', title: 'item2：空串 vs NULL 是否可区分；NOT NULL 与 UNIQUE 遇二者的行为', steps: [] };
  await st(env, rec, '① NOT NULL 列写入空串（应成功）', 'INSERT INTO probe_nn (tag, c_nn, c_u) VALUES (?, ?, ?)', ['empty_str', '', '']);
  await st(env, rec, '② NOT NULL 列缺省写入（应报 NOT NULL）', "INSERT INTO probe_nn (tag, c_u) VALUES ('nn_missing', NULL)");
  await st(env, rec, '③ UNIQUE 列再写一个空串（应报 UNIQUE）', 'INSERT INTO probe_nn (tag, c_nn, c_u) VALUES (?, ?, ?)', ['empty_str_2', 'b', '']);
  await st(env, rec, '④ UNIQUE 列写 NULL 两次（预期均成功：NULL 互不相等）', 'INSERT INTO probe_nn (tag, c_nn, c_u) VALUES (?, ?, NULL)', ['null_1', 'c']);
  await st(env, rec, '⑤ UNIQUE 列写 NULL 第三次', 'INSERT INTO probe_nn (tag, c_nn, c_u) VALUES (?, ?, NULL)', ['null_2', 'd']);
  await st(
    env, rec,
    '⑥ 逐行读回：IS NULL 判定 / length / typeof / quote（原样）',
    'SELECT id, tag, c_nn, c_nn IS NULL AS is_null, length(c_nn) AS len, typeof(c_nn) AS cls, quote(c_nn) AS quoted FROM probe_nn ORDER BY id'
  );
  await st(env, rec, '⑦ 空串行能否被 IS NULL 命中（期望 0 行）', "SELECT count(*) AS cnt FROM probe_nn WHERE c_nn IS NULL");
  await st(env, rec, '⑧ 空串行能否被 = \'\' 命中（期望 1 行）', "SELECT count(*) AS cnt, group_concat(tag, ',') AS tags FROM probe_nn WHERE c_nn = ''");
  await st(env, rec, '⑨ 用 length()=0 能否找到空串（期望 1 行）', 'SELECT count(*) AS cnt FROM probe_nn WHERE length(c_nn) = 0');
  await st(env, rec, '⑩ c_u 列中 NULL 的行数', 'SELECT count(*) AS cnt_null FROM probe_nn WHERE c_u IS NULL');
  await st(env, rec, '⑪ c_u 列中空串的行数', "SELECT count(*) AS cnt_empty FROM probe_nn WHERE c_u = ''");
  return rec;
}

// ------------------------------- G3 datetime 字符串排序 vs 时间排序（item3）
async function g3(env) {
  const rec = { group: 'g3', title: 'item3：datetime 落 TEXT(ISO8601 UTC) 后字符串排序是否等于时间排序', steps: [] };

  //  三组样本：跨时区 / 跨月 / 含闰日
  const rows = [
    ['a1', 'TZ', '2026-03-01T00:30:00+08:00', '2026-02-28T16:30:00Z'],
    ['a2', 'TZ', '2026-02-28T20:00:00-05:00', '2026-03-01T01:00:00Z'],
    ['b1', 'MONTH', '2026-01-31T23:59:59Z', '2026-01-31T23:59:59Z'],
    ['b2', 'MONTH', '2026-02-01T00:00:01Z', '2026-02-01T00:00:01Z'],
    ['c1', 'LEAP', '2024-02-29T23:59:59Z', '2024-02-29T23:59:59Z'],
    ['c2', 'LEAP', '2024-03-01T00:00:00Z', '2024-03-01T00:00:00Z'],
    ['c3', 'LEAP', '2024-02-28T12:00:00Z', '2024-02-28T12:00:00Z'],
    // 反例：未零填充
    ['p1', 'PAD', '2026-9-18T00:00:00Z', '2026-9-18T00:00:00Z'],
    ['p2', 'PAD', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'],
  ];
  for (const [pid, grp, local, utc] of rows) {
    await st(
      env, rec,
      `写入样本 ${pid}（${grp}）`,
      'INSERT INTO probe_dt (pid, grp, local_txt, utc_txt, dt_col) VALUES (?, ?, ?, ?, ?)',
      [pid, grp, local, utc, utc]
    );
  }
  // 混合存储类样本（放进 datetime 声明列）
  await st(env, rec, '写入 m1：ISO 字符串', 'INSERT INTO probe_dt (pid, grp, utc_txt, dt_col) VALUES (?, ?, ?, ?)', ['m1', 'MIX', '2025-09-18T00:00:00Z', '2025-09-18T00:00:00Z']);
  await st(env, rec, '写入 m2：纯数字串 20260918120000', 'INSERT INTO probe_dt (pid, grp, utc_txt, dt_col) VALUES (?, ?, ?, ?)', ['m2', 'MIX', '20260918120000', '20260918120000']);
  await st(env, rec, '写入 m3：JS number 绑定（epoch 毫秒）', 'INSERT INTO probe_dt (pid, grp, utc_txt, dt_col) VALUES (?, ?, ?, ?)', ['m3', 'MIX', '1758200000000', 1758200000000]);

  // datetime 声明列的实际存储类
  await st(
    env, rec,
    'datetime 声明列的存储类（ISO 串是否原样落 TEXT）',
    'SELECT pid, grp, dt_col, typeof(dt_col) AS storage_class, quote(dt_col) AS quoted FROM probe_dt ORDER BY pid'
  );

  // julianday 能否解析这些串
  await st(
    env, rec,
    'julianday() 解析对照（若为 NULL 则该串不可被时间函数识别）',
    'SELECT pid, grp, utc_txt, julianday(utc_txt) AS jd FROM probe_dt WHERE grp <> \'MIX\' ORDER BY pid'
  );

  for (const grp of ['TZ', 'MONTH', 'LEAP', 'PAD']) {
    const s = await seq(env, rec, `[${grp}] 字符串排序 ORDER BY utc_txt`, `SELECT pid FROM probe_dt WHERE grp = '${grp}' ORDER BY utc_txt`);
    const t = await seq(env, rec, `[${grp}] 时间排序 ORDER BY julianday(utc_txt)`, `SELECT pid FROM probe_dt WHERE grp = '${grp}' ORDER BY julianday(utc_txt)`);
    rec[`compare_${grp}`] = {
      string_order: s.sequence,
      time_order: t.sequence,
      match: s.sequence === t.sequence,
      rows: s.count,
    };
  }
  // 跨时区组额外比一次「本地带偏移串」的排序
  const ls = await seq(env, rec, '[TZ] 本地带偏移串排序 ORDER BY local_txt', "SELECT pid FROM probe_dt WHERE grp = 'TZ' ORDER BY local_txt");
  rec.compare_TZ.local_order = ls.sequence;
  rec.compare_TZ.local_match_time = ls.sequence === rec.compare_TZ.time_order;

  // 混合存储类下的排序
  const ms = await seq(env, rec, '[MIX] 混合存储类排序 ORDER BY dt_col', "SELECT pid FROM probe_dt WHERE grp = 'MIX' ORDER BY dt_col");
  const mt = await seq(env, rec, '[MIX] 同一批按 julianday(dt_col) 排序', "SELECT pid FROM probe_dt WHERE grp = 'MIX' ORDER BY julianday(dt_col)");
  rec.compare_MIX = { by_column: ms.sequence, by_julianday: mt.sequence, match: ms.sequence === mt.sequence };
  return rec;
}

// ------------------------------------------------- G4 boolean 实际存储值（item4）
async function g4(env) {
  const rec = { group: 'g4', title: 'item4：boolean 的实际存储值与读回类型（SQL 字面量 + JS 驱动绑定）', steps: [] };
  const sqlLits = [
    ['bool_kw_true', 'true'],
    ['bool_kw_false', 'false'],
    ['bool_kw_TRUE', 'TRUE'],
    ['bool_str_true', "'true'"],
    ['bool_str_yes', "'yes'"],
    ['bool_int_1', '1'],
    ['bool_int_0', '0'],
    ['bool_int_2', '2'],
  ];
  for (const [tag, lit] of sqlLits) {
    await st(env, rec, `SQL 字面量：c_bool = ${lit}`, `INSERT INTO probe_type (tag, c_bool) VALUES ('${tag}', ${lit})`);
  }
  // JS 驱动绑定：boolean 是 JS 原生类型，D1 是否接受
  await st(env, rec, 'JS 驱动绑定：.bind(true)', 'INSERT INTO probe_type (tag, c_bool) VALUES (?, ?)', ['bool_bind_true', true]);
  await st(env, rec, 'JS 驱动绑定：.bind(false)', 'INSERT INTO probe_type (tag, c_bool) VALUES (?, ?)', ['bool_bind_false', false]);
  await st(env, rec, 'JS 驱动绑定：.bind(1)', 'INSERT INTO probe_type (tag, c_bool) VALUES (?, ?)', ['bool_bind_1', 1]);
  await st(env, rec, 'JS 驱动绑定：.bind("true")', 'INSERT INTO probe_type (tag, c_bool) VALUES (?, ?)', ['bool_bind_str', 'true']);

  await st(
    env, rec,
    '读回：原样值 / 存储类 / quote / 与 1 的等值判定',
    "SELECT tag, c_bool, typeof(c_bool) AS storage_class, quote(c_bool) AS quoted, (c_bool = 1) AS eq_int_1, (c_bool = 0) AS eq_int_0 FROM probe_type WHERE tag LIKE 'bool_%' ORDER BY tag"
  );
  await st(
    env, rec,
    '读回：区分 INTEGER 1 与 TEXT \'true\'',
    "SELECT typeof(c_bool) AS storage_class, count(*) AS cnt, group_concat(tag, ',') AS tags FROM probe_type WHERE tag LIKE 'bool_%' GROUP BY typeof(c_bool)"
  );
  await st(
    env, rec,
    'tinyint 列的存储类（schema.md 用 17 次，原意多为布尔，需知其真实存储）',
    "SELECT tag, c_tiny, typeof(c_tiny) AS storage_class FROM probe_type WHERE c_tiny IS NOT NULL"
  );
  await st(env, rec, 'tinyint 写入 true 字面量', "INSERT INTO probe_type (tag, c_tiny) VALUES ('tiny_true', true)");
  await st(env, rec, 'tinyint 写入 2（是否拦越界）', "INSERT INTO probe_type (tag, c_tiny) VALUES ('tiny_2', 2)");
  await st(env, rec, 'tinyint 写入 300（是否拦越界）', "INSERT INTO probe_type (tag, c_tiny) VALUES ('tiny_300', 300)");
  await st(
    env, rec,
    'tinyint 读回',
    "SELECT tag, c_tiny, typeof(c_tiny) AS storage_class FROM probe_type WHERE tag LIKE 'tiny_%' ORDER BY tag"
  );
  return rec;
}

// ---------------------------------------- G5 中文在 BINARY 排序下的行为（item5）
async function g5(env) {
  const rec = { group: 'g5', title: 'item5：中文在 BINARY 排序下是否等于拼音序', steps: [] };
  for (const n of ['张三', '李四', '王五']) {
    await st(env, rec, `写入中文值 ${n}（同时写 varchar(24) 列）`, 'INSERT INTO probe_cn (name, name_v24) VALUES (?, ?)', [n, n]);
  }
  await seq(env, rec, '默认排序 ORDER BY name（无 COLLATE，即 BINARY）', 'SELECT cid, name FROM probe_cn ORDER BY name');
  await rec.steps[rec.steps.length - 1] && (function () {
    const e = rec.steps[rec.steps.length - 1];
    if (e.ok) e.names = e.rows.map((r) => r.name).join(',');
  })();
  const b = await seq(env, rec, '显式 ORDER BY name COLLATE BINARY', 'SELECT cid, name FROM probe_cn ORDER BY name COLLATE BINARY');
  if (b.ok) b.names = b.rows.map((r) => r.name).join(',');
  const nc = await seq(env, rec, 'ORDER BY name COLLATE NOCASE（是否影响中文）', 'SELECT cid, name FROM probe_cn ORDER BY name COLLATE NOCASE');
  if (nc.ok) nc.names = nc.rows.map((r) => r.name).join(',');
  const de = await seq(env, rec, 'ORDER BY name DESC', 'SELECT cid, name FROM probe_cn ORDER BY name DESC');
  if (de.ok) de.names = de.rows.map((r) => r.name).join(',');
  await st(env, rec, '字节层面证据：UTF-8 十六进制与码点', "SELECT cid, name, hex(name) AS utf8_hex, unicode(substr(name,1,1)) AS first_codepoint FROM probe_cn ORDER BY name");
  await st(env, rec, '尝试拼音排序规则 COLLATE PINYIN（预期：无此排序规则）', 'SELECT cid, name FROM probe_cn ORDER BY name COLLATE PINYIN');
  await st(env, rec, '尝试 COLLATE ICALLBACK，即 COLLATE zh（预期：无此排序规则）', 'SELECT cid, name FROM probe_cn ORDER BY name COLLATE zh');
  await st(env, rec, '中文值在 varchar(24) 列的字符数/字节数', 'SELECT cid, name, length(name) AS chars, length(cast(name AS blob)) AS bytes FROM probe_cn ORDER BY cid');
  return rec;
}

// --------------------------------- G6 复合 UNIQUE 与 CHECK（item6）
async function g6(env) {
  const rec = { group: 'g6', title: 'item6：复合 UNIQUE 与 CHECK（length/glob/typeof）是否按预期生效', steps: [] };
  // 复合 UNIQUE
  await st(env, rec, 'UNIQUE ① 写 (g1,1)', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', ['g1', 1]);
  await st(env, rec, 'UNIQUE ② 再写 (g1,1) —— 预期报 UNIQUE', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', ['g1', 1]);
  await st(env, rec, 'UNIQUE ③ 写 (g1,2) —— 预期成功（复合键第二列不同）', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', ['g1', 2]);
  await st(env, rec, 'UNIQUE ④ 写 (NULL,1)', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', [null, 1]);
  await st(env, rec, 'UNIQUE ⑤ 再写 (NULL,1) —— 预期成功（含 NULL 的复合键互不相等）', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', [null, 1]);
  await st(env, rec, 'UNIQUE ⑥ 写 (g1,NULL) 两次', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', ['g1', null]);
  await st(env, rec, 'UNIQUE ⑦ 同上一行', 'INSERT INTO probe_uk (goal_id, version_no) VALUES (?, ?)', ['g1', null]);
  await st(env, rec, 'UNIQUE 结果全集', "SELECT rowid, goal_id, version_no, quote(goal_id) AS q_goal, quote(version_no) AS q_ver FROM probe_uk ORDER BY rowid");
  await st(env, rec, 'UNIQUE 索引定义原样', "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='probe_uk'");

  // 多约束同表：目的只有两个 —— ①看 NULL 在各约束下的放行行为 ②看多约束同时失败时报哪一条
  await st(env, rec, '多约束同表 ① 全部合法（code=24 / kind=F-01 / ts=ISO）', 'INSERT INTO probe_check (tag, code, kind, ts) VALUES (?, ?, ?, ?)', ['ok_all', X24, 'F-01', '2026-09-18T00:00:00Z']);
  await st(env, rec, '多约束同表 ② ts = NULL', 'INSERT INTO probe_check (tag, ts) VALUES (?, NULL)', ['ts_null']);
  await st(env, rec, '多约束同表 ③ ts 合法、code = NULL', 'INSERT INTO probe_check (tag, code, ts) VALUES (?, NULL, ?)', ['code_null', '2026-09-18T00:00:00Z']);
  await st(env, rec, '多约束同表 ④ ts 合法、kind = NULL', 'INSERT INTO probe_check (tag, kind, ts) VALUES (?, NULL, ?)', ['kind_null', '2026-09-18T00:00:00Z']);
  await st(env, rec, '多约束同表 ⑤ ts 合法、code = 25 字符', 'INSERT INTO probe_check (tag, code, ts) VALUES (?, ?, ?)', ['code25', 'x'.repeat(25), '2026-09-18T00:00:00Z']);
  await st(env, rec, '多约束同表 ⑥ 同时违反两列（code 25 字符 + kind=X-1）', 'INSERT INTO probe_check (tag, code, kind, ts) VALUES (?, ?, ?, ?)', ['both', 'x'.repeat(25), 'X-1', '2026-09-18T00:00:00Z']);
  await st(env, rec, '多约束同表 读回', 'SELECT id, tag, code, kind, ts FROM probe_check ORDER BY id');
  await st(env, rec, '多约束同表 DDL 原样', "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_check'");
  return rec;
}

// ------------- G6b 隔离约束下的 CHECK（第一轮未隔离，结论不可用，此轮为结论性判定）
async function g6b(env) {
  const rec = { group: 'g6b', title: 'item6b：CHECK 隔离测试（length / glob / typeof + NULL 放行 + UPDATE + 中文按字符计）', steps: [] };

  // length()
  await st(env, rec, '[len] code = 24 字符', 'INSERT INTO probe_check_len (tag, code) VALUES (?, ?)', ['len24', X24]);
  await st(env, rec, '[len] code = 25 字符', 'INSERT INTO probe_check_len (tag, code) VALUES (?, ?)', ['len25', 'x'.repeat(25)]);
  await st(env, rec, '[len] code = NULL —— 关键：length(NULL)<=24 求值为 NULL 时是否放行', 'INSERT INTO probe_check_len (tag, code) VALUES (?, NULL)', ['len_null']);
  await st(env, rec, '[len] code = 空串', 'INSERT INTO probe_check_len (tag, code) VALUES (?, ?)', ['len_empty', '']);
  await st(env, rec, '[len] code = 24 个中文（24 字符 / 72 字节）', 'INSERT INTO probe_check_len (tag, code) VALUES (?, ?)', ['len_cn24', CN24]);
  await st(env, rec, '[len] code = 25 个中文（25 字符 / 75 字节）', 'INSERT INTO probe_check_len (tag, code) VALUES (?, ?)', ['len_cn25', CN25]);
  await st(env, rec, '[len] UPDATE len24 改为 25 字符 —— CHECK 是否约束 UPDATE', 'UPDATE probe_check_len SET code = ? WHERE tag = ?', ['y'.repeat(25), 'len24']);
  await st(env, rec, '[len] UPDATE len24 改回 24 字符', 'UPDATE probe_check_len SET code = ? WHERE tag = ?', [X24, 'len24']);
  await st(env, rec, '[len] UPDATE len_null 行（原为 NULL）写入 25 字符', "UPDATE probe_check_len SET code = ? WHERE tag = 'len_null'", ['z'.repeat(25)]);
  await st(env, rec, '[len] UPDATE len_null 行写入 NULL', "UPDATE probe_check_len SET code = NULL WHERE tag = 'len_null'");
  await st(env, rec, '[len] 读回（含长度、字节与存储类）', 'SELECT id, tag, code IS NULL AS is_null, length(code) AS chars, length(cast(code AS blob)) AS bytes, typeof(code) AS cls FROM probe_check_len ORDER BY id');
  await st(env, rec, '[len] DDL 原样', "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_check_len'");

  // glob()
  for (const v of ['F-01', 'F-999', 'F-1', 'X-1', '', 'F-01extra', 'f-01']) {
    const tag = 'v_' + (v.replace(/[^A-Za-z0-9]/g, '') || 'empty');
    await st(env, rec, `[glob] kind = ${JSON.stringify(v)}`, 'INSERT INTO probe_check_glob (tag, kind) VALUES (?, ?)', [tag, v]);
  }
  await st(env, rec, '[glob] kind = NULL', 'INSERT INTO probe_check_glob (tag, kind) VALUES (?, NULL)', ['v_null']);
  await st(env, rec, '[glob] 读回', 'SELECT id, tag, kind, typeof(kind) AS cls FROM probe_check_glob ORDER BY id');
  await st(env, rec, '[glob] DDL 原样', "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_check_glob'");

  // typeof()
  await st(env, rec, '[typeof] ts = ISO 串', 'INSERT INTO probe_check_type (tag, ts) VALUES (?, ?)', ['iso', '2026-09-18T00:00:00Z']);
  await st(env, rec, '[typeof] ts = JS number', 'INSERT INTO probe_check_type (tag, ts) VALUES (?, ?)', ['num', 20260918]);
  await st(env, rec, '[typeof] ts = 纯数字串（数字亲和是否转成 integer）', 'INSERT INTO probe_check_type (tag, ts) VALUES (?, ?)', ['numstr', '20260918']);
  await st(env, rec, '[typeof] ts = 空串', 'INSERT INTO probe_check_type (tag, ts) VALUES (?, ?)', ['empty', '']);
  await st(env, rec, '[typeof] ts = NULL —— typeof(NULL)=\'null\' 是否放行', 'INSERT INTO probe_check_type (tag, ts) VALUES (?, NULL)', ['null']);
  await st(env, rec, '[typeof] 读回', 'SELECT id, tag, ts, typeof(ts) AS cls FROM probe_check_type ORDER BY id');
  await st(env, rec, '[typeof] DDL 原样', "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_check_type'");

  // 多约束同时失败时报哪一条
  await st(env, rec, '[multi] code 25 + kind=X-1 同时违反', 'INSERT INTO probe_check_multi (tag, code, kind) VALUES (?, ?, ?)', ['both', 'x'.repeat(25), 'X-1']);
  await st(env, rec, '[multi] 仅 code 25', 'INSERT INTO probe_check_multi (tag, code, kind) VALUES (?, ?, ?)', ['c25', 'x'.repeat(25), 'F-01']);
  await st(env, rec, '[multi] 仅 kind=X-1', 'INSERT INTO probe_check_multi (tag, code, kind) VALUES (?, ?, ?)', ['kbad', X24, 'X-1']);
  await st(env, rec, '[multi] DDL 原样', "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_check_multi'");
  return rec;
}

// ------------- 只读复核：顺序无关，补读前序分组留在库里的状态
async function recheck(env) {
  const rec = { group: 'recheck', title: '只读复核：空串/NULL 同列对照、tinyint 越界、boolean 存储类、中文排序、复合 UNIQUE 落库', steps: [] };
  await st(env, rec, '空串与 NULL 同列对照（c_u 列同时含两类值）', 'SELECT id, tag, c_u IS NULL AS is_null, length(c_u) AS len, typeof(c_u) AS cls, quote(c_u) AS quoted FROM probe_nn ORDER BY id');
  await st(env, rec, 'c_u 列：NULL 与空串计数', "SELECT sum(c_u IS NULL) AS cnt_null, sum(c_u = '') AS cnt_empty, count(*) AS total FROM probe_nn");
  await st(env, rec, 'tinyint 写 300 后的落库值与存储类（是否拦越界）', "SELECT tag, c_tiny, typeof(c_tiny) AS cls FROM probe_type WHERE tag LIKE 'tiny_%' ORDER BY tag");
  await st(env, rec, 'boolean 列两种存储类并存计数', "SELECT typeof(c_bool) AS cls, count(*) AS cnt FROM probe_type WHERE tag LIKE 'bool_%' GROUP BY typeof(c_bool)");
  await st(env, rec, 'datetime 列各存储类计数', "SELECT typeof(dt_col) AS cls, count(*) AS cnt FROM probe_dt WHERE dt_col IS NOT NULL GROUP BY typeof(dt_col)");
  await st(env, rec, '中文默认排序结果（原样）', 'SELECT name FROM probe_cn ORDER BY name');
  await st(env, rec, '中文 DESC 排序结果（原样）', 'SELECT name FROM probe_cn ORDER BY name DESC');
  await st(env, rec, '复合 UNIQUE 最终落库行', 'SELECT rowid, goal_id, version_no FROM probe_uk ORDER BY rowid');
  return rec;
}

// ------------- G6c CHECK 能否表达「字节」上限
async function g6c(env) {
  const rec = { group: 'g6c', title: 'item6c：CHECK 用 length(cast(x AS blob)) 表达「字节」上限是否可行', steps: [] };
  await st(env, rec, '[bytes] 24 个 ASCII（24 字节）', 'INSERT INTO probe_check_bytes (tag, code) VALUES (?, ?)', ['a24', X24]);
  await st(env, rec, '[bytes] 25 个 ASCII（25 字节）', 'INSERT INTO probe_check_bytes (tag, code) VALUES (?, ?)', ['a25', 'x'.repeat(25)]);
  await st(env, rec, '[bytes] 8 个中文（24 字节 / 8 字符）', 'INSERT INTO probe_check_bytes (tag, code) VALUES (?, ?)', ['cn8', '中'.repeat(8)]);
  await st(env, rec, '[bytes] 9 个中文（27 字节 / 9 字符）', 'INSERT INTO probe_check_bytes (tag, code) VALUES (?, ?)', ['cn9', '中'.repeat(9)]);
  await st(env, rec, '[bytes] 12 个中文（36 字节 / 12 字符）', 'INSERT INTO probe_check_bytes (tag, code) VALUES (?, ?)', ['cn12', '中'.repeat(12)]);
  await st(env, rec, '[bytes] NULL', 'INSERT INTO probe_check_bytes (tag, code) VALUES (?, NULL)', ['b_null']);
  await st(env, rec, '[bytes] 读回（字符数与字节数对照）', 'SELECT id, tag, length(code) AS chars, length(cast(code AS blob)) AS bytes FROM probe_check_bytes ORDER BY id');
  await st(env, rec, '[bytes] DDL 原样', "SELECT sql FROM sqlite_master WHERE type='table' AND name='probe_check_bytes'");
  return rec;
}

const GROUPS = { g0, g1, g2, g3, g4, g5, g6, g6b, g6c, recheck };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
    try {
      if (path === '/all') {
        const out = { note: '原样执行记录，不做结论', groups: {} };
        for (const k of Object.keys(GROUPS)) out.groups[k] = await GROUPS[k](env);
        return Response.json(out);
      }
      const key = path.slice(1);
      if (GROUPS[key]) return Response.json(await GROUPS[key](env));
      return new Response('routes: /g0 /g1 /g2 /g3 /g4 /g5 /g6 /all', { status: 404 });
    } catch (e) {
      return Response.json({ ok: false, fatal: String((e && e.message) || e) }, { status: 500 });
    }
  },
};
