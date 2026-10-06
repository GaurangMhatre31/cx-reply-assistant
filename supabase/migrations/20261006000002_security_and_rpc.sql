-- =============================================================================
-- Tenant isolation (RLS), triggers and RPCs
--
-- Rule of thumb used throughout:
--   * READS go straight to tables and are filtered by RLS on brand membership.
--   * WRITES that touch conversations go through RPCs, which derive brand_id
--     from the parent row on the server (never trusting a client-sent brand)
--     and re-check membership explicitly.
--   * Knowledge-base CRUD is direct table access, guarded by an 'admin' role
--     check in RLS.
-- =============================================================================

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so policies can consult agent_brands
-- without recursing through agent_brands' own RLS.
-- ---------------------------------------------------------------------------
create or replace function private.has_brand_access(p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_brands ab
    where ab.agent_id = (select auth.uid())
      and ab.brand_id = p_brand_id
  );
$$;

create or replace function private.is_brand_admin(p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_brands ab
    where ab.agent_id = (select auth.uid())
      and ab.brand_id = p_brand_id
      and ab.role = 'admin'
  );
$$;

create or replace function private.shares_brand_with(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_brands mine
    join public.agent_brands theirs on theirs.brand_id = mine.brand_id
    where mine.agent_id = (select auth.uid())
      and theirs.agent_id = p_agent_id
  );
$$;

revoke all on function private.has_brand_access(uuid) from public;
revoke all on function private.is_brand_admin(uuid) from public;
revoke all on function private.shares_brand_with(uuid) from public;
grant execute on function private.has_brand_access(uuid) to authenticated, service_role;
grant execute on function private.is_brand_admin(uuid) to authenticated, service_role;
grant execute on function private.shares_brand_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.brands         enable row level security;
alter table public.agents         enable row level security;
alter table public.agent_brands   enable row level security;
alter table public.customers      enable row level security;
alter table public.orders         enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.kb_entries     enable row level security;
alter table public.ai_generations enable row level security;

create policy brands_select on public.brands
  for select to authenticated using (private.has_brand_access(id));

create policy agents_select on public.agents
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_brand_with(id));

create policy agent_brands_select on public.agent_brands
  for select to authenticated using (agent_id = (select auth.uid()));

create policy customers_select on public.customers
  for select to authenticated using (private.has_brand_access(brand_id));

create policy orders_select on public.orders
  for select to authenticated using (private.has_brand_access(brand_id));

create policy conversations_select on public.conversations
  for select to authenticated using (private.has_brand_access(brand_id));

create policy messages_select on public.messages
  for select to authenticated using (private.has_brand_access(brand_id));

create policy ai_generations_select on public.ai_generations
  for select to authenticated using (private.has_brand_access(brand_id));

-- Knowledge base: everyone on the brand can read; only brand admins can write.
-- WITH CHECK on update stops an admin of A and B from moving an entry across.
create policy kb_entries_select on public.kb_entries
  for select to authenticated using (private.has_brand_access(brand_id));

create policy kb_entries_insert on public.kb_entries
  for insert to authenticated with check (private.is_brand_admin(brand_id));

create policy kb_entries_update on public.kb_entries
  for update to authenticated
  using (private.is_brand_admin(brand_id))
  with check (private.is_brand_admin(brand_id));

create policy kb_entries_delete on public.kb_entries
  for delete to authenticated using (private.is_brand_admin(brand_id));

-- Supabase grants table privileges to `authenticated` by default; make the
-- intent explicit and keep `anon` out entirely.
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.kb_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function private.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(new.body, 140),
         last_message_sender  = new.sender_type,
         -- customer wrote -> needs attention; agent replied -> waiting on customer
         status = case new.sender_type
                    when 'customer' then 'open'
                    when 'agent' then 'pending'
                    else status
                  end
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function private.touch_conversation();

create or replace function private.kb_entries_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

create trigger kb_entries_stamp
  before insert or update on public.kb_entries
  for each row execute function private.kb_entries_stamp();

-- ---------------------------------------------------------------------------
-- RPC: knowledge retrieval
--
-- Lexical retrieval with Postgres full-text search, scoped to ONE brand.
--
--  1. The customer's message is turned into an OR-query over its stemmed
--     terms (an AND-query almost never matches a long, chatty message), minus
--     generic CX words ("order", "delivered", "product"...) that appear in
--     nearly every policy and would otherwise act as noise (a poor man's IDF).
--  2. Matches in title/keywords (weight A) count 5x more than matches in the
--     body (weight B); body-only matches are mostly incidental.
--  3. +0.3 when the entry's category matches an intent detected upstream —
--     this is the synonym bridge ("money back" -> refunds) that pure keyword
--     search lacks.
--  4. Hits must clear an absolute floor AND be within 40% of the best hit, so
--     "nothing relevant" is a real, observable outcome rather than the three
--     least-bad entries.
--
-- SECURITY INVOKER: RLS still applies, so the brand filter is enforced twice.
-- ---------------------------------------------------------------------------
create or replace function public.search_kb(
  p_brand_id   uuid,
  p_query      text,
  p_categories text[] default '{}',
  p_limit      integer default 3,
  p_min_score  real default 0.15
)
returns table (id uuid, category text, title text, content text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with generic as (
    select tsvector_to_array(to_tsvector('english',
      'order orders ordered product products item items deliver delivered delivery receive received
       get got day days week please hi hello hey thanks thank want need help can could would know tell'
    )) as lexemes
  ),
  terms as (
    select string_agg(quote_literal(lexeme), ' | ') as query_text
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) as lexeme,
         generic g
    where lexeme <> all (g.lexemes)
  ),
  scored as (
    select
      e.id,
      e.category,
      e.title,
      e.content,
      (
        coalesce(
          case when t.query_text is not null
               then ts_rank('{0, 0, 0.2, 1}', e.search, t.query_text::tsquery, 0)
          end,
          0
        )
        + case when e.category = any (coalesce(p_categories, '{}')) then 0.3 else 0 end
      )::real as score
    from public.kb_entries e
    cross join terms t
    where e.brand_id = p_brand_id
      and e.is_active
  ),
  ranked as (
    select s.*, max(s.score) over () as best
    from scored s
  )
  select r.id, r.category, r.title, r.content, r.score
  from ranked r
  where r.score >= p_min_score
    and r.score >= 0.4 * r.best
  order by r.score desc, r.title
  limit least(greatest(coalesce(p_limit, 3), 1), 10);
$$;

-- ---------------------------------------------------------------------------
-- RPC: post a message as the customer (testing simulator).
-- In production customer messages arrive via channel webhooks instead.
-- ---------------------------------------------------------------------------
create or replace function public.simulate_customer_message(p_conversation_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_message  public.messages;
begin
  select c.brand_id into v_brand_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_brand_id is null or not private.has_brand_access(v_brand_id) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  insert into public.messages (brand_id, conversation_id, sender_type, body)
  values (v_brand_id, p_conversation_id, 'customer', btrim(p_body))
  returning * into v_message;

  return v_message;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: agent sends a manual message (no AI involved).
-- ---------------------------------------------------------------------------
create or replace function public.send_agent_message(p_conversation_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_message  public.messages;
begin
  select c.brand_id into v_brand_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_brand_id is null or not private.has_brand_access(v_brand_id) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  insert into public.messages (brand_id, conversation_id, sender_type, sender_agent_id, body)
  values (v_brand_id, p_conversation_id, 'agent', (select auth.uid()), btrim(p_body))
  returning * into v_message;

  return v_message;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: approve an AI draft (optionally edited) and send it.
-- Atomic: the message insert and the log update commit together. The row lock
-- plus the 'pending' check make it idempotent — a double click or a retried
-- request can never send the same draft twice.
-- ---------------------------------------------------------------------------
create or replace function public.approve_ai_generation(p_generation_id uuid, p_final_text text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gen     public.ai_generations;
  v_final   text := btrim(coalesce(p_final_text, ''));
  v_edited  boolean;
  v_message public.messages;
begin
  select * into v_gen
  from public.ai_generations g
  where g.id = p_generation_id
  for update;

  if v_gen.id is null or not private.has_brand_access(v_gen.brand_id) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;

  if v_gen.outcome <> 'pending' then
    raise exception 'This draft was already %', v_gen.outcome using errcode = 'P0001';
  end if;

  if v_final = '' then
    raise exception 'Reply cannot be empty' using errcode = '22023';
  end if;

  v_edited := v_final is distinct from btrim(coalesce(v_gen.ai_response, ''));

  insert into public.messages (brand_id, conversation_id, sender_type, sender_agent_id, body, ai_generation_id)
  values (v_gen.brand_id, v_gen.conversation_id, 'agent', (select auth.uid()), v_final, v_gen.id)
  returning * into v_message;

  update public.ai_generations
     set agent_edited_response = case when v_edited then v_final end,
         final_response        = v_final,
         outcome               = case when v_edited then 'approved_with_edits' else 'approved' end,
         final_message_id      = v_message.id,
         decided_at            = now(),
         decided_by            = (select auth.uid())
   where id = v_gen.id;

  return v_message;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: discard an AI draft (keeps the agent's edits, if any, for analysis).
-- ---------------------------------------------------------------------------
create or replace function public.discard_ai_generation(p_generation_id uuid, p_edited_text text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gen public.ai_generations;
begin
  select * into v_gen
  from public.ai_generations g
  where g.id = p_generation_id
  for update;

  if v_gen.id is null or not private.has_brand_access(v_gen.brand_id) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;

  if v_gen.outcome <> 'pending' then
    return; -- already decided; discarding again is a no-op
  end if;

  update public.ai_generations
     set outcome               = 'discarded',
         agent_edited_response = case
                                   when btrim(coalesce(p_edited_text, '')) not in ('', btrim(coalesce(v_gen.ai_response, '')))
                                   then btrim(p_edited_text)
                                 end,
         decided_at            = now(),
         decided_by            = (select auth.uid())
   where id = v_gen.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: open a fresh conversation for an existing order, so a reviewer can
-- test the reply loop from a clean slate without disturbing seeded threads.
-- ---------------------------------------------------------------------------
create or replace function public.start_test_conversation(p_order_id uuid, p_channel text default 'whatsapp')
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order        public.orders;
  v_conversation public.conversations;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order.id is null or not private.has_brand_access(v_order.brand_id) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  insert into public.conversations (brand_id, customer_id, order_id, channel)
  values (v_order.brand_id, v_order.customer_id, v_order.id, coalesce(p_channel, 'whatsapp'))
  returning * into v_conversation;

  return v_conversation;
end;
$$;

revoke all on function public.start_test_conversation(uuid, text) from public, anon;
grant execute on function public.start_test_conversation(uuid, text) to authenticated;

revoke all on function public.search_kb(uuid, text, text[], integer, real) from public, anon;
revoke all on function public.simulate_customer_message(uuid, text) from public, anon;
revoke all on function public.send_agent_message(uuid, text) from public, anon;
revoke all on function public.approve_ai_generation(uuid, text) from public, anon;
revoke all on function public.discard_ai_generation(uuid, text) from public, anon;

grant execute on function public.search_kb(uuid, text, text[], integer, real) to authenticated, service_role;
grant execute on function public.simulate_customer_message(uuid, text) to authenticated;
grant execute on function public.send_agent_message(uuid, text) to authenticated;
grant execute on function public.approve_ai_generation(uuid, text) to authenticated;
grant execute on function public.discard_ai_generation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: stream new messages / drafts / conversation updates to the UI.
-- Supabase Realtime applies the same RLS policies to these change events.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.conversations, public.ai_generations;
  end if;
end;
$$;
