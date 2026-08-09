-- ============================================================
-- 成长工作台 · 云端同步数据库 Schema
-- 使用 Supabase SQL Editor（Dashboard → SQL Editor → New query）整体执行
-- 执行前请确认项目尚未用于本应用的其他用途；本脚本可重复执行（幂等）
-- ============================================================

-- 1. 同步数据表：每个用户一个账号，按数据键（key）存储，每键一行
--    key 对应应用内的 wb_growth_* 存储键（tasks/habits/habitRecords/...）
--    value 存整份 JSON（结构与 localStorage 中完全一致，保证数据结构不变）
create table if not exists public.sync_items (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    key         text not null,
    value       jsonb not null,
    updated_at  timestamptz not null default now(),
    created_at  timestamptz not null default now(),
    unique (user_id, key)
);

create index if not exists sync_items_user_idx on public.sync_items (user_id);

-- 2. 开启行级安全（RLS）：用户只能读写自己的数据
alter table public.sync_items enable row level security;

drop policy if exists "sync_items_select_own" on public.sync_items;
create policy "sync_items_select_own"
    on public.sync_items
    for select
    using (auth.uid() = user_id);

drop policy if exists "sync_items_insert_own" on public.sync_items;
create policy "sync_items_insert_own"
    on public.sync_items
    for insert
    with check (auth.uid() = user_id);

drop policy if exists "sync_items_update_own" on public.sync_items;
create policy "sync_items_update_own"
    on public.sync_items
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "sync_items_delete_own" on public.sync_items;
create policy "sync_items_delete_own"
    on public.sync_items
    for delete
    using (auth.uid() = user_id);

-- 3. 打开 Realtime（用于跨设备实时同步）
--    说明：若执行报错提示 publication 不存在，可忽略；需在 Dashboard → Database → Replication
--    中将 sync_items 表的 Realtime 打开（或直接执行下面这句）
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.sync_items;
    end if;
exception
    when others then null;
end $$;

-- 4. 备份表：云端导出备份快照（可选，供"云端备份/还原"使用）
create table if not exists public.sync_backups (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    label       text not null default '',
    payload     jsonb not null,
    created_at  timestamptz not null default now()
);

alter table public.sync_backups enable row level security;

drop policy if exists "sync_backups_select_own" on public.sync_backups;
create policy "sync_backups_select_own"
    on public.sync_backups
    for select
    using (auth.uid() = user_id);

drop policy if exists "sync_backups_insert_own" on public.sync_backups;
create policy "sync_backups_insert_own"
    on public.sync_backups
    for insert
    with check (auth.uid() = user_id);

drop policy if exists "sync_backups_delete_own" on public.sync_backups;
create policy "sync_backups_delete_own"
    on public.sync_backups
    for delete
    using (auth.uid() = user_id);
