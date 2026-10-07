update public.app_settings
set mfa_required=true,
    updated_at=now(),
    updated_by=null
where id=1;
