import { read, utils } from 'xlsx';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load env
const env = readFileSync('.env.development.local', 'utf8').split('\n').reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) a[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); return a;
}, {});
const db = createClient(env.DB_SUPABASE_URL, env.DB_SUPABASE_SERVICE_ROLE_KEY);

const normalizePhone = raw => {
  if (raw == null) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('230')) d = d.slice(3);
  return (d.length < 7 || d.length > 8) ? '' : d;
};
const toDateStr = v => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return (y < 2000 || y > 2100) ? null : d.toISOString().slice(0, 10);
};

const wb = read(readFileSync('data/PAILLES-PD-c5fc6d.xlsx'), { cellDates: true });
const sheetName = wb.SheetNames.includes('MAIN_DEL') ? 'MAIN_DEL' : wb.SheetNames[0];
const rows = utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
console.log('[v0] sheet:', sheetName, 'rows:', rows.length);
console.log('[v0] headers:', JSON.stringify(Object.keys(rows[0] || {})));

const normalized = rows.map(r => { const o = {}; for (const [k, v] of Object.entries(r)) o[k.trim()] = v; return o; });

const orderRows = [];
let skippedNoPhone = 0;
for (const r of normalized) {
  const phone = normalizePhone(r['Contact #1']);
  if (!phone) { skippedNoPhone++; continue; }
  const date = toDateStr(r['Delivery Date']) || toDateStr(r['Entry Date']);
  const rawStatus = String(r['Status'] ?? '').trim().toLowerCase();
  const status = rawStatus === 'delivered' ? 'delivered' : rawStatus === 'cms' ? 'cms' : 'other';
  const amt = parseFloat(String(r['Amt'] ?? '0').replace(/[^0-9.-]/g, '')) || 0;
  const qty = parseInt(String(r['Qty'] ?? '0'), 10) || 0;
  const rawIndex = r['INDEX'] ? String(r['INDEX']).trim() : '';
  const key = rawIndex || `${phone}|${date || 'nodate'}|${amt}|${qty}`;
  orderRows.push({ key, phone, name: r['Customer Name'] ? String(r['Customer Name']).trim() : null, region: r['Region'] ? String(r['Region']).trim() : null, status, amt, qty, date });
}
console.log('[v0] valid:', orderRows.length, 'skippedNoPhone:', skippedNoPhone);

const seen = new Set();
const uniqueRows = orderRows.filter(r => seen.has(r.key) ? false : (seen.add(r.key), true));
console.log('[v0] unique in-file:', uniqueRows.length);

const newKeys = new Set();
for (let i = 0; i < uniqueRows.length; i += 5000) {
  const chunk = uniqueRows.slice(i, i + 5000);
  const { data, error } = await db.from('imported_order_keys')
    .upsert(chunk.map(r => ({ index_key: r.key })), { onConflict: 'index_key', ignoreDuplicates: true })
    .select('index_key');
  if (error) { console.log('[v0] dedupe error:', error.message); process.exit(1); }
  for (const d of data || []) newKeys.add(d.index_key);
}
const freshRows = uniqueRows.filter(r => newKeys.has(r.key));
console.log('[v0] fresh (not previously imported):', freshRows.length);

const byPhone = new Map();
for (const r of freshRows) {
  let c = byPhone.get(r.phone);
  if (!c) { c = { phone: r.phone, name: null, region: null, orders: 0, delivered: 0, cms: 0, sales: 0, qty: 0, first_date: null, last_date: null }; byPhone.set(r.phone, c); }
  c.orders++;
  if (r.status === 'delivered') { c.delivered++; c.sales += r.amt; c.qty += r.qty; }
  else if (r.status === 'cms') c.cms++;
  if (r.name) c.name = r.name;
  if (r.region) c.region = r.region;
  if (r.date) { if (!c.first_date || r.date < c.first_date) c.first_date = r.date; if (!c.last_date || r.date > c.last_date) c.last_date = r.date; }
}
const deltas = Array.from(byPhone.values());
console.log('[v0] distinct clients:', deltas.length);

const { data, error } = await db.rpc('apply_client_import', { rows: deltas });
if (error) { console.log('[v0] rpc error:', error.message); process.exit(1); }
console.log('[v0] rpc result:', JSON.stringify(data));

// Verify results
const { data: top } = await db.from('clients').select('name, phone, client_status, total_orders, delivered_orders, cms_orders, total_sales').order('total_sales', { ascending: false }).limit(5);
console.log('[v0] top clients:', JSON.stringify(top, null, 1));
const { count } = await db.from('clients').select('*', { count: 'exact', head: true });
console.log('[v0] total clients now:', count);
