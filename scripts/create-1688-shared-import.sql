do $$ declare d text; fragment text; first_pos integer; last_pos integer; helper text; begin
 if to_regprocedure('public.import_record_ordered_lines(uuid,uuid,jsonb,jsonb)') is not null then return; end if;
 select pg_get_functiondef('public.import_reorder_mutate(uuid,uuid,integer,uuid,text,text,jsonb)'::regprocedure) into d;
 first_pos:=strpos(d,'  perform pg_advisory_xact_lock(hashtext(''purchase_orders_manual_index''));');
 last_pos:=strpos(d,'  update public.import_reorders set status=''confirmed'',confirmed_snapshot=');
 if first_pos=0 or last_pos<=first_pos then raise exception 'Shared import creation block changed; migration refused'; end if;
 fragment:=substring(d from first_pos for last_pos-first_pos);
 helper:=replace(replace(fragment,'r.supplier_snapshot','p_snapshot'),'r.supplier_name','(p_snapshot->>''supplierName'')');
 execute 'create function public.import_record_ordered_lines(p_actor uuid,p_id uuid,p_snapshot jsonb,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='''' as $body$ declare v_rows jsonb:=p_rows; l jsonb; v_response_line jsonb; v_product public.products; v_variant public.product_variants; po public.purchase_orders; v_imports jsonb:=''[]''; v_index text; v_last text; v_number integer; begin if not exists(select 1 from public.profiles where id=p_actor and role in (''admin'',''manager'')) then raise exception ''Not allowed'' using errcode=''42501''; end if; if jsonb_array_length(p_rows)<>(select count(*) from jsonb_array_elements(p_snapshot->''lines'') x where not coalesce((x->>''unavailable'')::boolean,false)) then raise exception ''Incomplete import lines''; end if; '||helper||' return v_imports; end $body$';
 d:=replace(d,fragment,'  v_imports:=public.import_record_ordered_lines(p_actor,p_id,r.supplier_snapshot,v_rows);'||E'\n');
 execute d;
end $$;
revoke all on function public.import_record_ordered_lines(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_record_ordered_lines(uuid,uuid,jsonb,jsonb) to service_role;
