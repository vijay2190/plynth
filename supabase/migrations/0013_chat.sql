-- 0013_chat.sql — AI chat conversations + messages with per-user RLS.

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_conversations_user_updated_idx
  on public.chat_conversations(user_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool','system')),
  content text not null default '',
  tool_name text,
  tool_input jsonb,
  tool_output jsonb,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conv_created_idx
  on public.chat_messages(conversation_id, created_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages      enable row level security;

do $$ declare t text; begin
  for t in select unnest(array['chat_conversations','chat_messages']) loop
    execute format($f$
      drop policy if exists "own rows %1$s" on public.%1$I;
      create policy "own rows %1$s" on public.%1$I
        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;
