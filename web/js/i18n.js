// English / Chinese UI. English is the markup as written; Chinese is applied over it when the page is opened with ?lang=cn.
export const lang = /[?&]lang=cn\b/.test(location.search) ? 'cn' : 'en';
export const L = (en, cn) => lang === 'cn' ? cn : en;

const CN = {
  title: '火星城市探索器 | InterImm',
  lede: '一座可以探索的火星城市。',
  li1: '<b>环绕</b>：从高处俯瞰整座城市。',
  li2: '<b>漫步</b>：以火星重力（3.71 m/s²）在街道上行走。',
  fine: '模型来自 <a href="https://github.com/InterImm/martian-cities">InterImm/martian-cities</a>。这里的地形是<b>示意性</b>的，还不是真实高程数据。除非城市另有说明，模型单位按米处理。',
  tagline: '一座可探索的火星城市',
  orbit: '环绕', walk: '漫步',
  live: '实时火星时间', hour: '火星时', season: '季节 (Ls)',
  hint: '拖动环顾 · 捏合缩放 · 双指移动', jump: '跳',
  tabSun: '太阳', tabAbout: '关于',
};

if (lang === 'cn') {
  document.documentElement.lang = 'zh-CN';
  document.title = CN.title;
  for (const el of document.querySelectorAll('[data-i18n]')) { const v = CN[el.dataset.i18n]; if (v != null) el.innerHTML = v; }
  document.getElementById('btn-info')?.setAttribute('aria-label', '关于这座城市');
  document.getElementById('jump')?.setAttribute('aria-label', '跳');
}

// The kit's language link goes to the other language's home page; send it to this explorer in that language instead.
export function fixLangLinks() {
  for (const a of document.querySelectorAll('a.lang-link')) {
    const zh = (a.getAttribute('hreflang') || '').toLowerCase().startsWith('zh') || a.textContent.includes('中文');
    const u = new URL(location.href);
    if (zh) u.searchParams.set('lang', 'cn'); else u.searchParams.delete('lang');
    a.href = u.href;
  }
}
const header = document.querySelector('[data-interimm-header]');
if (header) new MutationObserver(fixLangLinks).observe(header, { childList: true, subtree: true });
fixLangLinks();
addEventListener('hashchange', fixLangLinks);
