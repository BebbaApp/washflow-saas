import { createClient } from '@supabase/supabase-js';
const url = process.env.VITE_SUPABASE_URL || 'https://kldcnrnkyurwcbxvnhku.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.log('no service key'); process.exit(0); }
const s = createClient(url, key);
const tid = 'aaf59915-e570-4e04-b85a-00df856f02b8';
const uid = '59c6fe6a-0a0a-4dca-8796-4caa3813eafc';
const { data: mem } = await s.from('tenant_members').select('*').eq('tenant_id', tid).eq('user_id', uid);
console.log('members:', mem);
const { data: ord, count } = await s.from('orders').select('id,order_number,tenant_id,status,created_at', { count: 'exact' }).eq('tenant_id', tid).order('created_at', { ascending: false }).limit(10);
console.log('orders count:', count, ord);
