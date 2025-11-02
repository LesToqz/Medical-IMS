// server.js — Medical IMS backend (Express + PostgreSQL)

const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'medwarehouse',
  max: 10,
  idleTimeoutMillis: 10_000
});

// ----- Schema -----
const SQL_INIT = `
CREATE TABLE IF NOT EXISTS items (
  item_id      SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  sku          TEXT NOT NULL UNIQUE,
  category     TEXT,
  unit         TEXT DEFAULT 'unit',
  min_level    INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lots (
  lot_id       SERIAL PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  lot_no       TEXT NOT NULL,
  expiry_date  DATE NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity >= 0),
  location     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(item_id, lot_no)
);

CREATE TABLE IF NOT EXISTS transactions (
  txn_id       SERIAL PRIMARY KEY,
  item_id      INTEGER REFERENCES items(item_id) ON DELETE SET NULL,
  lot_id       INTEGER REFERENCES lots(lot_id) ON DELETE SET NULL,
  qty_change   INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('RECEIVE','DISPATCH','ADJUST')),
  note         TEXT,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW v_item_stock AS
SELECT i.item_id, i.name, i.sku, i.category, i.unit, i.min_level, i.is_active,
       COALESCE(SUM(l.quantity), 0) AS current_stock
FROM items i
LEFT JOIN lots l ON l.item_id = i.item_id
GROUP BY i.item_id;
`;

// ----- Queries -----
const Q_INSERT_ITEM = `
INSERT INTO items (name, sku, category, unit, min_level)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (sku) DO UPDATE
SET name=EXCLUDED.name, category=EXCLUDED.category, unit=EXCLUDED.unit,
    min_level=EXCLUDED.min_level, updated_at=NOW()
RETURNING *;`;

const Q_FIND_ITEM_BY_SKU = `SELECT * FROM items WHERE sku=$1;`;

const Q_UPSERT_LOT = `
INSERT INTO lots (item_id, lot_no, expiry_date, quantity, location)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (item_id, lot_no) DO UPDATE
SET expiry_date=EXCLUDED.expiry_date,
    quantity=lots.quantity + EXCLUDED.quantity,
    location=COALESCE(EXCLUDED.location, lots.location),
    updated_at=NOW()
RETURNING *;`;

const Q_DECR_LOT_QTY = `
UPDATE lots
SET quantity = quantity - $2, updated_at=NOW()
WHERE lot_id=$1 AND quantity >= $2
RETURNING *;`;

const Q_LOCK_LOTS_FEFO = `
SELECT lot_id, quantity
FROM lots
WHERE item_id=$1 AND quantity>0
ORDER BY expiry_date ASC
FOR UPDATE SKIP LOCKED;`;

const Q_INSERT_TX = `
INSERT INTO transactions (item_id, lot_id, qty_change, type, note)
VALUES ($1,$2,$3,$4,$5);`;

const Q_SELECT_ITEMS = `
SELECT * FROM v_item_stock
WHERE ($1::text IS NULL OR name ILIKE ('%'||$1||'%') OR sku ILIKE ('%'||$1||'%'))
ORDER BY name;`;

const Q_RECENT_TX = `
SELECT t.ts, t.type, t.qty_change,
       i.sku,
       l.lot_no,
       TO_CHAR(l.expiry_date,'YYYY-MM-DD') AS expiry,
       l.location
FROM transactions t
LEFT JOIN items i ON i.item_id = t.item_id
LEFT JOIN lots  l ON l.lot_id  = t.lot_id
ORDER BY t.ts DESC
LIMIT $1;
`;


const Q_STATS = `
WITH s AS (
  SELECT COUNT(*) AS total_items FROM items
),
u AS (
  SELECT COALESCE(SUM(quantity),0) AS units_in_stock FROM lots
),
low AS (
  SELECT COUNT(*) AS low_stock
  FROM v_item_stock
  WHERE current_stock < min_level
),
exp AS (
  SELECT COUNT(DISTINCT item_id) AS expiring_soon
  FROM lots
  WHERE expiry_date <= CURRENT_DATE + ($1 || ' days')::interval
)
SELECT s.total_items, u.units_in_stock, low.low_stock, exp.expiring_soon
FROM s,u,low,exp;`;

const Q_ALERTS = `
SELECT i.sku, i.name, i.min_level,
       COALESCE(SUM(l.quantity),0) AS stock,
       TO_CHAR(MIN(l.expiry_date),'YYYY-MM-DD') AS earliest_expiry
FROM items i
LEFT JOIN lots l ON l.item_id=i.item_id
GROUP BY i.item_id
HAVING COALESCE(SUM(l.quantity),0) < i.min_level
   OR MIN(l.expiry_date) IS NULL
   OR MIN(l.expiry_date) <= CURRENT_DATE + ($1 || ' days')::interval
ORDER BY i.name;`;


// ----- Init -----
async function init() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(SQL_INIT);
    await c.query('COMMIT');
    console.log('✅ DB schema ready');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('DB init failed:', e.message);
  } finally {
    c.release();
  }
}
init();

// ----- API -----
app.get('/api/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT NOW() now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
});

app.get('/api/stats', async (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  try {
    const { rows } = await pool.query(Q_STATS, [days]);
    res.json(rows[0]);
  } catch (e) { res.status(500).send('Failed to load stats'); }
});

app.get('/api/items', async (req, res) => {
  const search = req.query.search || null;
  try {
    const { rows } = await pool.query(Q_SELECT_ITEMS, [search]);
    res.json(rows);
  } catch { res.status(500).send('Error loading items'); }
});

app.post('/api/items', async (req, res) => {
  const { name, sku, category=null, unit=null, min_level=0 } = req.body || {};
  if (!name || !sku) return res.status(400).send('name and sku required');
  try {
    const { rows } = await pool.query(Q_INSERT_ITEM, [name, sku, category, unit, min_level]);
    res.json(rows[0]);
  } catch { res.status(500).send('Failed to add item'); }
});

app.post('/api/receive', async (req, res) => {
  const { sku, lot_no, expiry_date, quantity, location=null } = req.body || {};
  if (!sku || !lot_no || !expiry_date || !Number.isInteger(quantity) || quantity<=0)
    return res.status(400).send('sku, lot_no, expiry_date, positive quantity required');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let item = await c.query(Q_FIND_ITEM_BY_SKU, [sku]);
    if (item.rowCount === 0) {
      const ins = await c.query(Q_INSERT_ITEM, [sku, sku, null, null, 0]);
      item = { rows: [ins.rows[0]] };
    }
    const itemId = item.rows[0].item_id;
    const lot = await c.query(Q_UPSERT_LOT, [itemId, lot_no, expiry_date, quantity, location]);
    await c.query(Q_INSERT_TX, [itemId, lot.rows[0].lot_id, quantity, 'RECEIVE', 'Stock received']);
    await c.query('COMMIT');
    res.json({ ok:true });
  } catch (e) {
    await c.query('ROLLBACK');
    res.status(500).send('Receive failed');
  } finally { c.release(); }
});

app.post('/api/dispatch', async (req, res) => {
  const { sku, quantity, reason=null } = req.body || {};
  if (!sku || !Number.isInteger(quantity) || quantity<=0)
    return res.status(400).send('sku and positive quantity required');

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const item = await c.query('SELECT item_id FROM items WHERE sku=$1', [sku]);
    if (item.rowCount === 0) { await c.query('ROLLBACK'); return res.status(404).send('Item not found'); }
    const itemId = item.rows[0].item_id;

    let remaining = quantity;
    const lots = await c.query(Q_LOCK_LOTS_FEFO, [itemId]);
    for (const lot of lots.rows) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.quantity);
      const updated = await c.query(Q_DECR_LOT_QTY, [lot.lot_id, take]);
      if (updated.rowCount) {
        await c.query(Q_INSERT_TX, [itemId, lot.lot_id, -take, 'DISPATCH', reason || 'Dispatched']);
        remaining -= take;
      }
    }
    if (remaining > 0) { await c.query('ROLLBACK'); return res.status(400).send('Insufficient stock'); }
    await c.query('DELETE FROM lots WHERE quantity<=0');
    await c.query('COMMIT');
    res.json({ ok:true });
  } catch (e) {
    await c.query('ROLLBACK');
    res.status(500).send('Dispatch failed');
  } finally { c.release(); }
});

app.get('/api/transactions', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  try {
    const { rows } = await pool.query(Q_RECENT_TX, [limit]);
    res.json(rows);
  } catch { res.status(500).send('Error loading transactions'); }
});

app.get('/api/alerts', async (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  try {
    const { rows } = await pool.query(Q_ALERTS, [days]);
    res.json(rows);
  } catch { res.status(500).send('Failed to load alerts'); }
});

// API 404 guard
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// SPA-ish fallback (safe for Express 5)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
