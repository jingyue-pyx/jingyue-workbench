import { REACT_VITE_TEMPLATE } from '~/lib/runtime/managed/template';
import type { SourceFiles } from '~/lib/runtime/managed/protocol';

/*
 * Local acceptance fixture only. It calls the same helper used by generated apps,
 * with no embedded credentials, mock cloud acknowledgements or auto-seeded writes.
 */
export const DEMO_STORAGE_FIXTURE: SourceFiles = {
  ...REACT_VITE_TEMPLATE,
  'src/App.tsx': `import { useState } from 'react';
import { useDemoData } from './lib/jingyue-data';
type Order = { id: string; item: string; quantity: number };
type Orders = { orders: Order[] };
export default function App() {
  const { data, setData, status, error, ready, retry } = useDemoData<Orders>('orders', { orders: [] });
  const [item, setItem] = useState('');
  const [quantity, setQuantity] = useState(1);
  const blocked = !ready || status === 'conflict';
  const labels = { loading: '正在读取云端数据', ready: '尚无云端数据', saving: '正在保存', saved: '云端已保存', error: '保存或读取失败', conflict: '数据冲突：草稿保留' };
  return <main>
    <small>鲸月 · Supabase 持久化验收</small><h1>采购清单</h1>
    <p>在已登录的工作台内添加一条记录，等显示“云端已保存”后刷新，验证记录能恢复。</p>
    <p role="status">{labels[status]}</p>
    {error && <p role="alert">{error} {status !== 'conflict' && <button onClick={() => void retry()}>重试</button>}</p>}
    <form onSubmit={event => { event.preventDefault(); if (!item.trim() || blocked) return;
      setData(previous => ({ orders: [...previous.orders, { id: crypto.randomUUID(), item: item.trim(), quantity }] }));
      setItem(''); }}>
      <label>采购物品 <input aria-label="采购物品" value={item} onChange={e => setItem(e.target.value)} disabled={blocked} required maxLength={80}/></label>
      <label>数量 <input aria-label="数量" type="number" min={1} max={1000} value={quantity} onChange={e => setQuantity(Math.max(1, Number(e.target.value)))} disabled={blocked}/></label>
      <button disabled={blocked || !item.trim()}>添加采购</button>
    </form>
    <ul>{data.orders.map(order => <li key={order.id}><span>{order.item} × {order.quantity}</span>
      <button disabled={blocked} onClick={() => setData(previous => ({ orders: previous.orders.filter(row => row.id !== order.id) }))}>删除 {order.item}</button></li>)}</ul>
    {!data.orders.length && <p>目前没有采购记录。</p>}
    <footer>仅演示级数据，不放敏感信息；单份数据上限 64KB。未保存时不要直接关闭页面。</footer>
  </main>;
}
`,
  'src/style.css':
    '*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#1c2940;font-family:system-ui,sans-serif}main{max-width:760px;margin:48px auto;padding:32px;background:white;border-radius:16px}h1{font-size:32px}small,footer{color:#65758a}form{display:flex;align-items:end;gap:16px;flex-wrap:wrap;margin:32px 0}label{display:grid;gap:8px}input,button{font:inherit;padding:10px 14px;border:1px solid #cbd5e1;border-radius:8px}button{background:#244e91;color:white;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}li{display:flex;align-items:center;justify-content:space-between;padding:14px;border-bottom:1px solid #e2e8f0}ul{padding:0}footer{margin-top:32px;font-size:13px}[role=alert]{color:#9d350b}',
};
