import type { Message } from 'ai';

/*
 * A real runnable React fixture, imported via Bolt's normal file/action pipeline.
 * It is intentionally labeled as a fixture, not as a model-generated result.
 */
export function visualDemoMessages(): Message[] {
  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      {
        name: 'jingyue-editable-demo',
        private: true,
        type: 'module',
        scripts: { dev: 'vite --host 0.0.0.0' },
        dependencies: { react: '18.3.1', 'react-dom': '18.3.1', vite: '5.4.21' },
      },
      null,
      2,
    ),
    'index.html':
      '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>鲸月 · 可编辑示例</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    'src/main.jsx': `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [reserved, setReserved] = useState(false);
  return <main>
    <nav><strong>山间 / BETWEEN</strong><a href="#story">我们的故事 ↗</a></nav>
    <section className="hero">
      <div className="copy"><p className="eyebrow">SLOW DAYS, GOOD COFFEE</p>
        <h1>把今天，留给山野。</h1>
        <p>一杯手冲，一扇看山的窗。来这里，找回属于自己的节奏。</p>
        <button onClick={() => setReserved(!reserved)}>{reserved ? '已预约 · 再点取消' : '预约周末咖啡'}</button>
        <p className="note">可运行 React 示例 · 不是 AI 生成结果</p>
      </div>
      <img className="hero-image" src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=85" alt="阳光穿过山间森林" />
    </section>
    <section id="story"><p className="eyebrow">A LITTLE SPACE TO BREATHE</p><h2>不赶时间，刚好遇见。</h2><p>点击上方「直接编辑」，再点这个标题改字；也可以打开源码，或配置百炼后通过对话继续修改。</p></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);`,
    'src/style.css': `*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#263d2e;font-family:system-ui,sans-serif}main{max-width:1400px;margin:auto}nav{display:flex;justify-content:space-between;align-items:center;padding:28px 6%;border-bottom:1px solid #d6d8cc}nav a{color:inherit;text-decoration:none;font-size:14px}.hero{display:grid;grid-template-columns:1fr 1fr;min-height:540px}.copy{padding:80px 12%}.eyebrow{font-size:11px;letter-spacing:3px;color:#697e61}h1{font-size:clamp(36px,5vw,68px);line-height:1.12;letter-spacing:-2px;margin:28px 0}p{line-height:1.9}button{background:#2f4935;color:#fff;border:0;border-radius:24px;padding:15px 26px;cursor:pointer;margin-top:20px}button:hover{background:#506c47}.hero-image{width:100%;height:100%;min-height:540px;object-fit:cover}.note{font-size:11px;color:#74826c;margin-top:25px}#story{padding:60px 6%;max-width:900px}h2{font-size:34px}@media(max-width:700px){.hero{grid-template-columns:1fr}.copy{padding:50px 8%}.hero-image{height:340px;min-height:0}nav{padding:20px 8%}}`,
  };
  const artifact = Object.entries(files)
    .map(([file, content]) => `<boltAction type="file" filePath="${file}">\n${content}\n</boltAction>`)
    .join('\n');

  return [
    { id: 'visual-demo-user', role: 'user', content: '导入可视编辑测试项目（无需模型密钥，不是 AI 生成）。' },
    {
      id: 'visual-demo-files',
      role: 'assistant',
      content: `这是预置的 React 测试项目。安装依赖后，可以在预览中试用直接编辑、查看源码；配置百炼后可继续对话修改。\n<boltArtifact id="visual-demo" title="可运行的 React 编辑示例">\n${artifact}\n<boltAction type="shell">npm install</boltAction>\n<boltAction type="start">npm run dev</boltAction>\n</boltArtifact>`,
    },
  ];
}
