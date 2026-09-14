create or replace function public.import_1688_selection(p_actor uuid,p_operation text,p_id uuid,p_revision integer,p_key uuid,p_hash text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.import_reorder_1688_selections; e public.import_purchase_events; pref public.product_1688_preferences; p public.products; v public.product_variants; r public.import_reorders; c public.import_reorder_1688_checks;
 snap jsonb; previous_selection jsonb; row_data jsonb; rev jsonb; source jsonb; spec jsonb; v_link_id uuid; v_supplier_id uuid; alias_id uuid; member text; v_supplier_name text; v_result jsonb; imports jsonb; target uuid; v_sku_key text; counter integer:=0;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('import_request:'||p_key::text));
 select * into e from public.import_purchase_events where request_key=p_key;
 if found then if e.actor_id is distinct from p_actor or e.request_hash is distinct from p_hash then raise exception 'Request key already used' using errcode='40001'; end if; return e.result; end if;
 perform pg_advisory_xact_lock(hashtextextended('1688-selection:'||p_id::text,0));
 select * into s from public.import_reorder_1688_selections where id=p_id for update;
 previous_selection:=case when s.id is not null then to_jsonb(s) else null end;
 if s.status='confirmed' and p_operation='confirm' then return s.result; end if;
 if s.id is not null and (s.revision<>p_revision or s.status<>'pending') then raise exception 'Selection changed. Reload the saved review.' using errcode='40001'; end if;
 if s.id is null and (p_operation<>'save' or p_revision<>0) then raise exception 'Saved selection unavailable'; end if;
 select * into p from public.products where id=coalesce(s.product_id,(p_payload->'guard'->'product'->>'id')::uuid) and is_active is true for update;
 if not found then raise exception 'Product is unavailable'; end if;
 perform 1 from public.product_variants where product_id=p.id order by id for update;
 perform 1 from public.import_reorder_items where id=coalesce(s.item_id,(p_payload->'snapshot'->'input'->>'itemId')::uuid) for update;
 perform 1 from public.purchase_orders where product_id=p.id or id=(coalesce(s.guard,p_payload->'guard')->'item'->>'source_import_id')::uuid order by id for share;
 select * into pref from public.product_1688_preferences where product_id=p.id for update;
 if p_operation='cancel' then
  update public.import_reorder_1688_selections set status='cancelled',revision=revision+1,updated_at=now() where id=p_id returning * into s;
  v_result:=to_jsonb(s);
 elsif p_operation='save' then
  snap:=p_payload->'snapshot'; source:=snap->'source';
  if public.import_1688_guard((snap->'input'->>'itemId')::uuid) is distinct from p_payload->'guard' then raise exception 'Inventory, original purchase or preference changed. Reload the review.' using errcode='40001'; end if;
  if coalesce(pref.revision,0)<>(snap->'input'->>'preferenceRevision')::integer then raise exception 'Preferred source changed' using errcode='40001'; end if;
  if s.id is null or s.snapshot->'check' is distinct from snap->'check' then
   select * into c from public.import_reorder_1688_checks where item_id=(snap->'input'->>'itemId')::uuid;
   if c.generation is distinct from (snap->'input'->>'generation')::integer or c.version is distinct from (snap->'input'->>'checkVersion')::integer then raise exception 'Research changed. Reload its saved evidence.' using errcode='40001'; end if;
   if source is distinct from c.evidence->'current' and source is distinct from c.evidence->'offers'->(snap->'input'->>'offerId') then raise exception 'Source is not in this saved check'; end if;
  elsif source is distinct from s.snapshot->'check'->'evidence'->'current' and source is distinct from s.snapshot->'check'->'evidence'->'offers'->(snap->'input'->>'offerId') then raise exception 'Choose a source from the preserved research evidence'; end if;
  member:=source->'supplier'->>'memberId'; v_supplier_name:=btrim(source->'supplier'->>'name');
  if coalesce(length(v_supplier_name),0)=0 then raise exception 'Supplier identity is missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('foreign-supplier-identity',0));
  select profile_id into alias_id from public.foreign_supplier_aliases where legacy_name=v_supplier_name;
  if member is not null then select id into v_supplier_id from public.foreign_supplier_profiles where member_id=member; end if;
  if alias_id is not null and v_supplier_id is not null and alias_id<>v_supplier_id then raise exception 'Supplier identity conflicts with an existing quality record'; end if;
  if alias_id is not null and exists(select 1 from public.foreign_supplier_profiles where id=alias_id and member_id is not null and member_id is distinct from member) then raise exception 'This exact supplier name is already linked to another shop'; end if;
  v_supplier_id:=coalesce(v_supplier_id,alias_id);
  if v_supplier_id is null then insert into public.foreign_supplier_profiles(display_name,member_id,identity_verified_at,identity_verified_by) values(v_supplier_name,member,case when member is not null then now() end,p_actor) returning id into v_supplier_id; end if;
  if alias_id is null then insert into public.foreign_supplier_aliases(legacy_name,profile_id,provenance,confirmed_by,confirmed_at) values(v_supplier_name,v_supplier_id,'buyer_confirmed',p_actor,now()); end if;
  if member is not null then update public.foreign_supplier_profiles set member_id=member,identity_verified_at=coalesce(identity_verified_at,now()),identity_verified_by=coalesce(identity_verified_by,p_actor) where id=v_supplier_id and member_id is null; end if;
  select id into v_link_id from public.product_links where product_id=p.id and url=source->>'pageUrl' order by id limit 1;
  if v_link_id is null then insert into public.product_links(product_id,product_name,url,offer_id,label,is_active,created_by) values(p.id,p.name,source->>'pageUrl',source->>'offerId','Buyer-selected purchasing source',false,p_actor) returning id into v_link_id; end if;
  insert into public.product_1688_preferences(product_id,link_id,offer_id,supplier_id,supplier_name,listing_url,revision,selected_by) values(p.id,v_link_id,source->>'offerId',v_supplier_id,v_supplier_name,source->>'pageUrl',coalesce(pref.revision,0)+1,p_actor)
   on conflict(product_id) do update set link_id=excluded.link_id,offer_id=excluded.offer_id,supplier_id=excluded.supplier_id,supplier_name=excluded.supplier_name,listing_url=excluded.listing_url,revision=excluded.revision,selected_by=excluded.selected_by,selected_at=now() returning * into pref;
  insert into public.import_reorder_1688_selections(id,item_id,product_id,revision,preference_revision,snapshot,guard,created_by)
   values(p_id,(snap->'input'->>'itemId')::uuid,p.id,coalesce(s.revision,0)+1,pref.revision,snap,public.import_1688_guard((snap->'input'->>'itemId')::uuid),p_actor)
   on conflict(id) do update set revision=excluded.revision,preference_revision=excluded.preference_revision,snapshot=excluded.snapshot,guard=excluded.guard,updated_at=now() returning * into s;
  v_result:=to_jsonb(s);
 elsif p_operation='photo' then
  if public.import_1688_guard(s.item_id) is distinct from s.guard then raise exception 'Inventory changed. Reload before preparing images.' using errcode='40001'; end if;
  if jsonb_typeof(p_payload->'photos') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload->'photos'))>4 then raise exception 'Prepare at most four images per request'; end if;
  update public.import_reorder_1688_selections set photos=photos||(p_payload->'photos'),revision=revision+1,updated_at=now() where id=p_id returning * into s;
  v_result:=to_jsonb(s);
 elsif p_operation='confirm' then
  if not coalesce((p_payload->>'accepted')::boolean,false) then raise exception 'Explicit confirmation is required'; end if;
  if public.import_1688_guard(s.item_id) is distinct from s.guard or pref.revision is distinct from s.preference_revision then raise exception 'Inventory, source or previous purchase changed. Reload and review before confirming.' using errcode='40001'; end if;
  snap:=p_payload->'snapshot';
  if snap->>'orderDate' is null or jsonb_typeof(snap->'lines') is distinct from 'array' or jsonb_array_length(snap->'lines') not between 1 and 200 then raise exception 'Enter an order date and 1 to 200 purchased SKU lines'; end if;
  if coalesce((snap->'terms'->>'landedReviewed')::boolean,false) then raise exception 'Sourcing estimates cannot become actual landed cost'; end if;
  if (s.snapshot->'input'->>'convertToVariants')::boolean and not coalesce(p.has_variants,false) then
   if p.quantity is distinct from 0 then raise exception 'Allocate parent stock before conversion. No stock was changed.'; end if;
   update public.products set has_variants=true,updated_at=now() where id=p.id;
   p.has_variants:=true;
  end if;
  for row_data in select value from jsonb_array_elements(s.snapshot->'rows') where (value->'review'->>'include')::boolean loop
   rev:=row_data->'review'; spec:=row_data->'sku';
   if not coalesce((rev->>'reviewed')::boolean,false) then raise exception 'Every included SKU needs buyer review'; end if;
   v_sku_key:=case when spec->>'providerId' is not null then 'sku:'||(spec->>'providerId') when spec->>'specId' is not null then 'spec:'||(spec->>'specId') when spec->>'propsIds' is not null then 'props:'||(spec->>'propsIds') end;
   if v_sku_key is null then raise exception 'Stable SKU identity is required'; end if;
   if rev->>'destination'='parent' then
    if coalesce(p.has_variants,false) then raise exception 'Variant product cannot map to a parent'; end if; target:=null;
   else
    if not coalesce(p.has_variants,false) then raise exception 'Review explicit product conversion first'; end if;
    target:=(rev->>'variantId')::uuid;
    if rev->>'destination'='new' then
     if coalesce(length(btrim(rev->>'attributeName')),0)=0 or coalesce(length(btrim(rev->>'attributeValue')),0)=0 then raise exception 'Complete variant attributes are required'; end if;
     insert into public.product_variants(id,product_id,attribute_name,attribute_value,quantity,price_override,sku,is_active) values(target,p.id,rev->>'attributeName',rev->>'attributeValue',0,null,null,true);
    elsif rev->>'destination'<>'existing' then raise exception 'Choose an Inventory destination'; end if;
    select * into v from public.product_variants where id=target and product_id=p.id for update;
    if not found then raise exception 'Variant no longer belongs to this product'; end if;
    if coalesce((rev->>'qty')::integer,0)>0 and v.is_active is not true then raise exception 'The ordered variant is inactive'; end if;
   end if;
   if exists(select 1 from public.product_1688_sku_links where product_id=p.id and offer_id=s.snapshot->'source'->>'offerId' and sku_key=v_sku_key and variant_id is distinct from target) then raise exception 'Confirmed SKU mapping cannot silently move'; end if;
   insert into public.product_1688_sku_links(product_id,offer_id,sku_key,target_kind,variant_id,source_spec,confirmed_by) values(p.id,s.snapshot->'source'->>'offerId',v_sku_key,case when target is null then 'parent' else 'variant' end,target,spec,p_actor)
    on conflict(product_id,offer_id,sku_key) do update set source_spec=excluded.source_spec,confirmed_by=excluded.confirmed_by,confirmed_at=now();
   if not coalesce((rev->>'keepPhoto')::boolean,false) then
    source:=s.photos->(spec->>'id');
    if source->>'status' is distinct from 'ready' or source->>'url' is null then raise exception 'Prepare each final photo or explicitly keep its existing photo'; end if;
    if target is null then update public.products set image_url=source->>'url',updated_at=now() where id=p.id;
    else update public.product_variants set image_url=source->>'url',updated_at=now() where id=target; end if;
   end if;
  end loop;
  insert into public.import_reorders(supplier_name,status,draft,created_by) values(snap->>'supplierName','draft',snap-'lines',p_actor) returning * into r;
  for row_data in select value from jsonb_array_elements(snap->'lines') loop
   counter:=counter+1;
   insert into public.import_reorder_lines(id,reorder_id,product_id,variant_id,source_import_id,position,line_data) values((row_data->>'id')::uuid,r.id,p.id,(row_data->>'variantId')::uuid,(row_data->>'sourceImportId')::uuid,counter,row_data);
  end loop;
  imports:=public.import_record_ordered_lines(p_actor,r.id,snap,p_payload->'imports');
  update public.purchase_orders po set variant_snapshot=coalesce(po.variant_snapshot,'{}')||jsonb_build_object('sourcing',l.line_data->'sourcing','imageUrl',po.image_url) from public.import_reorder_lines l where l.reorder_id=r.id and l.created_import_id=po.id;
  update public.import_reorders set status='confirmed',confirmed_snapshot=snap||jsonb_build_object('imports',imports,'sourcingSelectionId',s.id,'originalResearch',s.snapshot->'check','catalogueReview',s.snapshot->'rows'),confirmed_by=p_actor,confirmed_at=now(),revision=revision+1,updated_at=now() where id=r.id returning * into r;
  v_result:=jsonb_build_object('id',r.id,'revision',r.revision,'number',r.number,'status',r.status,'imports',imports);
  update public.import_reorder_1688_selections set status='confirmed',result=v_result,revision=revision+1,updated_at=now() where id=p_id;
 else raise exception 'Invalid sourcing operation'; end if;
 insert into public.import_purchase_events(reorder_id,event_type,actor_id,request_key,request_hash,before_snapshot,after_snapshot,result) values(r.id,'sourcing-'||p_operation,p_actor,p_key,p_hash,previous_selection,case when p_operation='confirm' then snap else to_jsonb(s) end,v_result);
 return v_result;
end $$;
revoke all on function public.import_1688_selection(uuid,text,uuid,integer,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_1688_selection(uuid,text,uuid,integer,uuid,text,jsonb) to service_role;
