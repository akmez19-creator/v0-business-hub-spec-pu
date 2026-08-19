import pg from 'pg'
const url=new URL(process.env.POSTGRES_URL_NON_POOLING);url.searchParams.delete('sslmode')
const c=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false}});await c.connect()
const norm=s=>s.toLowerCase().replace(/\s+/g,' ').trim()
const prod=(await c.query(`select id,name from products limit 1`)).rows[0]
const SRC='ZZ V0 TEST WIDGET'
// mimic the API's exact row shape
await c.query(`insert into import_mappings (mapping_type,source_value,target_id,target_value,updated_at)
 values ('product',$1,$2,null,now()) on conflict (mapping_type,source_value) do update set target_id=excluded.target_id`,[SRC,prod.id])
await c.query(`insert into import_mappings (mapping_type,source_value,target_id,target_value,updated_at)
 values ('status','ZZ NO STOCK',null,'nwd',now()) on conflict (mapping_type,source_value) do update set target_value=excluded.target_value`)
// upsert twice to prove remap replaces rather than errors
await c.query(`insert into import_mappings (mapping_type,source_value,target_id,target_value,updated_at)
 values ('product',$1,$2,null,now()) on conflict (mapping_type,source_value) do update set target_id=excluded.target_id`,[SRC,prod.id])
console.log('upsert twice: OK (no unique violation)')
// now mimic loadLookups
const all=(await c.query(`select mapping_type,source_value,target_id,target_value from import_mappings`)).rows
const productByName=new Map(), statusByRaw=new Map()
for(const m of all){
  const src=String(m.source_value??'').trim()
  if(m.mapping_type==='product'&&m.target_id) productByName.set(norm(src),m.target_id)
  if(m.mapping_type==='status'&&m.target_value) statusByRaw.set(src.toLowerCase(),m.target_value)
}
console.log('productByName size:',productByName.size,'| contains test:',productByName.get(norm(SRC))===prod.id?'YES -> '+prod.name:'NO')
console.log('statusByRaw size:',statusByRaw.size,'| test status:',statusByRaw.get('zz no stock'))
// cleanup
const d=await c.query(`delete from import_mappings where source_value in ($1,'ZZ NO STOCK')`,[SRC])
console.log('cleaned up rows:',d.rowCount)
const left=(await c.query(`select count(*) n from import_mappings where source_value like 'ZZ %'`)).rows[0].n
console.log('leftover ZZ rows:',left)
const byType=(await c.query(`select mapping_type,count(*) n from import_mappings group by 1 order by n desc`)).rows
console.log('table intact:',byType.map(r=>`${r.mapping_type}=${r.n}`).join(' | '))
await c.end()
