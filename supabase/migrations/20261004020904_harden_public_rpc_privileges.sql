alter function public.create_uti_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) security invoker;
alter function public.add_uti_payment(uuid,timestamptz,numeric,text,text) security invoker;
alter function public.add_uti_extra(uuid,timestamptz,text,text,numeric) security invoker;
alter function public.adjust_uti_rate(uuid,timestamptz,numeric,boolean) security invoker;
alter function public.discharge_uti(uuid,timestamptz) security invoker;
alter function public.update_uti_on_duty(text) security invoker;
alter function public.admin_update_uti_member(uuid,boolean,text) security invoker;
alter function public.sync_uti_charges(uuid,timestamptz) security invoker;

revoke execute on function public.create_uti_admission(text,text,integer,text,timestamptz,text,boolean,boolean,numeric,text) from anon;
revoke execute on function public.add_uti_payment(uuid,timestamptz,numeric,text,text) from anon;
revoke execute on function public.add_uti_extra(uuid,timestamptz,text,text,numeric) from anon;
revoke execute on function public.adjust_uti_rate(uuid,timestamptz,numeric,boolean) from anon;
revoke execute on function public.discharge_uti(uuid,timestamptz) from anon;
revoke execute on function public.update_uti_on_duty(text) from anon;
revoke execute on function public.admin_update_uti_member(uuid,boolean,text) from anon;
revoke execute on function public.sync_uti_charges(uuid,timestamptz) from anon;
