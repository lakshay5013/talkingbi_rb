const KPI_SPLIT_REGEX = /,|\band\b|\bthen\b|\balso\b/gi;

const KPI_DEFAULTS = [
  'Total Sales',
  'Profit by Category',
  'Monthly Revenue Trend',
  'Top Products',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

const CATEGORY_SERIES = [
  { name: 'Electronics', value: 124000 },
  { name: 'Furniture', value: 93000 },
  { name: 'Clothing', value: 86000 },
  { name: 'Office Supplies', value: 74000 },
  { name: 'Home Decor', value: 67000 },
];

const DISTRIBUTION_SERIES = [
  { name: 'Consumer', value: 46 },
  { name: 'Corporate', value: 33 },
  { name: 'Home Office', value: 21 },
];

const CHART_TYPE_RULES = [
  { type: 'line', matcher: /(trend|monthly|weekly|daily|growth|over time|timeline|forecast)/i },
  { type: 'bar', matcher: /(compare|comparison|by category|by region|top|products|ranking|performance)/i },
  { type: 'donut', matcher: /(distribution|segment|share|mix|composition|ratio)/i },
  { type: 'pie', matcher: /(pie|split)/i },
];

function toTitleCase(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function stableHash(text) {
  return Array.from(String(text || '')).reduce((acc, ch, idx) => acc + ch.charCodeAt(0) * (idx + 1), 0);
}

export function inferChartType(kpiName = '') {
  const matched = CHART_TYPE_RULES.find((rule) => rule.matcher.test(kpiName));
  return matched ? matched.type : 'bar';
}

export function parseKpiInput(input = '') {
  const chunks = String(input || '')
    .split(KPI_SPLIT_REGEX)
    .map((part) => toTitleCase(part))
    .filter(Boolean);

  const unique = Array.from(new Set(chunks));
  const normalized = unique.length > 0 ? unique : KPI_DEFAULTS;

  return normalized.map((name, index) => ({
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}`,
    name,
    chartType: inferChartType(name),
  }));
}

function buildLineSeries(seed) {
  return MONTHS.map((month, idx) => ({
    name: month,
    value: 52000 + (seed % 14000) + idx * 5200 + ((idx % 2) * 2100),
  }));
}

function buildBarSeries(seed) {
  return CATEGORY_SERIES.map((row, idx) => ({
    name: row.name,
    value: row.value + (seed % 9000) + idx * 2200,
  }));
}

function buildDistributionSeries(seed) {
  const delta = seed % 7;
  return DISTRIBUTION_SERIES.map((row, idx) => ({
    name: row.name,
    value: Math.max(8, row.value + (idx === 0 ? delta : idx === 1 ? -delta + 2 : -2)),
  }));
}

function buildKpiValue(widget) {
  const total = widget.series.reduce((sum, point) => sum + Number(point.value || 0), 0);
  if (widget.chartType === 'line') return `INR ${Math.round(total / 1000)}K`;
  if (widget.chartType === 'bar') return `INR ${Math.round(total / 1000)}K`;
  return `${Math.round(total)}%`;
}

export function buildDashboardWidgets(selectedKpis = []) {
  return selectedKpis.map((kpi, index) => {
    const seed = stableHash(kpi.name) + index * 97;
    const chartType = inferChartType(kpi.name);
    const series = chartType === 'line'
      ? buildLineSeries(seed)
      : chartType === 'bar'
        ? buildBarSeries(seed)
        : buildDistributionSeries(seed);

    return {
      ...kpi,
      chartType,
      series,
      kpiValue: buildKpiValue({ chartType, series }),
      kpiDelta: `${(6 + (seed % 14)).toFixed(1)}%`,
    };
  });
}
