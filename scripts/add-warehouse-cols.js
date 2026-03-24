process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.POSTGRES_URL,
});

async function run() {
  await client.connect();
  await client.query(`
    ALTER TABLE public.company_settings 
    ADD COLUMN IF NOT EXISTS warehouse_name TEXT DEFAULT 'Warehouse',
    ADD COLUMN IF NOT EXISTS warehouse_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS warehouse_lng DOUBLE PRECISION;
  `);
  console.log("Warehouse columns added to company_settings");
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
