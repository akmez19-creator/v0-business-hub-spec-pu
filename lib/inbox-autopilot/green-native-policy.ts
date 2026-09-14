import { createHash } from 'node:crypto'
import { priceFor, setSize, type QuickOrderProduct } from '@/lib/orders/quick-order'
import type { NativeContext } from './green-native-context'
type ContextMessage=NativeContext['messages'][number]
type TrustedContext=NativeContext

export type ReplyLanguage = 'en' | 'fr' | 'mfe'
export type ReplyIntent = 'greeting' | 'price' | 'buy' | 'delivery' | 'acknowledgement' | 'technical' | 'complaint' | 'change_order' | 'postal' | 'collection' | 'other'
export type Evidence = { value: string; messageId: string }
export type ReplyDecision = {
  language: ReplyLanguage; intent: ReplyIntent; needsStaff: boolean
  productId: string | null; productEvidence: Evidence | null
  quantity: number | null; quantityEvidence: Evidence | null
  name: Evidence | null; phone: Evidence | null; location: Evidence | null
}
export type CatalogueProduct = QuickOrderProduct & { sold_out: boolean | null; has_variants: boolean | null }
export type ReplyPlan = { action: 'send'; text: string; reason: string; evidence: Record<string, string>; catalogueFingerprint: string } |
  { action: 'review' | 'skip'; reason: string; catalogueFingerprint: string }
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export function catalogueFingerprint(rows: CatalogueProduct[]): string {
  return createHash('sha256').update(JSON.stringify(rows.map(p => [p.id,p.name,p.price,p.bundle_prices,p.is_b1g1,p.sold_out,p.has_variants]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex')
}
function evidenceExists(e: Evidence | null, messages: ContextMessage[], customerOnly = true): boolean {
  return !!e && e.value.trim().length > 0 && e.value.length <= 300 && messages.some(m => m.id === e.messageId && (!customerOnly || m.direction === 'in') && m.text.includes(e.value))
}
function hasProductName(text: string, product: CatalogueProduct): boolean {
  const name=normal(product.name)
  return name.length>=4 && (` ${normal(text)} `).includes(` ${name} `)
}
/** Evidence must actually encode this quantity, not merely be a substring of a phone or price. */
function quantityConfirmed(quantity:number|null,e:Evidence|null,messages:ContextMessage[]):boolean {
  if(!quantity || !Number.isInteger(quantity) || quantity<1 || quantity>50 || !evidenceExists(e,messages))return false
  const value=normal(e!.value),words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,enn:1,de:2,trwa:3,kat:4,sink:5}
  const match=value.match(/^(?:(?:qty|quantity|quantite|kantite) )?(\d{1,2}|one|two|three|four|five|un|une|deux|trois|quatre|cinq|enn|de|trwa|kat|sink)(?: (?:units?|pieces?|pcs|inite))?$/)
  if(!match || (Number(match[1])||words[match[1]])!==quantity)return false
  const source=messages.find(m=>m.id===e!.messageId && m.direction==='in')?.text??''
  const escaped=e!.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  // An evidence value of '1' inside a telephone, price, model or B1G1 offer is not a quantity.
  if(!new RegExp(`(?:^|[^\\p{L}\\p{N}.,])${escaped}(?=$|[^\\p{L}\\p{N}.,])`,'u').test(source))return false
  if(/(?:\brs\b|\bmur\b|buy.?one.?get|b1g1|gratuit|gratis|free)/i.test(source) && normal(source)!==value)return false
  const explicitUnit=/\b(?:qty|quantity|quantite|kantite|units?|pieces?|pcs|inite)\b/.test(value)
  const number=match[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const quantityCue=new RegExp(`(?:^| )(?:qty|quantity|quantite|kantite|want|need|order|commande|prends|prend|anvi|bizin|mo pran) ${number}(?: |$)`)
  if(normal(source)!==value && !explicitUnit && !quantityCue.test(normal(source)))return false
  return true
}
const staffContext = /\b(?:refund|rembours|cancel|annul|complaint|reclamation|order status|where is my order|where is my delivery|already paid|deja paye|change my order|change my address|return item|medical|warranty|garantie|rodrigues|postal|pickup|pick up|collection)\b/i
const issueContext = /\b(?:refund|rembours(?:ement|er|e)?|complaint|reclamation|broken|damaged|defective|faulty|not working|casse|abime|pa(?: pe)? marse)\b/i
const changeContext = /\b(?:exchange|replacement|replace|echange|remplacement|change my order|change my address|return item|cancel|annul(?:er|ation)?)\b/i
/** Known issue wording can hand off without waiting for the model or catalogue. */
export function knownStaffIssue(context:TrustedContext):'customer_issue'|'exchange_or_change_request'|null {
  if(!context.eligible||!context.latestInbound)return null
  const latest=context.messages.find(m=>m.id===context.latestInbound!.id&&m.direction==='in')
  if(!latest)return null
  return issueContext.test(normal(latest.text))?'customer_issue':changeContext.test(normal(latest.text))?'exchange_or_change_request':null
}
const confirmedOrder = /\b(?:order (?:is )?(?:confirmed|placed|delivered)|commande (?:est )?confirmee|komann (?:finn )?konfirme|delivery completed|livraison effectuee)\b/i
const copy = {
  en: { product:'Which product would you like to order? Please send its name.', free:'Delivery is free.', date:'Our scheduled delivery date is', time:'The rider will call; the exact time depends on the route.', details:'To prepare your order, please share', name:'your full name', phone:'your contact number', location:'the delivery address and locality', quantity:'the quantity you want', sold:'This product is currently marked sold out. Would you like help finding an alternative?', ready:'Thank you. We have your details for the team to check and confirm the order. Your order is not yet confirmed.', variant:'Please tell us the model or colour you need so the team can check the correct option.', listed:'The listed price for', is:'is', bonus:'The buy-one-get-one offer includes the bonus item.', ask:'Would you like to proceed?', set:'units' },
  fr: { product:'Quel produit souhaitez-vous commander ? Merci de nous envoyer son nom.', free:'La livraison est gratuite.', date:'Notre date de livraison prévue est le', time:'Le livreur vous appellera ; l’heure exacte dépend de son itinéraire.', details:'Pour préparer votre commande, merci de nous envoyer', name:'votre nom complet', phone:'votre numéro de téléphone', location:'votre adresse de livraison et votre localité', quantity:'la quantité souhaitée', sold:'Ce produit est actuellement indiqué en rupture de stock. Souhaitez-vous de l’aide pour trouver une alternative ?', ready:'Merci. Nous avons vos informations pour que notre équipe vérifie et confirme la commande. Votre commande n’est pas encore confirmée.', variant:'Merci de préciser le modèle ou la couleur souhaitée pour que notre équipe vérifie la bonne option.', listed:'Le prix indiqué pour', is:'est de', bonus:'L’offre un acheté, un offert inclut l’article offert.', ask:'Souhaitez-vous commander ?', set:'unités' },
  mfe: { product:'Ki prodwi ou anvi komande? Kapav avoy nou so nom, silvouple?', free:'Livrezon gratis.', date:'Nou dat livrezon prevwar se', time:'Livreur pou apel ou; ler exak depann lor so larout.', details:'Pou prepar ou komann, avoy nou', name:'ou nom konple', phone:'ou nimero telefonn', location:'ou ladres livrezon ek lokalite', quantity:'kantite ou anvi', sold:'Sa prodwi-la finn mark fini an stok pou lemoman. Ou anvi nou ed ou trouv enn lot opsion?', ready:'Mersi. Nou finn gagn ou bann detay pou lekip verifye ek konfirm komann-la. Ou komann pankor konfirme.', variant:'Dir nou ki model ouswa kouler ou anvi pou lekip kapav verifye bon opsion-la.', listed:'Pri afise pou', is:'se', bonus:'Of enn aste, enn gratis inklir lartik anplis-la.', ask:'Ou anvi komande?', set:'inite' },
} as const

/** The model classifies/extracts only. It cannot invent a send body, price, delivery promise or order. */
export function buildReplyPlan(decision: ReplyDecision, context: TrustedContext, products: CatalogueProduct[], deliveryDate: string, now = new Date()): ReplyPlan {
  const fingerprint = catalogueFingerprint(products)
  const stop = (reason: string): ReplyPlan => ({ action:'review',reason,catalogueFingerprint:fingerprint })
  if (!context.eligible || !context.latestInbound) return stop('history_needs_review')
  const latestMessage=context.messages.find(m=>m.id===context.latestInbound!.id && m.direction==='in')
  if(!latestMessage)return stop('history_needs_review')
  // Persist a specific handoff reason so exchanges and customer issues remain
  // visible to staff instead of disappearing into a generic review result.
  if (decision.intent === 'complaint' || issueContext.test(normal(latestMessage.text))) return stop('customer_issue')
  if (decision.intent === 'change_order' || changeContext.test(normal(latestMessage.text))) return stop('exchange_or_change_request')
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Indian/Mauritius',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || deliveryDate < today || !Number.isFinite(Date.parse(deliveryDate)) || new Date(deliveryDate).toISOString().slice(0,10)!==deliveryDate) return stop('delivery_date_required')
  if(staffContext.test(normal(latestMessage.text)))return stop('staff_judgement_required')
  // A vague follow-up to a confirmed order must not replace its agreed date with today's general policy.
  if(context.messages.some(m=>confirmedOrder.test(normal(m.text))))return stop('existing_order_needs_review')
  if (decision.needsStaff || ['technical','complaint','change_order','postal','collection','other'].includes(decision.intent)) return stop('staff_judgement_required')
  if (decision.intent === 'acknowledgement') return { action:'skip',reason:'no_reply_needed',catalogueFingerprint:fingerprint }
  const c = copy[decision.language] ?? copy.en
  const date = new Intl.DateTimeFormat(decision.language === 'fr' ? 'fr-FR' : 'en-GB',{timeZone:'Indian/Mauritius',weekday:'long',day:'numeric',month:'long'}).format(new Date(deliveryDate+'T08:00:00Z'))
  const delivery = `${c.free} ${c.date} ${date}. ${c.time}`
  const send = (text:string,reason:string,evidence:Record<string,string> = {}):ReplyPlan => ({action:'send',text,reason,evidence,catalogueFingerprint:fingerprint})
  if (decision.intent === 'delivery') return send(delivery,'delivery_information')
  const product = products.find(p => p.id === decision.productId)
  const pe = decision.productEvidence
  const productEvidence = product && evidenceExists(pe,context.messages,false) && pe && normal(pe.value).length >= 4 &&
    products.filter(p => normal(pe.value).includes(normal(p.name)) || normal(p.name).includes(normal(pe.value))).length === 1 &&
    (normal(pe.value).includes(normal(product.name)) || normal(product.name).includes(normal(pe.value)))
  if (!product || !productEvidence) return send(c.product,'product_clarification')
  const evidenceIndex=context.messages.findIndex(m=>m.id===pe!.messageId)
  const later=context.messages.slice(evidenceIndex+1)
  if(later.some(m=>confirmedOrder.test(normal(m.text))))return stop('existing_order_needs_review')
  if(later.some(m=>products.some(p=>p.id!==product.id&&hasProductName(m.text,p))))return stop('product_context_changed')
  // When a latest enquiry itself names competing products, never quote the old selected item.
  if(products.filter(p=>hasProductName(latestMessage.text,p)).length>1)return stop('product_context_ambiguous')
  if (product.sold_out) return send(c.sold,'sold_out',{productId:product.id})
  if (product.has_variants) return send(c.variant,'variant_clarification',{productId:product.id})
  const evidence:Record<string,string> = {productId:product.id,productName:product.name,productMessageId:pe!.messageId}
  if (decision.intent === 'price' || decision.intent === 'greeting') {
    const minimum = setSize(product) || 1
    const amount = priceFor(product,minimum)
    if (!Number.isFinite(amount) || amount <= 0) return stop('price_needs_review')
    const label = minimum > 1 ? `${minimum} ${c.set} (${product.name})` : product.name
    return send(`${c.listed} ${label} ${c.is} Rs ${amount.toLocaleString('en-GB')}. ${product.is_b1g1 ? c.bonus+' ' : ''}${c.free} ${c.ask}`,'catalogue_price',evidence)
  }
  const missing:string[] = []
  for (const [key,label] of [['name',c.name],['phone',c.phone],['location',c.location]] as const) {
    const e=decision[key]
    let present = evidenceExists(e,context.messages)
    if (key === 'phone') present = present && /^(?:\+?230[\s-]?)?5(?:[\s-]?\d){7}$/.test(e!.value.trim())
    if (!present) missing.push(label)
    else {evidence[key] = e!.value;evidence[key+'MessageId']=e!.messageId}
  }
  if (!quantityConfirmed(decision.quantity,decision.quantityEvidence,context.messages)) missing.push(c.quantity)
  else {evidence.quantity=String(decision.quantity);evidence.quantityMessageId=decision.quantityEvidence!.messageId}
  if (missing.length) return send(`${c.details} ${missing.join(', ')}. ${delivery}`,'collect_order_details',evidence)
  const pack=setSize(product),quantity=Number(evidence.quantity)
  if(pack>0&&quantity%pack!==0)return stop('quantity_pack_needs_review')
  const amount=priceFor(product,quantity)
  if(!Number.isFinite(amount)||amount<=0)return stop('price_needs_review')
  evidence.amount=String(amount)
  // Do not issue a booking confirmation without an idempotently persisted order.
  return send(c.ready,'order_ready_for_staff',evidence)
}
