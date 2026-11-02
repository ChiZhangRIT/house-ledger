// 认识的账单公司（解析器 id → 默认名称、类别、账单周期、结束日算不算在周期内），以及手动录入时预填的分项和用量
export const KNOWN_PROVIDERS = {
  pge: { name: 'PG&E', category: 'energy', parser: 'pge', cycleMonths: 1, periodConvention: 'inclusive' },
  sunnyvale: { name: 'City of Sunnyvale', category: 'water', parser: 'sunnyvale', cycleMonths: 2, periodConvention: 'shared' },
  att: { name: 'AT&T Fiber', category: 'internet', parser: 'att', cycleMonths: 1, periodConvention: 'inclusive' },
  xfinity: { name: 'Xfinity', category: 'internet', parser: 'xfinity', cycleMonths: 1, periodConvention: 'inclusive' },
};
export const ITEM_PRESETS = {
  energy: [['electric_delivery', 'Electric Delivery'], ['electric_generation', 'Electric Generation'], ['gas', 'Gas']],
  water: [['water', 'Water'], ['sewer', 'Sewer'], ['garbage', 'Garbage']],
  internet: [['internet', 'Internet']],
};
export const USAGE_PRESETS = { energy: [['electricity', 'kWh'], ['gas', 'therm']], water: [['water', 'CCF']], internet: [] };
export const USAGE_UNITS = { electricity: 'kWh', gas: 'therm', water: 'CCF', data: 'GB' };
export const SPLIT_CATEGORIES = ['energy', 'water', 'internet'];
