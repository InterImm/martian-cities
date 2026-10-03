// High-level KPIs for a city's open facilities, from the mars-open-facilities dashboard
// (https://interimm.org/mars-open-facilities/). Static JSON, refreshed hourly there; nothing runs on a server.
import { L, lang } from './i18n.js';

const BASE = 'https://interimm.org/mars-open-facilities/';
const STATUS = { operating: ['Operating', '运行中'], reduced: ['Reduced', '降负荷'], maintenance: ['Maintenance', '检修'], offline: ['Offline', '停运'] };
const LABEL_CN = {
  'Total generation': '总发电量', 'Solar output': '太阳能输出', 'City demand': '城市需求', 'Methane': '甲烷', 'Oxygen': '氧气',
  'Power draw': '用电功率', 'Steel': '钢', 'Sponge iron': '海绵铁', 'LOX inventory': '液氧库存', 'Methane inventory': '甲烷库存',
  'LOX dispatched': '液氧发运', 'Dome O2': '穹顶氧气', 'Biomass growth': '生物质增长', 'CO2': '二氧化碳', 'Water': '水',
  'Heat input': '热输入', 'Perchlorate': '高氯酸盐',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = x => { const a = Math.abs(x); return a >= 1000 ? Math.round(x).toLocaleString() : a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(2); };

function card(f) {
  const st = STATUS[f.status] || [f.status, f.status];
  const rows = (f.kpis || []).map(k => `<div class="kpi"><span class="kk">${esc(lang === 'cn' ? LABEL_CN[k.label] || k.label : k.label)} <small>${esc(L('design', '设计值'))} ${num(k.design)}</small></span>` +
    `<span class="kv">${num(k.value)} <small>${esc(k.unit)}</small></span></div>`).join('');
  return `<article class="fac"><header><h3>${esc(lang === 'cn' ? f.name_zh || f.name : f.name)}</h3><span class="chip st-${esc(f.status)}">${esc(L(st[0], st[1]))}</span></header>` +
    `<div class="kpis">${rows}</div><a class="fl" href="${BASE}#/${encodeURIComponent(f.id)}">${esc(L('Open dashboard', '打开仪表板'))} →</a></article>`;
}

export async function loadFacilities(el, spec) {
  if (!spec) { el.hidden = true; document.querySelector('#tabs [data-tab=facilities]')?.setAttribute('hidden', ''); return; }
  const body = el.querySelector('.fbody'), meta = el.querySelector('.fmeta');
  try {
    const res = await fetch(BASE + 'data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    const list = d.facilities.filter(f => f.city === spec.city);
    body.innerHTML = list.length ? list.map(card).join('') : `<p class="note">${esc(L('No open facilities listed for this city yet.', '这座城市暂无公开设施。'))}</p>`;
    const t = (list[0]?.time || d.generated || '').replace('T', ' ').replace(/:\d\dZ$/, ' UTC');
    meta.textContent = L(`Story time ${t}. A simulation set in the year 2219, updated hourly.`, `故事时间 ${t}。以 2219 年为背景的模拟，每小时更新。`);
  } catch (err) {
    body.innerHTML = `<p class="note">${esc(L('Could not load the facility data. ', '无法加载设施数据。'))}<a href="${BASE}">${esc(L('Open the dashboard', '打开仪表板'))}</a></p>`;
  }
}
