/** Temporary scoped structural diagnostics. No payload text, keys or identifiers enter logs. */
export const WHATSAPP_TRACE_EXPIRES_AT = '2026-09-12T20:21:47Z'
const EXPIRES = Date.parse(WHATSAPP_TRACE_EXPIRES_AT)
const TARGETS = [
  { label: 'mbm', phone: '1090043534186338', waba: '1438616924486229' },
  { label: 'destockage', phone: '968962882975955', waba: '1241189547377134' },
] as const
type TargetLabel = typeof TARGETS[number]['label']
const MAX_ENTRIES = 12, MAX_CHANGES = 24, MAX_MESSAGES = 40, MAX_STATUSES = 40
const MAX_ERRORS = 80, MAX_HISTORY_CHUNKS = 8, MAX_HISTORY_THREADS = 32, MAX_PARTITIONS = 24
const FIELDS = ['messages', 'message_echoes', 'smb_message_echoes', 'history', 'smb_app_state_sync', 'standby', 'other', 'missing'] as const
const CONTAINERS = ['messages', 'message_echoes', 'smb_message_echoes', 'statuses', 'history', 'standby'] as const
const TYPES = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'interactive', 'button', 'contacts', 'location', 'reaction', 'system', 'order', 'unsupported', 'other', 'missing'] as const
type Field = typeof FIELDS[number]
type Direction = 'in' | 'out' | 'unknown'
type Location = 'direct' | 'nested' | 'history' | 'standby'
type ErrorScope = 'value' | 'message' | 'status'
type Ownership = 'phone' | 'waba_without_phone'
type Partition = {field:Field;direction:Direction;location:Location;ownership:Ownership;inspected:number;text_body_nonempty:number;other_supported_body_nonempty:number;nested_body_nonempty:number;media_id_present:number;with_errors:number}
type ErrorPartition = {field:Field;direction:Direction;ownership:Ownership;source:ErrorScope;code_131060:number;code_131051:number;other_numeric:number;malformed:number}
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const nonempty = (v: unknown) => typeof v === 'string' && v.length > 0
const count = (n: number) => Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), 10000) : 0
const counts = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, 0])) as Record<string, number>
const label = <T extends readonly string[]>(value: unknown, names: T): T[number] =>
  (typeof value === 'string' && names.includes(value) ? value : value == null ? 'missing' : 'other') as T[number]
const echoField = (field: Field) => field === 'message_echoes' || field === 'smb_message_echoes'
type TimeRange = {valid:number;invalid:number;missing:number;oldest:string|null;newest:string|null}
const timeRange = ():TimeRange => ({valid:0,invalid:0,missing:0,oldest:null,newest:null})
// Accept only bounded Unix seconds, never a payload string copied as a timestamp.
const observeTimestamp = (value:unknown, range:TimeRange) => {
  if(value===undefined || value===null || value===''){range.missing++;return}
  const seconds=typeof value==='number'?value:
    typeof value==='string' && /^\d{10}$/.test(value)?Number(value):NaN
  if(!Number.isSafeInteger(seconds) || seconds<946684800 || seconds>4102444799){range.invalid++;return}
  const iso=new Date(seconds*1000).toISOString()
  range.valid++
  if(range.oldest===null || iso<range.oldest)range.oldest=iso
  if(range.newest===null || iso>range.newest)range.newest=iso
}
const observerTime = (now:number) => Number.isFinite(now) && now>=946684800000 && now<4102444800000
  ? new Date(now).toISOString() : null

export function summarizeWhatsAppWebhook(payload: unknown, targetLabel:TargetLabel='mbm') {
  const target=TARGETS.find(item=>item.label===targetLabel)
  if(!target)throw new Error('Unknown diagnostic target')
  const p = object(payload)
  const entries = Array.isArray(p.entry) ? p.entry : []
  const fields = counts(FIELDS), types = counts(TYPES)
  const containers = Object.fromEntries(CONTAINERS.map(name => [name,{arrays:0,items:0,objects:0,other:0}])) as
    Record<typeof CONTAINERS[number],{arrays:number;items:number;objects:number;other:number}>
  const nested = counts(['data_messages','data_echoes','value_messages','value_echoes','payload_messages','payload_echoes','standby_messages','standby_echoes','standby_arrays','standby_objects','entry_standby'])
  const errors = Object.fromEntries(['value','message','status'].map(name => [name,
    {arrays:0,items_seen:0,inspected:0,code_131060:0,code_131051:0,other_numeric:0,malformed:0}])) as
    Record<ErrorScope,{arrays:number;items_seen:number;inspected:number;code_131060:number;code_131051:number;other_numeric:number;malformed:number}>
  const shape = {inspected:0,with_id:0,with_from:0,with_to:0,with_timestamp:0,text_body_nonempty:0,
    other_supported_body_nonempty:0,nested_body_nonempty:0,media_id_present:0}
  const scope = {phone_matched:0,waba_missing_phone:0}
  const history = {chunks_scanned:0,threads_scanned:0,missing_thread_id:0,from_me_true:0,from_me_false:0,from_me_missing:0}
  const statuses = {inspected:0,sent:0,delivered:0,read:0,failed:0,other:0,missing:0,with_errors:0}
  const providerTimes={messages:{in:timeRange(),out:timeRange(),unknown:timeRange()},statuses:timeRange(),history:timeRange()}
  const partitions: Partition[] = []
  const errorPartitions: ErrorPartition[] = []
  let scannedChanges = 0, scopedChanges = 0, errorItems = 0
  let ownership:Ownership='phone'
  let truncated = entries.length > MAX_ENTRIES

  const inspectErrors = (value: unknown, where: ErrorScope, field:Field, direction:Direction) => {
    if (value === undefined) return
    const bucket = errors[where]
    let context = errorPartitions.find(item=>item.field===field && item.direction===direction && item.ownership===ownership && item.source===where)
    if(!context) {
      if(errorPartitions.length>=MAX_PARTITIONS)truncated=true
      else {context={field,direction,ownership,source:where,code_131060:0,code_131051:0,other_numeric:0,malformed:0};errorPartitions.push(context)}
    }
    const bump=(key:'code_131060'|'code_131051'|'other_numeric'|'malformed')=>{bucket[key]++;if(context)context[key]++}
    if (!Array.isArray(value)) { bump('malformed'); return }
    bucket.arrays++; bucket.items_seen = count(bucket.items_seen + value.length)
    const available = Math.max(0, MAX_ERRORS - errorItems)
    if (value.length > available) truncated = true
    for (const item of value.slice(0,available)) {
      errorItems++; bucket.inspected++
      const code = object(item).code
      if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0) bump('malformed')
      else if (code === 131060) bump('code_131060')
      else if (code === 131051) bump('code_131051')
      else bump('other_numeric')
    }
  }
  const partition = (field:Field,direction:Direction,location:Location) => {
    const existing = partitions.find(item => item.field === field && item.direction === direction && item.location === location && item.ownership === ownership)
    if (existing) return existing
    if (partitions.length >= MAX_PARTITIONS) { truncated=true; return null }
    const item:Partition = {field,direction,location,ownership,inspected:0,text_body_nonempty:0,other_supported_body_nonempty:0,nested_body_nonempty:0,media_id_present:0,with_errors:0}
    partitions.push(item); return item
  }
  const inspectMessage = (value:unknown,field:Field,direction:Direction,location:Location) => {
    if (shape.inspected >= MAX_MESSAGES) { truncated=true; return }
    const message=object(value), bucket=partition(field,direction,location)
    shape.inspected++; if(bucket) bucket.inspected++
    if(nonempty(message.id)) shape.with_id++
    if(nonempty(message.from)) shape.with_from++
    if(nonempty(message.to)) shape.with_to++
    if(typeof message.timestamp === 'number' || nonempty(message.timestamp)) shape.with_timestamp++
    observeTimestamp(message.timestamp,location==='history'?providerTimes.history:providerTimes.messages[direction])
    const text=nonempty(object(message.text).body)
    const supported=[object(message.image).caption,object(message.video).caption,object(message.document).filename,
      object(message.button).text,object(object(message.interactive).button_reply).title,object(object(message.interactive).list_reply).title].some(nonempty)
    const alternative=[object(object(message.message).text).body,object(message.message).body,message.body,message.text].some(nonempty)
    const media=['image','video','audio','document','sticker'].some(key=>nonempty(object(message[key]).id))
    if(text){shape.text_body_nonempty++;if(bucket)bucket.text_body_nonempty++}
    if(supported){shape.other_supported_body_nonempty++;if(bucket)bucket.other_supported_body_nonempty++}
    if(alternative){shape.nested_body_nonempty++;if(bucket)bucket.nested_body_nonempty++}
    if(media){shape.media_id_present++;if(bucket)bucket.media_id_present++}
    types[label(message.type,TYPES)]++
    if(message.errors !== undefined && bucket) bucket.with_errors++
    inspectErrors(message.errors,'message',field,direction)
  }
  const inspectArray = (value:unknown,field:Field,direction:Direction,location:Location) => {
    if(!Array.isArray(value)) return
    const available=Math.max(0,MAX_MESSAGES-shape.inspected)
    if(value.length>available) truncated=true
    for(const item of value.slice(0,available)) inspectMessage(item,field,direction,location)
  }
  const inspectNested = (value:unknown,field:Field,prefix:'data'|'value'|'payload'|'standby') => {
    const wrapper=object(value)
    if(Array.isArray(wrapper.messages)) {
      nested[`${prefix}_messages`]++
      inspectArray(wrapper.messages,field,echoField(field)?'out':'unknown',prefix==='standby'?'standby':'nested')
    }
    for(const name of ['message_echoes','smb_message_echoes'] as const) if(Array.isArray(wrapper[name])) {
      nested[`${prefix}_echoes`]++
      inspectArray(wrapper[name],field,'out',prefix==='standby'?'standby':'nested')
    }
  }
  const inspectStandby = (value:unknown,field:Field) => {
    if(Array.isArray(value)) {
      nested.standby_arrays++
      if(value.length>MAX_MESSAGES)truncated=true
      for(const item of value.slice(0,MAX_MESSAGES)) {
        const record=object(item)
        // Structural observation only: no claimed WhatsApp standby contract.
        if(record.id!==undefined || record.text!==undefined || record.message!==undefined) inspectMessage(item,field,'unknown','standby')
        inspectNested(item,field,'standby')
      }
    } else if(value !== null && typeof value==='object') {
      nested.standby_objects++
      inspectNested(value,field,'standby')
    }
  }

  if(p.object === 'whatsapp_business_account') for(const entryValue of entries.slice(0,MAX_ENTRIES)) {
    const entry=object(entryValue), changes=Array.isArray(entry.changes)?entry.changes:[]
    // An explicit mismatched WABA never borrows another approved phone's identity.
    if(entry.id!==target.waba)continue
    const remaining=Math.max(0,MAX_CHANGES-scannedChanges)
    if(changes.length>remaining)truncated=true
    for(const changeValue of changes.slice(0,remaining)) {
      scannedChanges++
      const change=object(changeValue), value=object(change.value), metadata=object(value.metadata)
      const phone=metadata.phone_number_id
      if(phone===target.phone) {scope.phone_matched++;ownership='phone'}
      else if(phone===undefined || phone===null || phone==='') {scope.waba_missing_phone++;ownership='waba_without_phone'}
      else continue
      scopedChanges++
      const field=label(change.field,FIELDS) as Field
      fields[field]++
      inspectErrors(value.errors,'value',field,'unknown')
      for(const name of CONTAINERS) {
        const items=value[name], bucket=containers[name]
        if(Array.isArray(items)){bucket.arrays++;bucket.items=count(bucket.items+items.length)}
        else if(items!=null){if(typeof items==='object')bucket.objects++;else bucket.other++}
      }
      inspectArray(value.messages,field,echoField(field)?'out':field==='messages'?'in':'unknown','direct')
      inspectArray(value.message_echoes,field,'out','direct')
      inspectArray(value.smb_message_echoes,field,'out','direct')
      if(Array.isArray(value.statuses)) {
        const available=Math.max(0,MAX_STATUSES-statuses.inspected)
        if(value.statuses.length>available)truncated=true
        for(const item of value.statuses.slice(0,available)) {
          const status=object(item);statuses.inspected++
          observeTimestamp(status.timestamp,providerTimes.statuses)
          statuses[label(status.status,['sent','delivered','read','failed','other','missing'] as const)]++
          if(status.errors!==undefined)statuses.with_errors++
          inspectErrors(status.errors,'status',field,'out')
        }
      }
      for(const prefix of ['data','value','payload'] as const) inspectNested(value[prefix],field,prefix)
      inspectStandby(value.standby,field)
      if(Array.isArray(value.history)) {
        const available=Math.max(0,MAX_HISTORY_CHUNKS-history.chunks_scanned)
        if(value.history.length>available)truncated=true
        for(const chunk of value.history.slice(0,available)) {
          history.chunks_scanned++
          const threads=object(chunk).threads
          if(!Array.isArray(threads))continue
          const threadBudget=Math.max(0,MAX_HISTORY_THREADS-history.threads_scanned)
          if(threads.length>threadBudget)truncated=true
          for(const threadValue of threads.slice(0,threadBudget)) {
            const thread=object(threadValue);history.threads_scanned++
            if(!nonempty(thread.id))history.missing_thread_id++
            if(!Array.isArray(thread.messages))continue
            const messageBudget=Math.max(0,MAX_MESSAGES-shape.inspected)
            if(thread.messages.length>messageBudget)truncated=true
            for(const message of thread.messages.slice(0,messageBudget)) {
              const fromMe=object(object(message).history_context).from_me
              if(fromMe===true)history.from_me_true++
              else if(fromMe===false)history.from_me_false++
              else history.from_me_missing++
              inspectMessage(message,field,fromMe===true?'out':fromMe===false?'in':'unknown','history')
            }
          }
        }
      }
    }
    if(entry.standby!==undefined) {
      ownership='waba_without_phone'
      nested.entry_standby++;scope.waba_missing_phone++;scopedChanges++;fields.standby++
      inspectStandby(entry.standby,'standby')
    }
  }
  return {event:'whatsapp_reply_trace',schema:3,target:target.label,expires_at:WHATSAPP_TRACE_EXPIRES_AT,
    scope,scoped_units:scopedChanges,changes_scanned:scannedChanges,fields,containers,shape,
    message_types:types,errors,error_partitions:errorPartitions,statuses,partitions,nested_hints:nested,history,
    provider_timestamp_ranges:providerTimes,truncated}
}

/** Same route API; this observer cannot change storage, acknowledgements or retries. */
export function createWhatsAppWebhookTrace(payload:unknown,options:{now?:()=>number;log?:(line:string)=>void}={}) {
  const now=options.now??Date.now
  let completed=false
  const summaries:ReturnType<typeof summarizeWhatsAppWebhook>[]=[]
  let observedAt:string|null=null
  try {
    const startedAt=now()
    if(startedAt<EXPIRES) {
      observedAt=observerTime(startedAt)
      for(const target of TARGETS) {
        try { summaries.push(summarizeWhatsAppWebhook(payload,target.label)) }catch{/* Keep the other approved target observable. */}
      }
    }
  }catch{/* Optional observer. */}
  return {finish(result:{outcome:'accepted'|'retryable'|'exception'|'ignored-object';saved:number;failed:number}) {
    if(completed)return
    completed=true
    try {
      const finishedAt=now()
      if(summaries.length===0 || !Number.isFinite(finishedAt) || finishedAt>=EXPIRES)return
      const outcome=['accepted','retryable','exception','ignored-object'].includes(result.outcome)?result.outcome:'exception'
      // Existing route provides whole-request counters, not scoped or enriched counts.
      for(const summary of summaries) {
        if(summary.scoped_units===0)continue
        try {
          const logAt=now()
          if(!Number.isFinite(logAt) || logAt>=EXPIRES)return
          ;(options.log??console.log)(JSON.stringify({...summary,observed_at:observedAt,outcome,
            request_inserted:count(result.saved),request_failed:count(result.failed)}))
        }catch{/* A failed log must not suppress another target or the genuine request. */}
      }
    }catch{/* Diagnostics must never fail a genuine delivery. */}
  }}
}
