// 图表颜色：都用 CSS 变量（浅色 / 深色各一套，见 styles.css），颜色跟着类别走，不跟着排名走
export const CAT_COLOR = { electricity: 'var(--c-electricity)', gas: 'var(--c-gas)', water: 'var(--c-water)', internet: 'var(--c-internet)' };
// 分项堆叠：PG&E 发电 / 输配 / 燃气，市政 水 / 垃圾 / 污水（顺序经过色盲检查）
export const ITEM_COLOR = {
  electric_generation: 'var(--c-generation)', electric_delivery: 'var(--c-electricity)', gas: 'var(--c-gas)',
  water: 'var(--c-water)', garbage: 'var(--c-garbage)', sewer: 'var(--c-sewer)',
};
export const ITEM_STACKS = { pge: ['electric_generation', 'electric_delivery', 'gas'], sunnyvale: ['water', 'garbage', 'sewer'] };
const PROVIDER_CAT = { energy: 'electricity', water: 'water', internet: 'internet' };
export const providerColor = p => CAT_COLOR[PROVIDER_CAT[p && p.category] || 'internet'];
// 住户色块（只用来区分人，不用在图表里）
const PEOPLE = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#eda100', '#e34948', '#008300', '#7a6f63', '#b04a8a'];
export function personColor(id) {
  let hsh = 0;
  for (const c of String(id)) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  return PEOPLE[hsh % PEOPLE.length];
}
