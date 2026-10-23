-- Combine recruiter verification and the search lookup; candidate reads stay server-only.
create function public.read_search(p_search uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case when public.current_company_id() is null
    then jsonb_build_object('error', 'unauthorized')
    else (select jsonb_build_object('filters', s.filters)
          from public.searches s where s.id = p_search and s.status = 'ready')
  end
$$;

-- The invoker's existing RLS policy limits the lookup to their own company.
revoke all on function public.read_search(uuid) from public, anon;
grant execute on function public.read_search(uuid) to authenticated;
