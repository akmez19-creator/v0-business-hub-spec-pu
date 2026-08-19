import { buildPlan, canonicalStatus, canonicalPaymentMethod } from './rec.mjs'
let pass=0, fail=0
const ok=(n,c,extra='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${extra&&!c?'  -> '+extra:''}`)}

console.log('--- canonicalStatus ---')
for(const [i,e] of [['Delivered','delivered'],['CMS','cms'],['NWD','nwd'],['Picked Up','picked_up'],['A_Delivered','delivered'],['Cancelled','cms'],['pending','pending'],['Assigned','assigned'],['',null],['???',null]])
  ok(`status ${JSON.stringify(i)} -> ${e}`, canonicalStatus(i)===e, String(canonicalStatus(i)))
ok('saved mapping wins', canonicalStatus('Livre',new Map([['livre','delivered']]))==='delivered')

console.log('\n--- canonicalPaymentMethod ---')
for(const [i,e] of [['PAID','paid'],['Cash','cash'],['Juice','juice'],['Juice to Rider','juice'],['Already Paid','paid'],['Bank','paid'],['',null]])
  ok(`pay ${JSON.stringify(i)} -> ${e}`, canonicalPaymentMethod(i)===e, String(canonicalPaymentMethod(i)))

const products=[{id:'p-air',name:'AirFryer'},{id:'p-tile',name:'Tile Filler'}]
const lookups={statusByRaw:new Map(),riderByName:new Map([['divesh','r-div'],['moon','r-moon']]),contractorByRider:new Map([['r-div','c-1']])}
const base=(o={})=>({rowNumber:2,delivery_date:'2026-08-17',entry_date:'2026-07-20',customer_name:'Dulloo Kaushalia',contact_1:'57656488',contact_2:null,products:'AirFryer',amount:475,qty:1,sales_type:null,notes:null,rte:null,region:null,medium:null,zone:null,payment_method:null,status:null,rider:null,...o})
const db=(o={})=>({id:'d-1',delivery_date:'2026-08-17',customer_name:'Dulloo Kaushalia',contact_1:'57656488',contact_2:null,products:'AirFryer',amount:475,qty:1,sales_type:null,notes:null,rte:null,locality:null,entry_date:'2026-07-20',payment_method:null,rider_id:null,contractor_id:null,status:'pending',product_id:null,...o})
const diffs=(f,d,pol={})=>{const p=buildPlan([base(f)],[db(d)],products,{month:'2026-08',lookups,policies:pol});const u=p.updates[0];return {d:u?u.diffs:[],blocked:p.blocked,plan:p}}
const get=(a,f)=>a.find(x=>x.field===f)?.to

console.log('\n--- status guards ---')
ok('pending -> delivered applies', get(diffs({status:'Delivered'},{status:'pending'}).d,'status')==='delivered')
let r=diffs({status:'Pending'},{status:'delivered'})
ok('delivered NOT rewound to pending', get(r.d,'status')===undefined && r.blocked.length===1, JSON.stringify(r.blocked))
ok('overwrite CAN rewind', get(diffs({status:'Pending'},{status:'delivered'},{status:'overwrite'}).d,'status')==='pending')
ok('pending_only skips assigned', get(diffs({status:'Delivered'},{status:'assigned'},{status:'pending_only'}).d,'status')===undefined)
ok('off writes nothing', get(diffs({status:'Delivered'},{status:'pending'},{status:'off'}).d,'status')===undefined)
ok('delivered -> cms blocked (same rank)', get(diffs({status:'CMS'},{status:'delivered'}).d,'status')===undefined)
ok('unmapped status ignored', get(diffs({status:'Zzz'},{status:'pending'}).d,'status')===undefined)

console.log('\n--- contractor guards ---')
ok('fills empty contractor', get(diffs({rider:'DIVESH'},{}).d,'contractor_id')==='c-1')
ok('fills empty rider', get(diffs({rider:'DIVESH'},{}).d,'rider_id')==='r-div')
r=diffs({rider:'DIVESH'},{contractor_id:'c-OTHER',rider_id:'r-OTHER'})
ok('existing assignment NOT stolen', get(r.d,'contractor_id')===undefined&&get(r.d,'rider_id')===undefined&&r.blocked.length===2, JSON.stringify(r.blocked))
ok('overwrite reassigns', get(diffs({rider:'DIVESH'},{contractor_id:'c-OTHER'},{contractor:'overwrite'}).d,'contractor_id')==='c-1')
ok('report writes nothing', diffs({rider:'DIVESH'},{},{contractor:'report'}).d.filter(x=>x.field.includes('id')).length===0)
ok('rider w/o contractor still links rider', get(diffs({rider:'MOON'},{}).d,'rider_id')==='r-moon')
ok('unknown rider -> no link', get(diffs({rider:'WEST'},{}).d,'rider_id')===undefined)

console.log('\n--- product guards ---')
ok('exact links', get(diffs({products:'AirFryer'},{products:'AirFryer'}).d,'product_id')==='p-air')
ok('variant NOT linked under exact', get(diffs({products:'AirFryer - B1G1'},{products:'AirFryer - B1G1'},{product:'exact'}).d,'product_id')===undefined)
ok('variant links under variant', get(diffs({products:'AirFryer - B1G1'},{products:'AirFryer - B1G1'},{product:'variant'}).d,'product_id')==='p-air')
ok('off links nothing', get(diffs({products:'AirFryer'},{},{product:'off'}).d,'product_id')===undefined)

console.log('\n--- payment ---')
ok('payment_method mapped', get(diffs({payment_method:'PAID'},{}).d,'payment_method')==='paid')

console.log('\n--- stats + unmapped reporting ---')
const p2=buildPlan([base({status:'Weird',rider:'GHOST'})],[db()],products,{month:'2026-08',lookups})
ok('statusUnmapped reported', p2.stats.statusUnmapped.includes('Weird'), JSON.stringify(p2.stats.statusUnmapped))
ok('ridersUnmapped reported', p2.stats.ridersUnmapped.includes('GHOST'), JSON.stringify(p2.stats.ridersUnmapped))
const p3=buildPlan([base({status:'Delivered',rider:'DIVESH'})],[db()],products,{month:'2026-08',lookups})
ok('counters', p3.stats.statusChanges===1&&p3.stats.contractorLinks===1&&p3.stats.productLinks===1, JSON.stringify(p3.stats))

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
