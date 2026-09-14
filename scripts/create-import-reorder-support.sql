-- Applied through Supabase MCP as 20260909134613_add_import_saved_list_settings_and_corrections.
-- Requires create-import-reorder-storage.sql; includes the verified live functions and grants.
CREATE OR REPLACE FUNCTION public.import_reorder_support(p_actor uuid, p_id uuid, p_revision integer, p_key uuid, p_hash text, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e public.import_purchase_events; i public.import_reorder_items; s public.import_reorder_settings; v_before jsonb; v_after jsonb; v_result jsonb; v_product uuid; v_variant uuid;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed'; end if;
 perform pg_advisory_xact_lock(hashtext('import_request:'||p_key::text));
 select * into e from public.import_purchase_events where request_key=p_key;
 if found then
  if e.request_hash is distinct from p_hash or e.actor_id is distinct from p_actor then raise exception 'Request key already used with different content'; end if;
  return e.result;
 end if;
 perform pg_advisory_xact_lock(hashtext('import_support:'||p_id::text));
 if p_operation='item' then
  select * into i from public.import_reorder_items where id=p_id for update;
  if (found and i.revision<>p_revision) or (not found and p_revision<>0) then raise exception 'The saved item changed. Reload before saving.'; end if;
  v_before:=case when i.id is null then null else to_jsonb(i) end;
  v_product:=(p_payload->'item'->>'productId')::uuid; v_variant:=(p_payload->'item'->>'variantId')::uuid;
  if p_payload->>'status'<>'excluded' then
   if not exists(select 1 from public.products where id=v_product and is_active is true) then raise exception 'Choose an active product'; end if;
   if v_variant is not null and not exists(select 1 from public.product_variants where id=v_variant and product_id=v_product and is_active is true) then raise exception 'Choose a valid active variant'; end if;
  end if;
  insert into public.import_reorder_items(id,product_id,variant_id,source_import_id,supplier_name,item,status,priority,review_date,revision,created_by)
  values(p_id,v_product,v_variant,case when exists(select 1 from public.purchase_orders where id=(p_payload->'item'->>'sourceImportId')::uuid) then (p_payload->'item'->>'sourceImportId')::uuid else null end,coalesce(p_payload->>'supplierName',''),p_payload->'item',p_payload->>'status',(p_payload->>'priority')::integer,(p_payload->>'reviewDate')::date,p_revision+1,p_actor)
  on conflict(id) do update set product_id=excluded.product_id,variant_id=excluded.variant_id,source_import_id=excluded.source_import_id,supplier_name=excluded.supplier_name,item=excluded.item,status=excluded.status,priority=excluded.priority,review_date=excluded.review_date,revision=excluded.revision,updated_at=now() returning * into i;
  v_after:=to_jsonb(i); v_result:=jsonb_build_object('id',i.id,'revision',i.revision);
 elsif p_operation='settings' then
  v_product:=(p_payload->>'productId')::uuid;
  perform pg_advisory_xact_lock(hashtext('import_settings:'||coalesce(v_product::text,'')||':'||coalesce(p_payload->>'supplierName','')));
  select * into s from public.import_reorder_settings where product_id is not distinct from v_product and supplier_name is not distinct from nullif(btrim(p_payload->>'supplierName'),'') for update;
  if (found and (s.revision<>p_revision or s.id<>p_id)) or (not found and p_revision<>0) then raise exception 'Planning settings changed. Reload before saving.'; end if;
  v_before:=case when s.id is null then null else to_jsonb(s) end;
  insert into public.import_reorder_settings(id,product_id,supplier_name,lead_days,cover_days,buffer_days,daily_units,quantity_multiple,revision,updated_by)
  values(p_id,v_product,nullif(btrim(p_payload->>'supplierName'),''),(p_payload->>'leadDays')::integer,(p_payload->>'coverDays')::integer,(p_payload->>'bufferDays')::integer,(p_payload->>'dailyUnits')::numeric,(p_payload->>'quantityMultiple')::integer,p_revision+1,p_actor)
  on conflict(id) do update set lead_days=excluded.lead_days,cover_days=excluded.cover_days,buffer_days=excluded.buffer_days,daily_units=excluded.daily_units,quantity_multiple=excluded.quantity_multiple,revision=excluded.revision,updated_at=now(),updated_by=p_actor returning * into s;
  v_after:=to_jsonb(s); v_result:=jsonb_build_object('id',s.id,'revision',s.revision);
 else raise exception 'Unknown saved-list operation'; end if;
 insert into public.import_purchase_events(event_type,actor_id,request_key,request_hash,before_snapshot,after_snapshot,result) values(p_operation,p_actor,p_key,p_hash,v_before,v_after,v_result);
 return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_correct_purchase(p_actor uuid, p_id uuid, p_key uuid, p_hash text, p_expected jsonb, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare before_row public.purchase_orders; after_row public.purchase_orders; e public.import_purchase_events; v_result jsonb; v_variant public.product_variants;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed'; end if;
 if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Give a clear correction reason'; end if;
 perform pg_advisory_xact_lock(hashtext('import_request:'||p_key::text));
 select * into e from public.import_purchase_events where request_key=p_key;
 if found then
  if e.request_hash is distinct from p_hash or e.actor_id is distinct from p_actor then raise exception 'Request key already used with different content'; end if;
  return e.result;
 end if;
 select * into before_row from public.purchase_orders where id=p_id for update;
 if not found then raise exception 'This import is unavailable'; end if;
 if to_jsonb(before_row) is distinct from p_expected then raise exception 'This import changed. Reload and review the current record.'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('product_id','variant_id','product_name','supplier_name','link','image_url','status','order_date','expected_arrival_date','qty','carton','unit_price','discounted_unit_price','shipment_to_warehouse','discounted_shipment_to_warehouse','discounted_percentage','total_payment_supplier_yuan','total_payment_supplier','weight_kg','cbm','boxes','cbm_cost','import_cp','total_cp_import','tracking_number','payment_link','reorder')) then raise exception 'Unsupported correction field'; end if;
 after_row:=jsonb_populate_record(before_row,p_patch);
 if p_patch?'product_id' and after_row.product_id is distinct from before_row.product_id and not p_patch?'variant_id' then after_row.variant_id:=null; end if;
 if p_patch?'variant_id' or p_patch?'product_id' then
  if after_row.product_id is not null and not exists(select 1 from public.products where id=after_row.product_id) then raise exception 'Product unavailable'; end if;
  if after_row.variant_id is not null then
   select * into v_variant from public.product_variants where id=after_row.variant_id and product_id=after_row.product_id and is_active is true;
   if not found then raise exception 'Variant does not belong to the selected product'; end if;
   after_row.variant_snapshot:=jsonb_build_object('id',v_variant.id,'attributeName',v_variant.attribute_name,'attributeValue',v_variant.attribute_value,'selectedBy',p_actor);
  else after_row.variant_snapshot:=null; end if;
 end if;
 update public.purchase_orders set product_id=after_row.product_id,variant_id=after_row.variant_id,variant_snapshot=after_row.variant_snapshot,product_name=after_row.product_name,supplier_name=after_row.supplier_name,link=after_row.link,image_url=after_row.image_url,status=after_row.status,order_date=after_row.order_date,expected_arrival_date=after_row.expected_arrival_date,qty=after_row.qty,carton=after_row.carton,unit_price=after_row.unit_price,discounted_unit_price=after_row.discounted_unit_price,shipment_to_warehouse=after_row.shipment_to_warehouse,discounted_shipment_to_warehouse=after_row.discounted_shipment_to_warehouse,discounted_percentage=after_row.discounted_percentage,total_payment_supplier_yuan=after_row.total_payment_supplier_yuan,total_payment_supplier=after_row.total_payment_supplier,weight_kg=after_row.weight_kg,cbm=after_row.cbm,boxes=after_row.boxes,cbm_cost=after_row.cbm_cost,import_cp=after_row.import_cp,total_cp_import=after_row.total_cp_import,tracking_number=after_row.tracking_number,payment_link=after_row.payment_link,reorder=after_row.reorder,updated_at=now() where id=p_id returning * into after_row;
 v_result:=jsonb_build_object('id',p_id,'updatedAt',after_row.updated_at);
 insert into public.import_purchase_events(import_id,event_type,actor_id,request_key,request_hash,before_snapshot,after_snapshot,reason,result) values(p_id,'correction',p_actor,p_key,p_hash,to_jsonb(before_row),to_jsonb(after_row),p_reason,v_result);
 return v_result;
end;
$function$;

revoke all on function public.import_reorder_support(uuid,uuid,integer,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.import_correct_purchase(uuid,uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.import_reorder_support(uuid,uuid,integer,uuid,text,text,jsonb) to service_role;
grant execute on function public.import_correct_purchase(uuid,uuid,uuid,text,jsonb,jsonb,text) to service_role;
