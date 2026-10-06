-- =============================================================================
-- CX Reply Assistant — core schema
--
-- Tenancy model: every business table carries brand_id. Child rows reference
-- their parent through a COMPOSITE foreign key (parent_id, brand_id), so the
-- database itself makes it impossible for, say, a Brand B message to be
-- attached to a Brand A conversation — even if application code has a bug.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Brands (tenants)
-- ---------------------------------------------------------------------------
create table public.brands (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name          text not null,
  -- Voice/tone guidance injected into the system prompt for this brand.
  tone          text not null default 'Friendly, concise and professional.',
  support_email text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Agents and their brand memberships
-- ---------------------------------------------------------------------------
create table public.agents (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

create table public.agent_brands (
  agent_id   uuid not null references public.agents (id) on delete cascade,
  brand_id   uuid not null references public.brands (id) on delete cascade,
  -- 'admin' may manage the brand's knowledge base; 'agent' may only use it.
  role       text not null default 'agent' check (role in ('agent', 'admin')),
  created_at timestamptz not null default now(),
  primary key (agent_id, brand_id)
);

-- ---------------------------------------------------------------------------
-- Customers & orders (mock commerce data; in production synced from the
-- brand's store via webhooks)
-- ---------------------------------------------------------------------------
create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands (id) on delete cascade,
  name       text not null,
  phone      text,
  email      text,
  created_at timestamptz not null default now(),
  unique (id, brand_id)
);

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands (id) on delete cascade,
  customer_id  uuid not null,
  order_number text not null,
  -- [{ "name": "...", "qty": 1, "price": 499 }]
  items        jsonb not null default '[]'::jsonb,
  total_amount numeric(10, 2) not null default 0,
  currency     text not null default 'INR',
  status       text not null default 'placed'
               check (status in ('placed', 'dispatched', 'delivered', 'cancelled', 'returned')),
  placed_at    timestamptz not null default now(),
  delivered_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (brand_id, order_number),
  unique (id, brand_id),
  constraint orders_customer_fk
    foreign key (customer_id, brand_id) references public.customers (id, brand_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Conversations & messages
-- ---------------------------------------------------------------------------
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands (id) on delete cascade,
  customer_id     uuid not null,
  order_id        uuid,
  channel         text not null default 'whatsapp' check (channel in ('whatsapp', 'email', 'web')),
  status          text not null default 'open' check (status in ('open', 'pending', 'resolved')),
  -- Denormalised by trigger so the inbox needs no per-row "latest message" query.
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  last_message_sender  text,
  created_at      timestamptz not null default now(),
  unique (id, brand_id),
  constraint conversations_customer_fk
    foreign key (customer_id, brand_id) references public.customers (id, brand_id) on delete cascade,
  constraint conversations_order_fk
    foreign key (order_id, brand_id) references public.orders (id, brand_id) on delete set null (order_id)
);

create index conversations_brand_last_msg_idx on public.conversations (brand_id, last_message_at desc);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null,
  conversation_id  uuid not null,
  sender_type      text not null check (sender_type in ('customer', 'agent', 'system')),
  sender_agent_id  uuid references public.agents (id) on delete set null,
  body             text not null check (char_length(btrim(body)) between 1 and 4000),
  -- Set when the message is an approved AI draft (links back to the log row).
  ai_generation_id uuid,
  created_at       timestamptz not null default now(),
  unique (id, brand_id),
  constraint messages_conversation_fk
    foreign key (conversation_id, brand_id) references public.conversations (id, brand_id) on delete cascade
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------------
create table public.kb_entries (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands (id) on delete cascade,
  category   text not null
             check (category in ('returns', 'refunds', 'shipping', 'cancellation', 'damaged_items', 'general')),
  title      text not null check (char_length(btrim(title)) between 1 and 200),
  content    text not null check (char_length(btrim(content)) between 1 and 5000),
  -- Free-text aliases that customers might use ("broken, cracked, leaking").
  -- Lets a KB admin fix a retrieval miss from the UI, without a code change.
  keywords   text not null default '',
  is_active  boolean not null default true,
  search     tsvector generated always as (
               setweight(to_tsvector('english', title), 'A') ||
               setweight(to_tsvector('english', keywords), 'A') ||
               setweight(to_tsvector('english', content), 'B')
             ) stored,
  updated_by uuid references public.agents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kb_entries_brand_idx on public.kb_entries (brand_id) where is_active;
create index kb_entries_search_idx on public.kb_entries using gin (search);

-- ---------------------------------------------------------------------------
-- AI generation log — one row per "Generate Reply" / "Regenerate" click.
-- This is the audit trail: what the customer said, what knowledge was
-- retrieved (snapshotted, because KB entries can later be edited or deleted),
-- what the model drafted, what the agent changed, and what was finally sent.
-- ---------------------------------------------------------------------------
create table public.ai_generations (
  id                    uuid primary key default gen_random_uuid(),
  brand_id              uuid not null,
  conversation_id       uuid not null,
  customer_message_id   uuid,
  customer_message      text not null,
  -- [{ id, label, title, category, content, score }]
  retrieved_context     jsonb not null default '[]'::jsonb,
  -- Facts computed in code and handed to the model (days since delivery, ...)
  order_facts           jsonb,
  model                 text,
  prompt_version        text not null,
  ai_response           text,
  grounding_status      text not null
                        check (grounding_status in ('grounded', 'needs_review', 'no_knowledge', 'error')),
  confidence            numeric(3, 2),
  cited_entry_ids       uuid[] not null default '{}',
  missing_info          text,
  guardrail_flags       text[] not null default '{}',
  agent_edited_response text,
  final_response        text,
  outcome               text not null default 'pending'
                        check (outcome in ('pending', 'approved', 'approved_with_edits', 'discarded', 'superseded', 'failed')),
  final_message_id      uuid,
  prompt_tokens         integer,
  completion_tokens     integer,
  cost_usd              numeric(12, 6),
  latency_ms            integer,
  error                 text,
  created_by            uuid references public.agents (id) on delete set null,
  created_at            timestamptz not null default now(),
  decided_at            timestamptz,
  decided_by            uuid references public.agents (id) on delete set null,
  constraint ai_generations_conversation_fk
    foreign key (conversation_id, brand_id) references public.conversations (id, brand_id) on delete cascade,
  constraint ai_generations_customer_message_fk
    foreign key (customer_message_id, brand_id) references public.messages (id, brand_id) on delete set null (customer_message_id),
  constraint ai_generations_final_message_fk
    foreign key (final_message_id, brand_id) references public.messages (id, brand_id) on delete set null (final_message_id)
);

create index ai_generations_conversation_idx on public.ai_generations (conversation_id, created_at desc);
create index ai_generations_brand_created_idx on public.ai_generations (brand_id, created_at desc);

-- At most one draft awaiting a decision per conversation.
create unique index ai_generations_one_pending_idx
  on public.ai_generations (conversation_id) where outcome = 'pending';

alter table public.messages
  add constraint messages_ai_generation_fk
  foreign key (ai_generation_id) references public.ai_generations (id) on delete set null;
