import { buildPlan } from './rec.ts'
const norm=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim()
const products=[{id:'p-air',name:'AirFryer'},{id:'p-mop',name:'Spin Mop'}]
const rows:any[]=[
 {rowNumber:2,delivery_date:'2026-08-03',customer_name:'A One',contact_1:'5001',products:'AirFryer - B1G1',amount:900,status:'NO STOCK',rider_raw:'AZHAR'},
 {rowNumber:3,delivery_date:'2026-08-03',customer_name:'B Two',contact_1:'5002',products:'Totally Unknown Thing',amount:500},
]
const db:any[]=[
 {id:'d1',delivery_date:'2026-08-03',customer_name:'A One',contact_1:'5001',products:'AirFryer - B1G1',amount:900,status:'pending',product_id:null,rider_id:null,contractor_id:null},
 {id:'d2',delivery_date:'2026-08-03',customer_name:'B Two',contact_1:'5002',products:'Totally Unknown Thing',amount:500,status:'pending',product_id:null,rider_id:null,contractor_id:null},
]
const base={statusByRaw:new Map(),riderByName:new Map(),contractorByRider:new Map()}
const show=(label:string,lk:any,pol:any={})=>{
  const p=buildPlan(rows,db,products,{month:'2026-08',lookups:lk,policies:pol})
  const links=p.updates.flatMap((u:any)=>u.diffs.filter((d:any)=>d.field==='product_id').map((d:any)=>`${u.dbId}->${d.to}`))
  console.log(`${label}\n   productLinks=${p.stats.productLinks} unmatched=${JSON.stringify(p.unmatchedProducts?.map?.((x:any)=>x.name??x)??[])}\n   wrote: ${JSON.stringify(links)}`)
}
show('[1] exact policy, NO mapping (B1G1 must stay unlinked)',base,{product:'exact'})
show('[2] exact policy, WITH mapping AirFryer - B1G1 -> AirFryer',{...base,productByName:new Map([[norm('AirFryer - B1G1'),'p-air']])},{product:'exact'})
show('[3] product OFF overrides even a mapping',{...base,productByName:new Map([[norm('AirFryer - B1G1'),'p-air']])},{product:'off'})
// status + rider mapping
const p4=buildPlan(rows,db,products,{month:'2026-08',lookups:{...base,statusByRaw:new Map([['no stock','nwd']])},policies:{}})
console.log('[4] status mapping NO STOCK->nwd: statusChanges='+p4.stats.statusChanges+' unmapped='+JSON.stringify(p4.stats.statusUnmapped))
const p5=buildPlan(rows.map(r=>({...r,rider:r.rider_raw})),db,products,{month:'2026-08',lookups:{...base,riderByName:new Map([['azhar','r-az']]),contractorByRider:new Map([['r-az','c-az']])},policies:{}})
console.log('[5] rider mapping AZHAR->rider: contractorLinks='+p5.stats.contractorLinks)
