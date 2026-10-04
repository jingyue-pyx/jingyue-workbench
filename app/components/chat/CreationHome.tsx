import { useState } from 'react';
import type { Template } from '~/types/template';
import { classNames } from '~/utils/classNames';
import styles from './CreationHome.module.scss';

export const CREATION_EXAMPLES = [
  {
    id: 'marketing',
    title: '营销 Agent 工作台',
    description: '从活动目标到内容方案，让营销流程一目了然。',
    category: '营销增长',
    icon: 'i-ph:megaphone-simple',
    prompt:
      '帮我创建一个有设计感的营销 Agent 工作台，包含活动目标、受众和预算表单，以及营销方案展示区。用明确标注的示例数据演示，让按钮和表单可以实际操作，界面简洁、图标尺寸统一。',
  },
  {
    id: 'supply-chain',
    title: '供应链管理',
    description: '采购、库存和供应商，放进一个清晰的管理页面。',
    category: '管理工具',
    icon: 'i-ph:package',
    prompt:
      '帮我创建一个供应链管理前端页面，包含采购单、库存列表、供应商筛选和新增采购表单。使用明确标注的模拟数据，支持搜索、筛选和表单交互，不要假装已连接真实业务后端。',
  },
  {
    id: 'store',
    title: '品牌商品目录',
    description: '用商品展示与购物清单，讲好一个品牌的故事。',
    category: '营销增长',
    icon: 'i-ph:shopping-bag-open',
    prompt:
      '帮我创建一个精致的品牌商品目录页面，包含商品分类、详情和购物清单，支持添加商品、修改数量和金额汇总。使用示例商品数据，不接真实支付，保持响应式布局和完整样式。',
  },
  {
    id: 'portfolio',
    title: '个人作品集',
    description: '让项目、经历和风格都有自己的位置。',
    category: '创意展示',
    icon: 'i-ph:briefcase',
    prompt:
      '帮我创建一个简洁但有辨识度的个人作品集网站，包含个人介绍、作品筛选、项目详情和联系入口。内容先使用明确标注的占位信息，不编造奖项或客户，所有导航和按钮都应有合理的交互。',
  },
] as const;

const CATEGORIES = ['全部', '营销增长', '管理工具', '创意展示'] as const;

/** Selecting inspiration is not permission to send a model request or replace an existing draft. */
export function appendCreationExample(currentInput: string, prompt: string): string {
  if (!currentInput.trim()) {
    return prompt;
  }

  if (currentInput.includes(prompt)) {
    return currentInput;
  }

  return `${currentInput}\n\n参考方向：${prompt}`;
}

export function CreationHomeIntro() {
  return (
    <div id="intro" className={styles.Intro}>
      <h1>把想法，变成可以打开的页面</h1>
      <p>描述你的需求，或从一个灵感开始。边聊边改，看见想法成形。</p>
    </div>
  );
}

export function CreationHomeLibrary({
  onSelectPrompt,
  templates,
  disabled = false,
}: {
  onSelectPrompt: (prompt: string) => void;
  templates: Template[];
  disabled?: boolean;
}) {
  const [section, setSection] = useState<'examples' | 'templates'>('examples');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('全部');
  const [selectedTitle, setSelectedTitle] = useState('');
  const examples = CREATION_EXAMPLES.filter((example) => category === '全部' || example.category === category);

  return (
    <section id="examples" className={styles.Library} aria-label="创作灵感与代码模板">
      <div className={styles.LibraryHeading}>
        <div className={styles.SectionSwitch} role="group" aria-label="浏览内容">
          <button type="button" aria-pressed={section === 'examples'} onClick={() => setSection('examples')}>
            精选灵感
          </button>
          <button type="button" aria-pressed={section === 'templates'} onClick={() => setSection('templates')}>
            代码模板
          </button>
        </div>
        <p>
          {section === 'examples'
            ? '先选一个方向，再写下你的独特需求。'
            : '从已有开源工程开始；不同模板的运行兼容性需单独确认。'}
        </p>
      </div>
      {section === 'examples' ? (
        <>
          <div className={styles.Categories} role="group" aria-label="灵感分类">
            {CATEGORIES.map((item) => (
              <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className={styles.ExampleGrid}>
            {examples.map((example) => (
              <button
                key={example.id}
                type="button"
                className={styles.ExampleCard}
                disabled={disabled}
                aria-label={`使用${example.title}示例需求`}
                onClick={() => {
                  onSelectPrompt(example.prompt);
                  setSelectedTitle(example.title);
                }}
              >
                <span className={styles.CardVisual} aria-hidden="true">
                  <span className={classNames(example.icon, styles.CardIcon)} />
                  <span className={styles.CardCategory}>{example.category}</span>
                </span>
                <span className={styles.CardContent}>
                  <strong>{example.title}</strong>
                  <span>{example.description}</span>
                  <span className={styles.CardAction}>
                    填入示例需求 <span className="i-ph:arrow-up-right" aria-hidden="true" />
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className={styles.SelectionStatus} role="status" aria-live="polite">
            {selectedTitle
              ? `“${selectedTitle}”已加入输入框。可以继续修改，点击发送后才开始生成。`
              : '这些是需求示例，不是已生成的作品。选择不会自动开始生成。'}
          </p>
        </>
      ) : (
        <div className={styles.TemplateGrid}>
          {templates.map((template) => (
            <a
              key={template.name}
              className={styles.TemplateCard}
              href={`/git?url=https://github.com/${template.githubRepo}.git`}
            >
              <span className={classNames(template.icon, styles.TemplateIcon)} aria-hidden="true" />
              <span>
                <strong>{template.label}</strong>
                <span>{template.tags?.slice(0, 3).join(' / ') || '开源代码模板'}</span>
              </span>
              <span className="i-ph:arrow-up-right" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
