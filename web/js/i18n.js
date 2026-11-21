// English / Chinese UI. English is the markup as written; Chinese is applied over it when the page is opened with ?lang=cn.
export const lang = /[?&]lang=cn\b/.test(location.search) ? 'cn' : 'en';
export const L = (en, cn) => lang === 'cn' ? cn : en;

const CN = {
  title: '火星城市探索器 | InterImm',
  lede: '一座可以探索的火星城市。',
  li1: '<b>环绕</b>：从高处俯瞰整座城市。',
  li2: '<b>漫步</b>：以火星重力（3.71 m/s²）在街道上行走。',
  fine: '城市周围的地形是<b>示意性</b>的，还不是真实高程数据。设施读数是为 InterImm 故事模拟的，故事设定在 2219 年。',
  tagline: '一座可探索的火星城市',
  orbit: '环绕', walk: '漫步',
  live: '实时火星时间', hour: '火星时', season: '季节 (Ls)',
  facTitle: '公开设施', facIntro: '这座城市各工厂的实时读数，为 InterImm 故事而模拟。', tabFac: '设施',
  hint: '拖动环顾 · 捏合缩放 · 双指移动', jump: '跳',
  tabSun: '太阳', tabAbout: '关于',
  land: '土地', tabLand: '土地',
  li3: '<b>土地</b>：登记一块空地，设计你的建筑，领取地契。所有人都能在城市里看到它。',
  landEyebrow: '土地登记处 · 南河城', landTitle: '登记一块地',
  landIntro: '挑一块空地，设计上面的建筑，它就会出现在所有人看到的城市里。免费，无需账号。',
  landRings: '城市环路', landMine: '我的地块', landLatest: '最新登记',
  landGrow: '内侧四条环路已开放。外侧每条拓荒环路在内侧环路登记满四分之一后开放，城市随着居民入住向外生长。',
  landHub: '登记簿公开，与星际企业中心一起保存。',
};
const CN_PH = { landSearch: '地块号（如 A117）或持有人' };

if (lang === 'cn') {
  document.documentElement.lang = 'zh-CN';
  document.title = CN.title;
  for (const el of document.querySelectorAll('[data-i18n]')) { const v = CN[el.dataset.i18n]; if (v != null) el.innerHTML = v; }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) { const v = CN_PH[el.dataset.i18nPh]; if (v != null) el.placeholder = v; }
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
