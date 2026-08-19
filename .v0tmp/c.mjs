import pg from 'pg'
const url=new URL(process.env.POSTGRES_URL_NON_POOLING);url.searchParams.delete('sslmode')
const c=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false}});await c.connect()
const con=(await c.query(`select conname,pg_get_constraintdef(oid) d from pg_constraint where conrelid='import_mappings'::regclass`)).rows
console.log('CONSTRAINTS:'); for(const r of con) console.log('  '+r.conname+': '+r.d)
const idx=(await c.query(`select indexname,indexdef from pg_indexes where tablename='import_mappings'`)).rows
console.log('INDEXES:'); for(const r of idx) console.log('  '+r.indexdef)
const cols=(await c.query(`select column_name,is_nullable,column_default from information_schema.columns where table_name='import_mappings' order by ordinal_position`)).rows
console.log('COLUMNS:'); for(const r of cols) console.log(`  ${r.column_name} null=${r.is_nullable} def=${r.column_default??'-'}`)
await c.end()
