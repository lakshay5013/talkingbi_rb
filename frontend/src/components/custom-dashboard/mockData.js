const BASE_MONTHLY = [
  { month: 'Jan', sales: 62000, profit: 13200, orders: 410, returns: 24 },
  { month: 'Feb', sales: 68000, profit: 14600, orders: 455, returns: 27 },
  { month: 'Mar', sales: 71000, profit: 15300, orders: 488, returns: 29 },
  { month: 'Apr', sales: 76000, profit: 16800, orders: 520, returns: 31 },
  { month: 'May', sales: 73500, profit: 16200, orders: 509, returns: 28 },
  { month: 'Jun', sales: 81200, profit: 17900, orders: 548, returns: 33 },
  { month: 'Jul', sales: 84500, profit: 18500, orders: 570, returns: 34 },
  { month: 'Aug', sales: 87200, profit: 19150, orders: 596, returns: 36 },
];

const BASE_CATEGORY = [
  { name: 'Electronics', sales: 198000 },
  { name: 'Furniture', sales: 151000 },
  { name: 'Office Supplies', sales: 124000 },
  { name: 'Clothing', sales: 98000 },
  { name: 'Home Decor', sales: 76000 },
];

const BASE_DISTRIBUTION = [
  { name: 'Consumer', value: 47 },
  { name: 'Corporate', value: 31 },
  { name: 'Home Office', value: 22 },
];

const BASE_REGION = [
  { name: 'West', sales: 223000 },
  { name: 'East', sales: 181000 },
  { name: 'South', sales: 164000 },
  { name: 'Central', sales: 143000 },
  { name: 'North', sales: 126000 },
];

const BASE_TOP_PRODUCTS = [
  { name: 'Phones', sales: 126000 },
  { name: 'Chairs', sales: 104000 },
  { name: 'Binders', sales: 93000 },
  { name: 'Storage', sales: 84000 },
  { name: 'Accessories', sales: 74000 },
];

function jitter(value, seed, variance = 0.09) {
  const wobble = Math.sin(seed) * variance + Math.cos(seed * 0.7) * (variance / 2);
  return Math.max(1, Math.round(value * (1 + wobble)));
}

function seriesJitter(rows, keys, seedBase = 1) {
  return rows.map((row, idx) => {
    const seed = seedBase + idx * 1.37;
    const next = { ...row };
    keys.forEach((key, keyIdx) => {
      next[key] = jitter(Number(row[key] || 0), seed + keyIdx * 0.91);
    });
    return next;
  });
}

export function generateMockDashboardData(seed = Date.now()) {
  const baseSeed = Number(seed % 10000) / 100;

  const monthly = seriesJitter(BASE_MONTHLY, ['sales', 'profit', 'orders', 'returns'], baseSeed + 3);
  const salesByCategory = seriesJitter(BASE_CATEGORY, ['sales'], baseSeed + 7);
  const regionSales = seriesJitter(BASE_REGION, ['sales'], baseSeed + 11);
  const topProducts = seriesJitter(BASE_TOP_PRODUCTS, ['sales'], baseSeed + 15);

  const totalSales = monthly.reduce((sum, row) => sum + row.sales, 0);
  const totalProfit = monthly.reduce((sum, row) => sum + row.profit, 0);
  const totalOrders = monthly.reduce((sum, row) => sum + row.orders, 0);
  const totalReturns = monthly.reduce((sum, row) => sum + row.returns, 0);

  const salesDistribution = BASE_DISTRIBUTION.map((item, idx) => ({
    ...item,
    value: Math.max(8, Math.min(70, Math.round(item.value + Math.sin(baseSeed + idx) * 4))),
  }));

  return {
    kpis: {
      totalSales,
      totalProfit,
      totalOrders,
      totalReturns,
      salesGrowth: 12 + Math.round(Math.sin(baseSeed) * 7),
      profitGrowth: 9 + Math.round(Math.cos(baseSeed) * 6),
    },
    monthly,
    salesByCategory,
    salesDistribution,
    regionSales,
    topProducts,
  };
}
