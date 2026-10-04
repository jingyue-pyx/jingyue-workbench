// Seed a synthetic project in the dedicated local publishing acceptance server.
// No model call, user project, cloud database, or Netlify API is touched here.
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:9035';
const headers = { Origin: origin, 'Content-Type': 'application/json' };
const login = await fetch(`${origin}/api/auth/login`, {
  method: 'POST', headers,
  body: JSON.stringify({ username: 'preview_alice', password: 'Local-test-password-7248' }),
});
if (!login.ok) throw new Error('Local fixture sign-in failed.');
const { user } = await login.json();
headers.Cookie = login.headers.get('set-cookie').split(';')[0];
headers['X-Jingyue-User'] = user.id;
const messageId = randomUUID();
const files = {
  'package.json': JSON.stringify({ name:'jingyue-publishing-fixture', version:'1.0.0', private:true, type:'module', scripts:{dev:'vite --host 0.0.0.0', build:'vite build'}, dependencies:{react:'18.3.1','react-dom':'18.3.1'}, devDependencies:{vite:'5.4.14'} }),
  'index.html':'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鲸月发布验收</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  'src/main.jsx':`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import './style.css';function App(){const[n,setN]=useState(0);return <main><small>JINGYUE · 发布链路验收</small><h1>网页已就绪</h1><p>这是独立的合成测试项目，不包含个人数据。</p><button onClick={()=>setN(n+1)}>交互计数：{n}</button><p><a href="/details">测试子路由刷新</a></p><p>当前路径：{location.pathname}</p><img src="/check.png" width="24" height="24" alt="二进制图片测试"/></main>}createRoot(document.getElementById('root')).render(<App/>);`,
  'src/style.css':'body{margin:0;background:#eef2f8;color:#142239;font-family:system-ui,sans-serif}main{max-width:700px;margin:10vh auto;padding:48px;background:white;border-radius:24px}small{color:#53657e;letter-spacing:.12em}h1{font-size:42px}p{line-height:1.8}button{padding:12px 20px;background:#214fe0;color:white;border:0;border-radius:10px;font:inherit;cursor:pointer}a{color:#214fe0}',
};
const snapshot = Object.fromEntries(Object.entries(files).map(([name,content])=>[name,{type:'file',content,isBinary:false}]));
snapshot['public/check.png']={type:'file',isBinary:true,content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII='};
const projectId = randomUUID();
const response = await fetch(`${origin}/api/projects`, {method:'POST',headers,body:JSON.stringify({
  projectId,requestId:randomUUID(),document:{schemaVersion:1,title:'Netlify 静态发布验收',messages:[{id:messageId,role:'assistant',content:'此项目专门验证静态构建、发布、图片和子路由；不会调用模型。'}],snapshot:{chatIndex:messageId,files:snapshot}},
})});
if (!response.ok) throw new Error(`Local fixture creation failed (${response.status}).`);
console.log(JSON.stringify({projectUrl:`${origin}/chat/${projectId}`, created:true}));
