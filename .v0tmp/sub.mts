import * as XLSX from 'xlsx'
import { readFile, writeFile } from 'node:fs/promises'
const wb=XLSX.read(await readFile('data/PAILLES-PD-c5fc6d.xlsx'),{cellDates:true})
const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets['MAIN_DEL'],{defval:null})
const lymd=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const key=(r:any)=>{const v=r['Delivery Date'];if(v instanceof Date)return lymd(v);const s=String(v??'').trim();const m=s.match(/^(\d{4})-(\d{2})/);return m?s.slice(0,10):''}
const tally=new Map<string,number>()
for(const r of rows){const k=key(r).slice(0,7);if(k)tally.set(k,(tally.get(k)??0)+1)}
console.log('months in PAILLES:',[...tally.entries()].sort())
// pick the busiest month, then keep only its first 3 delivery dates (real rows, untouched)
const month=[...tally.entries()].sort((a,b)=>b[1]-a[1])[0][0]
const inMonth=rows.filter(r=>key(r).startsWith(month))
const dates=[...new Set(inMonth.map(key))].sort().slice(0,3)
const subset=inMonth.filter(r=>dates.includes(key(r)))
console.log('chosen month:',month,'dates:',dates,'rows:',subset.length)
const st=new Map<string,number>(),rd=new Set<string>()
for(const r of subset){const s=String(r['Status']??'').trim();if(s)st.set(s,(st.get(s)??0)+1);const x=String(r['Rider']??'').trim();if(x)rd.add(x)}
console.log('subset statuses:',[...st.entries()].map(([k,n])=>`${k}=${n}`).join(' | '))
console.log('subset riders:',[...rd].join(' | '))
const out=XLSX.utils.book_new()
XLSX.utils.book_append_sheet(out,XLSX.utils.json_to_sheet(subset),'MAIN_DEL')
await writeFile('.v0tmp/SUBSET-REAL.xlsx',XLSX.write(out,{type:'buffer',bookType:'xlsx'}))
console.log('wrote .v0tmp/SUBSET-REAL.xlsx')
