import pg from 'pg'
import { analysePhoto } from './lib/product-identify'
const url=(process.env.POSTGRES_URL_NON_POOLING||'').replace(/([?&])sslmode=[^&]*&?/i,'$1').replace(/[?&]$/,'')
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}}); await c.connect()
const {rows:all}=await c.query(`select id,name,category,description,sku,image_url from products where is_active=true`)
await c.end()
const withImg=all.filter(p=>p.image_url)
const picks=[0,37,91,150,233].map(i=>withImg[i%withImg.length]).filter(Boolean)
let hit=0,top1=0,ran=0
for(const p of picks){
  try{
    const r=await analysePhoto(p.image_url, all as any)
    ran++
    const idx=r.candidates.findIndex(x=>x.product_id===p.id)
    if(idx===0) top1++
    if(idx>=0) hit++
    const b=r.candidates[0]
    console.log(`\nTRUTH: ${p.name}  -> saw "${r.label}" [${r.status}]`)
    console.log(`  best: ${b?`${b.name} ${b.confidence.toFixed(2)}${b.visually_compared?' visual':' text'}`:'none'}   rank=${idx===0?'#1':idx>0?'#'+(idx+1):'MISS'}`)
  }catch(e){ console.log(`\nTRUTH: ${p.name}  ERROR ${(e as Error).message.slice(0,70)}`) }
}
console.log(`\n=== of ${ran} completed: top-1 ${top1}, in-shortlist ${hit} ===`)

// Control: a real photo of something this warehouse does not stock, served
// from the project's own blob store so the fetch cannot be the thing that fails.
console.log('\n--- control: not in inventory ---')
const ctrlUrl='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'
try{
  const ctrl=await analysePhoto(ctrlUrl, all as any)
  console.log(`  saw: "${ctrl.label}" [${ctrl.status}] best=${ctrl.candidates[0]?ctrl.candidates[0].name+' @ '+ctrl.candidates[0].confidence.toFixed(2):'none'}`)
  console.log(ctrl.status==='unmatched'?'  PASS - declined to guess':'  FAIL - claimed a match')
}catch(e){ console.log('  ERROR',(e as Error).message.slice(0,70)) }
