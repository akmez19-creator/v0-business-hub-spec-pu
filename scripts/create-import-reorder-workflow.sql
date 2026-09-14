-- Applied through Supabase MCP as 20260909134520_add_transactional_import_reorder_workflow.
-- Requires create-import-reorder-storage.sql; includes the verified live function and grants.
CREATE OR REPLACE FUNCTION public.import_reorder_mutate(p_actor uuid, p_id uuid, p_revision integer, p_key uuid, p_hash text, p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 r public.import_reorders; e public.import_purchase_events; l jsonb; s jsonb; v_before jsonb; v_result jsonb;
 po public.purchase_orders; v_product public.products; v_variant public.product_variants;
 v_imports jsonb := '[]'::jsonb; v_index text; v_last text; v_number integer; v_position integer:=0;
 v_id uuid; v_rows jsonb; v_response_line jsonb;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed'; end if;
 perform pg_advisory_xact_lock(hashtext('import_request:'||p_key::text));
 select * into e from public.import_purchase_events where request_key=p_key;
 if found then
  if e.request_hash is distinct from p_hash or e.actor_id is distinct from p_actor then raise exception 'Request key already used with different content'; end if;
  return e.result;
 end if;
 if p_operation='create' then
  if jsonb_typeof(p_payload->'requests') is distinct from 'array' or jsonb_array_length(p_payload->'requests') not between 1 and 100 then raise exception 'Choose between 1 and 100 supplier requests'; end if;
  v_result:='[]'::jsonb;
  for s in select value from jsonb_array_elements(p_payload->'requests') loop
   v_id:=gen_random_uuid();
   v_result:=v_result||jsonb_build_array(public.import_reorder_mutate(p_actor,v_id,0,gen_random_uuid(),p_hash,'save',jsonb_build_object('snapshot',s)));
  end loop;
  v_result:=jsonb_build_object('requests',v_result);
  insert into public.import_purchase_events(event_type,actor_id,request_key,request_hash,result) values('create',p_actor,p_key,p_hash,v_result);
  return v_result;
 end if;
 perform pg_advisory_xact_lock(hashtext('import_reorder:'||p_id::text));
 select * into r from public.import_reorders where id=p_id for update;
 if not found then
  if p_operation<>'save' or p_revision<>0 then raise exception 'This reorder is unavailable'; end if;
  insert into public.import_reorders(id,created_by) values(p_id,p_actor) returning * into r;
  r.revision:=0;
 elsif r.revision<>p_revision then raise exception 'This reorder changed. Reload before continuing.'; end if;
 v_before:=to_jsonb(r);
 if r.status in ('confirmed','cancelled') then raise exception 'This reorder is closed. Open Imports to manage confirmed records.'; end if;
 if p_operation='save' then
  if r.status<>'draft' then raise exception 'Reopen the request before changing approved terms'; end if;
  s:=p_payload->'snapshot';
  if jsonb_typeof(s->'lines') is distinct from 'array' or jsonb_array_length(s->'lines')>200 then raise exception 'Invalid product lines'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(s->'lines'))<>jsonb_array_length(s->'lines') then raise exception 'Duplicate line identifiers'; end if;
  update public.import_reorder_lines set is_active=false where reorder_id=p_id;
  for l in select value from jsonb_array_elements(s->'lines') loop
   v_position:=v_position+1;
   if exists(select 1 from public.import_reorder_lines where id=(l->>'id')::uuid and reorder_id<>p_id) then raise exception 'A line belongs to a different request'; end if;
   select * into v_product from public.products where id=(l->>'productId')::uuid and is_active is true for share;
   if not found then raise exception 'Choose an active catalogue product'; end if;
   if l->>'variantId' is not null then
    select * into v_variant from public.product_variants where id=(l->>'variantId')::uuid and product_id=v_product.id and is_active is true for share;
    if not found then raise exception 'Choose an active variant belonging to this product'; end if;
   end if;
   insert into public.import_reorder_lines(id,reorder_id,product_id,variant_id,source_import_id,position,line_data)
   values((l->>'id')::uuid,p_id,v_product.id,(l->>'variantId')::uuid,
    case when exists(select 1 from public.purchase_orders where id=(l->>'sourceImportId')::uuid) then (l->>'sourceImportId')::uuid else null end,v_position,l)
   on conflict(id) do update set product_id=excluded.product_id,variant_id=excluded.variant_id,source_import_id=excluded.source_import_id,position=excluded.position,line_data=excluded.line_data,is_active=true;
  end loop;
  update public.import_reorders set supplier_name=coalesce(s->>'supplierName',''),draft=s-'lines',requested_snapshot=null,supplier_snapshot=null,approved_at=null,approved_by=null,revision=r.revision+1,updated_at=now() where id=p_id returning * into r;
 elsif p_operation='approve' then
  if r.status<>'draft' or btrim(r.supplier_name)='' then raise exception 'Complete the supplier before buyer approval'; end if;
  s:=r.draft||jsonb_build_object('supplierName',r.supplier_name,'lines',coalesce((select jsonb_agg(line_data||jsonb_build_object('productId',product_id,'variantId',variant_id) order by position,id) from public.import_reorder_lines where reorder_id=p_id and is_active),'[]'::jsonb));
  if s is distinct from p_payload->'snapshot' then raise exception 'Product references changed. Reload and review.'; end if;
  if jsonb_array_length(s->'lines')=0 then raise exception 'Add at least one product'; end if;
  for l in select value from jsonb_array_elements(s->'lines') loop
   if l->>'productId' is null or coalesce((l->>'qty')::numeric,0)<=0 or (l->>'qty')::numeric<>floor((l->>'qty')::numeric) or coalesce((l->>'unavailable')::boolean,false) then raise exception 'Every requested product needs a positive whole-unit quantity'; end if;
  end loop;
  update public.import_reorders set status='awaiting_supplier',requested_snapshot=s,supplier_snapshot=null,approved_by=p_actor,approved_at=now(),revision=revision+1,updated_at=now() where id=p_id returning * into r;
 elsif p_operation='response' then
  if r.status<>'awaiting_supplier' then raise exception 'Buyer approval is required before supplier review'; end if;
  s:=p_payload->'snapshot';
  if s->>'supplierName' is distinct from r.supplier_name or jsonb_array_length(s->'lines')<>jsonb_array_length(r.requested_snapshot->'lines') then raise exception 'The supplier response must match this request'; end if;
  for l in select value from jsonb_array_elements(s->'lines') loop
   if not exists(select 1 from public.import_reorder_lines where id=(l->>'id')::uuid and reorder_id=p_id and is_active and product_id is not distinct from (l->>'productId')::uuid and variant_id is not distinct from (l->>'variantId')::uuid) then raise exception 'Product or variant references changed. Reopen the request.'; end if;
  end loop;
  update public.import_reorders set supplier_snapshot=s,revision=revision+1,updated_at=now() where id=p_id returning * into r;
 elsif p_operation='confirm' then
  if r.status<>'awaiting_supplier' or r.supplier_snapshot is null or p_payload->'snapshot' is distinct from r.supplier_snapshot or not coalesce((p_payload->>'accepted')::boolean,false) then raise exception 'Review and accept the saved supplier response'; end if;
  if r.supplier_snapshot->>'orderDate' is null then raise exception 'Enter the actual import order date'; end if;
  v_rows:=p_payload->'imports';
  if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows)=0 or jsonb_array_length(v_rows)<>(select count(*) from jsonb_array_elements(r.supplier_snapshot->'lines') x where not coalesce((x->>'unavailable')::boolean,false)) then raise exception 'Confirmed import lines are incomplete'; end if;
  perform pg_advisory_xact_lock(hashtext('purchase_orders_manual_index'));
  select upper(index_no) into v_last from public.purchase_orders where index_no~'^[A-Za-z]{3}$' order by upper(index_no) desc limit 1;
  v_number:=case when v_last is null then 0 else (ascii(substr(v_last,1,1))-65)*676+(ascii(substr(v_last,2,1))-65)*26+ascii(substr(v_last,3,1))-65+1 end;
  for l in select value from jsonb_array_elements(v_rows) loop
   select value into v_response_line from jsonb_array_elements(r.supplier_snapshot->'lines') where value->>'id'=l->>'line_id';
   if v_response_line is null or coalesce((v_response_line->>'unavailable')::boolean,false) or l->>'product_id' is distinct from v_response_line->>'productId' or l->>'variant_id' is distinct from v_response_line->>'variantId' or (l->>'qty')::numeric is distinct from (v_response_line->>'qty')::numeric then raise exception 'Confirmation does not match the reviewed supplier response'; end if;
   if coalesce((l->>'qty')::numeric,0)<=0 or (l->>'qty')::numeric<>floor((l->>'qty')::numeric) then raise exception 'Invalid confirmed quantity'; end if;
   select * into v_product from public.products where id=(l->>'product_id')::uuid and is_active is true for share;
   if not found then raise exception 'A confirmed product is no longer active'; end if;
   if not exists(select 1 from public.import_reorder_lines where id=(l->>'line_id')::uuid and reorder_id=p_id and is_active and product_id=v_product.id and variant_id is not distinct from (l->>'variant_id')::uuid and created_import_id is null) then raise exception 'A confirmed line changed or was already imported'; end if;
   v_variant:=null;
   if l->>'variant_id' is not null then
    select * into v_variant from public.product_variants where id=(l->>'variant_id')::uuid and product_id=v_product.id and is_active is true for share;
    if not found then raise exception 'A confirmed variant is no longer available'; end if;
   end if;
   if v_number>17575 then raise exception 'The import index has reached ZZZ'; end if;
   v_index:=chr(65+v_number/676)||chr(65+(v_number/26)%26)||chr(65+v_number%26); v_number:=v_number+1;
   insert into public.purchase_orders(index_no,status,reorder,link,supplier_name,carton,image_url,product_name,product_id,variant_id,variant_snapshot,reorder_line_id,qty,unit_price,discounted_unit_price,shipment_to_warehouse,discounted_shipment_to_warehouse,discounted_percentage,total_payment_supplier_yuan,total_payment_supplier,payment_link,weight_kg,cbm,boxes,cbm_cost,import_cp,total_cp_import,tracking_number,order_date,expected_arrival_date)
   values(v_index,'Ordered',l->>'reorder',l->>'link',r.supplier_name,l->>'carton',l->>'image_url',l->>'product_name',v_product.id,v_variant.id,
    case when v_variant.id is not null then jsonb_build_object('id',v_variant.id,'attributeName',v_variant.attribute_name,'attributeValue',v_variant.attribute_value,'selectedBy',p_actor) else null end,(l->>'line_id')::uuid,
    (l->>'qty')::integer,(l->>'unit_price')::numeric,(l->>'discounted_unit_price')::numeric,(l->>'shipment_to_warehouse')::numeric,(l->>'discounted_shipment_to_warehouse')::numeric,(l->>'discounted_percentage')::numeric,(l->>'total_payment_supplier_yuan')::numeric,(l->>'total_payment_supplier')::numeric,null,(l->>'weight_kg')::numeric,(l->>'cbm')::numeric,(l->>'boxes')::integer,(l->>'cbm_cost')::numeric,(l->>'import_cp')::numeric,(l->>'total_cp_import')::numeric,null,(r.supplier_snapshot->>'orderDate')::date,(r.supplier_snapshot->>'expectedDate')::date) returning * into po;
   update public.import_reorder_lines set created_import_id=po.id where id=(l->>'line_id')::uuid;
   v_imports:=v_imports||jsonb_build_array(jsonb_build_object('id',po.id,'index',v_index,'lineId',l->>'line_id'));
  end loop;
  update public.import_reorders set status='confirmed',confirmed_snapshot=supplier_snapshot||jsonb_build_object('imports',v_imports),confirmed_by=p_actor,confirmed_at=now(),revision=revision+1,updated_at=now() where id=p_id returning * into r;
 elsif p_operation='reopen' then
  if r.status<>'awaiting_supplier' then raise exception 'Only an approved request can be reopened'; end if;
  update public.import_reorders set status='draft',requested_snapshot=null,supplier_snapshot=null,approved_at=null,approved_by=null,revision=revision+1,updated_at=now() where id=p_id returning * into r;
 elsif p_operation='cancel' then
  if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'Enter a cancellation reason'; end if;
  update public.import_reorders set status='cancelled',revision=revision+1,updated_at=now() where id=p_id returning * into r;
 else raise exception 'Unknown reorder operation'; end if;
 v_result:=jsonb_build_object('id',p_id,'revision',r.revision,'number',r.number,'status',r.status,'imports',v_imports);
 insert into public.import_purchase_events(reorder_id,event_type,actor_id,request_key,request_hash,before_snapshot,after_snapshot,reason,result)
 values(p_id,p_operation,p_actor,p_key,p_hash,v_before,to_jsonb(r)||jsonb_build_object('lines',coalesce((select jsonb_agg(line_data order by position,id) from public.import_reorder_lines where reorder_id=p_id and is_active),'[]'::jsonb)),p_payload->>'reason',v_result);
 return v_result;
end;
$function$;

revoke all on function public.import_reorder_mutate(uuid,uuid,integer,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_reorder_mutate(uuid,uuid,integer,uuid,text,text,jsonb) to service_role;
