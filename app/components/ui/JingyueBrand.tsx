/** The product wordmark is independent of the legacy runtime protocol names. */
export function JingyueBrand() {
  return (
    <a href="/" aria-label="鲸月 · 返回首页" className="inline-flex items-center gap-2 text-bolt-elements-textPrimary">
      <span className="i-ph:moon-stars-duotone w-7 h-7 text-accent" aria-hidden="true" />
      <span className="flex flex-col leading-none">
        <span className="text-xl font-bold tracking-wide">鲸月</span>
        <span className="text-[8px] tracking-[0.2em] text-bolt-elements-textSecondary mt-1" aria-hidden="true">
          JINGYUE
        </span>
      </span>
    </a>
  );
}
