import pg from 'pg'
const url=new URL(process.env.POSTGRES_URL_NON_POOLING);url.searchParams.delete('sslmode')
const c=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false}});await c.connect()
const r=(await c.query(`select mapping_type,source_value,target_value,target_id from import_mappings where mapping_type in ('status','sales_type','rider') order by mapping_type,source_value`)).rows
for(const x of r) console.log(` ${x.mapping_type.padEnd(11)} ${String(x.source_value).padEnd(22)} -> ${x.target_value??x.target_id}`)
await c.end()
