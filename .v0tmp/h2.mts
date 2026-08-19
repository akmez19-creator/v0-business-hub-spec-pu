import * as XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'
for(const f of ['data/PAILLES-PD-c5fc6d.xlsx']){
  const wb=XLSX.read(await readFile(f),{cellDates:true})
  for(const s of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[s],{defval:null})
    console.log(`${f} [${s}] ${rows.length} rows`)
    if(rows.length) console.log('  headers:',JSON.stringify(Object.keys(rows[0])))
    const sc=rows.length?Object.keys(rows[0]).find(k=>/status/i.test(k)):null
    if(sc){const v=new Map<string,number>();for(const r of rows){const x=r[sc];if(x!=null&&String(x).trim())v.set(String(x).trim(),(v.get(String(x).trim())??0)+1)}
      console.log('  STATUS values:',[...v.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,n])=>`${k}=${n}`).join(' | '))}
    const rc=rows.length?Object.keys(rows[0]).find(k=>/^rider$/i.test(k.trim())):null
    if(rc){const v=new Set(rows.map(r=>r[rc]).filter(x=>x!=null&&String(x).trim()).map(x=>String(x).trim()));console.log('  RIDER values('+v.size+'):',[...v].slice(0,16).join(' | '))}
  }
}
