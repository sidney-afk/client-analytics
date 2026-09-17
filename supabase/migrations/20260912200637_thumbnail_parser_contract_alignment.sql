-- Additive parser alignment for proved helper URL variants; no stale_source success bypass.
begin;
create or replace function public.card_followup_drive_id_v1(v text) returns text language plpgsql immutable set search_path=pg_catalog as $fn$
declare raw text:=btrim(coalesce(v,'')); parts text[]; host text; hit text[]; pair text; component text; decoded text; decoded_key text; pos integer; octet integer; part_index integer;
begin
 if length(raw)>8192 then return null;end if;
 if raw='' or raw ~* 'drive[.]google[.]com/(drive/)?(u/[0-9]+/)?folders/' or raw ~* 'drive[.]google[.]com/folderview[?]' then return '';end if;
 if raw ~ '^[A-Za-z0-9_-]{20,}$' then return raw;end if;
 parts:=regexp_match(raw,'^(https?://)?([^/?#]+)(/[^?#]*)?([?]([^#]*))?(#.*)?$','i');
 if parts is null or parts[2] !~ '^[A-Za-z0-9.-]+(:[0-9]+)?$' then return null;end if;
 if parts[2] ~ ':[0-9]+$' and (length(split_part(parts[2],':',2))>5 or split_part(parts[2],':',2)::integer>65535) then return '';end if;
 host:=regexp_replace(lower(parts[2]),':[0-9]+$','');
 if host !~ '(^|[.])(drive|docs)[.]google[.]com$' then return '';end if;
 -- WHATWG URL normalizes dot segments; unreviewed path normalization refuses.
 if coalesce(parts[3],'') ~* '(^|/)([.]|%2e){1,2}(/|$)' then return null;end if;
 hit:=regexp_match(coalesce(parts[3],''),'/file/d/([A-Za-z0-9_-]+)','i');
 if hit is not null then return hit[1];end if;
 hit:=regexp_match(coalesce(parts[3],''),'/(document|spreadsheets|presentation|drawings|forms)/d/([A-Za-z0-9_-]+)','i');
 if hit is not null then return hit[2];end if;
 -- URLSearchParams uses &, first matching case-sensitive decoded key, + as
 -- space, and percent-byte decoding. Non-ASCII/NUL cannot form an allowed ID;
 -- substitute ? rather than manufacture a valid ASCII key/value from them.
 foreach pair in array string_to_array(coalesce(parts[5],''),'&') loop
  decoded_key:=null;
  for part_index in 1..2 loop
   component:=case part_index when 1 then split_part(pair,'=',1) else case when strpos(pair,'=')>0 then substring(pair from strpos(pair,'=')+1) else '' end end;
   decoded:='';pos:=1;
   while pos<=length(component) loop
    if substring(component from pos for 1)='%' and substring(component from pos+1 for 2) ~ '^[A-Fa-f0-9]{2}$' then
     octet:=get_byte(decode(substring(component from pos+1 for 2),'hex'),0);decoded:=decoded||case when octet between 1 and 127 then chr(octet) else '?' end;pos:=pos+3;
    else decoded:=decoded||case when substring(component from pos for 1)='+' then ' ' else substring(component from pos for 1) end;pos:=pos+1;end if;
   end loop;
   if part_index=1 then decoded_key:=decoded;elsif decoded_key='id' then if decoded ~ '^[A-Za-z0-9_-]{20,}$' then return decoded;else return '';end if;end if;
  end loop;
 end loop;
 return '';
end;
$fn$;
create or replace function public.syncview_thumbnail_drive_file_id(p_url text) returns text language plpgsql immutable strict parallel safe set search_path=pg_catalog as $fn$
declare raw text:=btrim(coalesce(p_url,'')); parts text[]; host text; hit text[]; pair text; component text; decoded text; decoded_key text; pos integer; octet integer; part_index integer;
begin
 if length(raw)>8192 then return null;end if;
 if raw='' or raw ~* 'drive[.]google[.]com/(drive/)?(u/[0-9]+/)?folders/' or raw ~* 'drive[.]google[.]com/folderview[?]' then return null;end if;
 if raw ~ '^[A-Za-z0-9_-]{20,}$' then return raw;end if;
 parts:=regexp_match(raw,'^(https?://)?([^/?#]+)(/[^?#]*)?([?]([^#]*))?(#.*)?$','i');
 if parts is null or parts[2] !~ '^[A-Za-z0-9.-]+(:[0-9]+)?$' then return null;end if;
 if parts[2] ~ ':[0-9]+$' and (length(split_part(parts[2],':',2))>5 or split_part(parts[2],':',2)::integer>65535) then return null;end if;
 host:=regexp_replace(lower(parts[2]),':[0-9]+$','');
 if host !~ '(^|[.])(drive|docs)[.]google[.]com$' then return null;end if;
 -- WHATWG URL normalizes dot segments; unreviewed path normalization refuses.
 if coalesce(parts[3],'') ~* '(^|/)([.]|%2e){1,2}(/|$)' then return null;end if;
 hit:=regexp_match(coalesce(parts[3],''),'/file/d/([A-Za-z0-9_-]+)','i');
 if hit is not null then return hit[1];end if;
 hit:=regexp_match(coalesce(parts[3],''),'/(document|spreadsheets|presentation|drawings|forms)/d/([A-Za-z0-9_-]+)','i');
 if hit is not null then return hit[2];end if;
 -- URLSearchParams uses &, first matching case-sensitive decoded key, + as
 -- space, and percent-byte decoding. Non-ASCII/NUL cannot form an allowed ID;
 -- substitute ? rather than manufacture a valid ASCII key/value from them.
 foreach pair in array string_to_array(coalesce(parts[5],''),'&') loop
  decoded_key:=null;
  for part_index in 1..2 loop
   component:=case part_index when 1 then split_part(pair,'=',1) else case when strpos(pair,'=')>0 then substring(pair from strpos(pair,'=')+1) else '' end end;
   decoded:='';pos:=1;
   while pos<=length(component) loop
    if substring(component from pos for 1)='%' and substring(component from pos+1 for 2) ~ '^[A-Fa-f0-9]{2}$' then
     octet:=get_byte(decode(substring(component from pos+1 for 2),'hex'),0);decoded:=decoded||case when octet between 1 and 127 then chr(octet) else '?' end;pos:=pos+3;
    else decoded:=decoded||case when substring(component from pos for 1)='+' then ' ' else substring(component from pos for 1) end;pos:=pos+1;end if;
   end loop;
   if part_index=1 then decoded_key:=decoded;elsif decoded_key='id' then if decoded ~ '^[A-Za-z0-9_-]{20,}$' then return decoded;else return null;end if;end if;
  end loop;
 end loop;
 return null;
end;
$fn$;
-- Same trim/client normalization as the pinned helper and completion verifier.
create or replace function public.syncview_thumbnail_revision_v2_enabled(p_client text)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public as $fn$
declare config jsonb; mode text; normalized text;
begin
 select value into config from public.syncview_runtime_flags where key='thumbnail_revision_v2';
 mode:=lower(btrim(coalesce(config->>'mode','')));
 normalized:=regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(normalize(coalesce(p_client,''),NFD))),U&'[\0300-\036f]','','g'),'^dr\.?\s+',''),'\s+(and|&)\s+','&','g'),'[^a-z0-9&]+','','g');
 if mode not in ('on','test') or normalized='' then return false;end if;
 if not exists(select from public.clients where active and regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(normalize(slug,NFD))),U&'[\0300-\036f]','','g'),'^dr\.?\s+',''),'\s+(and|&)\s+','&','g'),'[^a-z0-9&]+','','g')=normalized) then return false;end if;
 if mode='on' then return true;end if;
 if jsonb_typeof(config->'clients') is distinct from 'array' then return false;end if;
 if exists(select from jsonb_array_elements(config->'clients') x where jsonb_typeof(x)<>'string') then raise exception 'followup_config_client_shape';end if;
 return exists(select from jsonb_array_elements_text(config->'clients') x where regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(normalize(x,NFD))),U&'[\0300-\036f]','','g'),'^dr\.?\s+',''),'\s+(and|&)\s+','&','g'),'[^a-z0-9&]+','','g')=normalized);
end $fn$;
commit;
