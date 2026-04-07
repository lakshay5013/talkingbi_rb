import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, Tooltip as RechartsTooltip, ZAxis, Legend, LabelList,
  Treemap, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, FunnelChart, Funnel,
  Sankey, ReferenceLine
} from 'recharts';
import { Lock, Sparkles, Download, BarChart2, TrendingUp, PieChart as PieIcon, Activity, Maximize2, FileText, AlertTriangle, ChevronRight } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { apiGet, apiPost } from '../api';

const monthMap = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

const formatMonthLabel = (monthValue) => {
  const key = String(monthValue || '').padStart(2, '0');
  return monthMap[key] || String(monthValue || 'NA');
};

const fallbackData = {
  bar: [
    { name: 'Electronics', value: 42000 },
    { name: 'Clothing', value: 37000 },
    { name: 'Furniture', value: 31000 },
  ],
  line: [
    { name: 'Jan', value: 22000 },
    { name: 'Feb', value: 26000 },
    { name: 'Mar', value: 24000 },
    { name: 'Apr', value: 30000 },
  ],
  scatter: [
    { x: 1, y: 20, z: 180 },
    { x: 2, y: 35, z: 130 },
    { x: 3, y: 28, z: 220 },
    { x: 4, y: 44, z: 190 },
  ],
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const renderPieDataLabel = ({ name, percent }) => {
  if (!percent || percent < 0.05) return '';
  return `${name}: ${(percent * 100).toFixed(0)}%`;
};

const monthOrderMap = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const sortMonthSeries = (series = []) => {
  if (!Array.isArray(series)) return [];
  return [...series].sort((a, b) => {
    const aOrder = monthOrderMap[a?.name] || Number(a?.name) || 999;
    const bOrder = monthOrderMap[b?.name] || Number(b?.name) || 999;
    return aOrder - bOrder;
  });
};

const monthCodeToLabel = (value) => {
  const key = String(value || '').padStart(2, '0');
  return monthMap[key] || String(value || 'NA');
};

const formatDateLabel = (value) => {
  const text = String(value || '').trim();
  if (!text) return 'NA';
  const d = new Date(text);
  if (Number.isNaN(d.valueOf())) return text;
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-IN', { month: 'short' });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const hexToRgb = (hex) => {
  const normalized = String(hex || '').replace('#', '').trim();
  if (normalized.length !== 6) return { r: 59, g: 130, b: 246 };
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const toHex = ({ r, g, b }) =>
  `#${[r, g, b]
    .map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;

const mixHex = (hexA, hexB, weight = 0.5) => {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return toHex({
    r: a.r * (1 - weight) + b.r * weight,
    g: a.g * (1 - weight) + b.g * weight,
    b: a.b * (1 - weight) + b.b * weight,
  });
};

const smoothSeries = (series, level = 0) => {
  if (!Array.isArray(series) || series.length === 0) return [];
  const smoothing = clamp(Number(level || 0), 0, 100);
  if (smoothing <= 0) {
    return series.map((row) => ({ ...row, value: Number(row.value || 0) }));
  }

  const alpha = 1 - (smoothing / 100) * 0.85;
  let previous = Number(series[0]?.value || 0);

  return series.map((row, index) => {
    const current = Number(row.value || 0);
    if (index === 0) {
      previous = current;
      return { ...row, value: current };
    }
    const smoothed = alpha * current + (1 - alpha) * previous;
    previous = smoothed;
    return { ...row, value: Number(smoothed.toFixed(2)) };
  });
};

const withTrendAndPrevious = (series = []) => {
  if (!Array.isArray(series) || series.length === 0) return [];

  const numeric = series.map((row) => Number(row.value || 0));
  const n = numeric.length;
  const sumX = numeric.reduce((acc, _row, idx) => acc + idx + 1, 0);
  const sumY = numeric.reduce((acc, value) => acc + value, 0);
  const sumXY = numeric.reduce((acc, value, idx) => acc + value * (idx + 1), 0);
  const sumX2 = numeric.reduce((acc, _value, idx) => acc + (idx + 1) * (idx + 1), 0);
  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / Math.max(n, 1);

  return series.map((row, idx) => {
    const previousValue = idx === 0 ? Number((numeric[0] * 0.9).toFixed(2)) : numeric[idx - 1];
    const trendValue = Number((intercept + slope * (idx + 1)).toFixed(2));
    return {
      ...row,
      value: Number(row.value || 0),
      previousValue,
      trendValue,
    };
  });
};

const withTimeout = (promise, timeoutMs = 4500) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    }),
  ]);

export default function GeneratedChart({ query, plan, onFollowup, filters, tier = 'core', isOpen = true, isLocked = false, visualMode = 'free' }) {
  const freeGraphRef = useRef(null);
  const premiumGraphRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [chartType, setChartType] = useState('Bar Chart');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [insight, setInsight] = useState('Running analysis for your prompt...');
  const [data, setData] = useState({ bar: [], line: [], scatter: [] });
  const [autoInsights, setAutoInsights] = useState([]);
  const [showAutoInsights, setShowAutoInsights] = useState(false);
  const [showPremiumEditor, setShowPremiumEditor] = useState(false);
  const [premiumConfig, setPremiumConfig] = useState({
    title: '',
    xAxis: '',
    yAxis: '',
    accent: '#8b5cf6',
    lineStyle: 'monotone',
    showGoalLine: true,
    annotation: '',
    showTrendline: true,
    comparePreviousPeriod: false,
    smoothingLevel: 24,
  });

  const isFree = plan === 'Free';
  const isPlus = plan === 'Plus';
  const isPremiumCard = tier === 'premium';
  const isPremiumView = visualMode === 'premium';
  const hasPremiumAccess = plan === 'Plus' || plan === 'Pro' || plan === 'Premium';

  const chartTypes = [
    { name: 'Bar Chart', icon: <BarChart2 className="w-4 h-4" />, tier: 'free' },
    { name: 'Line Graph', icon: <TrendingUp className="w-4 h-4" />, tier: 'free' },
    { name: 'Pie Chart', icon: <PieIcon className="w-4 h-4" />, tier: 'free' },
    { name: 'Column Chart', icon: <BarChart2 className="w-4 h-4" />, tier: 'free' },
    { name: 'Scatter Plot', icon: <Activity className="w-4 h-4" />, tier: 'free' },
    { name: 'Area Chart', icon: <Activity className="w-4 h-4" />, tier: 'free' },
    { name: 'Histogram', icon: <BarChart2 className="w-4 h-4 rotate-90" />, tier: 'plus' },
    { name: 'Donut Chart', icon: <PieIcon className="w-4 h-4" />, tier: 'plus' },
    { name: 'Bubble Chart', icon: <Activity className="w-4 h-4" />, tier: 'plus' },
    { name: 'Stacked Bar Chart', icon: <BarChart2 className="w-4 h-4" />, tier: 'plus' },
    { name: 'Treemap', icon: <BarChart2 className="w-4 h-4" />, tier: 'plus' },
    { name: 'Radar (Spider) Chart', icon: <Activity className="w-4 h-4" />, tier: 'plus' },
    { name: 'Funnel Chart', icon: <Activity className="w-4 h-4" />, tier: 'plus' },
    { name: 'Sankey Diagram', icon: <Activity className="w-4 h-4" />, tier: 'pro' },
    { name: 'Heatmap', icon: <Activity className="w-4 h-4" />, tier: 'pro' },
    { name: 'Waterfall Chart', icon: <BarChart2 className="w-4 h-4" />, tier: 'pro' },
    { name: 'Gantt Chart', icon: <BarChart2 className="w-4 h-4" />, tier: 'pro' },
    { name: 'Box and Whisker Plot', icon: <Activity className="w-4 h-4" />, tier: 'pro' },
    { name: 'Bullet Graph', icon: <TrendingUp className="w-4 h-4" />, tier: 'pro' },
    { name: 'Pictogram', icon: <PieIcon className="w-4 h-4" />, tier: 'pro' },
  ].map((item) => ({
    ...item,
    locked: item.tier === 'free' ? false : item.tier === 'plus' ? isFree : (isFree || isPlus),
  }));

  const isPercentMetric = useMemo(
    () => /%|rate|growth|churn|margin|ratio/i.test(query || ''),
    [query]
  );

  const isCurrencyMetric = useMemo(
    () => /sales|revenue|profit|amount|price|cost|gmv|income/i.test(query || ''),
    [query]
  );

  const chartTitle = useMemo(() => {
    if (/line|area/i.test(chartType)) return 'Monthly Sales Trend';
    if (/bar|column|histogram|waterfall/i.test(chartType)) return 'Category Performance';
    if (/pie|donut|funnel|treemap/i.test(chartType)) return 'Share Distribution';
    if (/scatter|bubble/i.test(chartType)) return 'Correlation Overview';
    return 'Business Trend Overview';
  }, [chartType]);

  const xAxisLabel = useMemo(() => {
    if (/scatter|bubble/i.test(chartType)) return 'Observation Index';
    if (/line|area|histogram/i.test(chartType)) return 'Months';
    return 'Category';
  }, [chartType]);

  const yAxisLabel = useMemo(() => {
    if (isPercentMetric) return 'Growth (%)';
    if (isCurrencyMetric) return 'Revenue (INR)';
    return 'Value';
  }, [isCurrencyMetric, isPercentMetric]);

  const chartTheme = useMemo(
    () =>
      isPremiumView
        ? {
          primary: '#3b82f6',
          accent: '#8b5cf6',
          growth: '#10b981',
          highlight: '#f59e0b',
          grid: 'rgba(148,163,184,0.25)',
          axis: '#cbd5e1',
          tooltipBg: 'rgba(15,23,42,0.95)',
          tooltipBorder: '1px solid rgba(99,102,241,0.45)',
          tooltipColor: '#e2e8f0',
          cursor: 'rgba(99,102,241,0.12)',
        }
        : {
          primary: '#2563eb',
          accent: '#2563eb',
          growth: '#2563eb',
          highlight: '#2563eb',
          grid: '#E5E7EB',
          axis: '#6B7280',
          tooltipBg: '#FFFFFF',
          tooltipBorder: '1px solid #E5E7EB',
          tooltipColor: '#111827',
          cursor: '#F3F4F6',
        },
    [isPremiumView]
  );

  const premiumAxisLabels = useMemo(
    () => ({
      title: premiumConfig.title.trim() || `${chartTitle} - Premium Deep View`,
      xAxis: premiumConfig.xAxis.trim() || xAxisLabel,
      yAxis: premiumConfig.yAxis.trim() || yAxisLabel,
    }),
    [premiumConfig.title, premiumConfig.xAxis, premiumConfig.yAxis, chartTitle, xAxisLabel, yAxisLabel]
  );

  const premiumTheme = useMemo(
    () => ({
      ...chartTheme,
      primary: premiumConfig.accent,
      accent: premiumConfig.accent,
      growth: mixHex(premiumConfig.accent, '#10b981', 0.45),
      highlight: mixHex(premiumConfig.accent, '#f59e0b', 0.35),
    }),
    [chartTheme, premiumConfig.accent]
  );

  const premiumPalette = useMemo(
    () => [
      premiumTheme.primary,
      mixHex(premiumTheme.primary, '#3b82f6', 0.35),
      mixHex(premiumTheme.primary, '#8b5cf6', 0.35),
      mixHex(premiumTheme.primary, '#10b981', 0.4),
      mixHex(premiumTheme.primary, '#f59e0b', 0.3),
    ],
    [premiumTheme.primary]
  );

  const premiumLineData = useMemo(() => {
    const smoothed = smoothSeries(data.line || [], premiumConfig.smoothingLevel);
    return withTrendAndPrevious(smoothed);
  }, [data.line, premiumConfig.smoothingLevel]);

  const formatMetric = useCallback(
    (value) => {
      const num = Number(value || 0);
      if (isPercentMetric) return `${num.toFixed(1)}%`;
      if (isCurrencyMetric) return `INR ${num.toLocaleString()}`;
      return num.toLocaleString();
    },
    [isCurrencyMetric, isPercentMetric]
  );

  const formatAxisTick = useCallback(
    (value) => {
      const num = Number(value || 0);
      if (isPercentMetric) return `${num.toFixed(0)}%`;
      if (isCurrencyMetric) {
        if (Math.abs(num) >= 1000000) return `INR ${(num / 1000000).toFixed(1)}M`;
        if (Math.abs(num) >= 1000) return `INR ${(num / 1000).toFixed(0)}K`;
      }
      if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(0)}K`;
      return `${num}`;
    },
    [isCurrencyMetric, isPercentMetric]
  );

  const axisValues = useMemo(() => {
    if (/scatter|bubble|heatmap/i.test(chartType)) {
      return (data.scatter || []).map((point) => point.y || 0);
    }
    if (/line|area|waterfall|histogram|gantt/i.test(chartType)) {
      return (data.line || []).map((point) => point.value || 0);
    }
    return (data.bar || []).map((point) => point.value || point.median || point.q3 || 0);
  }, [chartType, data.bar, data.line, data.scatter]);

  const yAxisWidth = useMemo(() => {
    const maxLabelLength = Math.max(...axisValues.map((value) => formatAxisTick(value).length), 3);
    return Math.min(108, Math.max(58, maxLabelLength * 8 + 16));
  }, [axisValues, formatAxisTick]);

  const cartesianMargin = useMemo(() => ({ top: 18, right: 20, left: 10, bottom: 40 }), []);

  const premiumSignals = useMemo(() => {
    const line = data.line || [];
    const first = Number(line[0]?.value || 0);
    const last = Number(line[line.length - 1]?.value || 0);
    const growth = first > 0 ? ((last - first) / first) * 100 : 0;
    const volatility = line.length > 1
      ? line.reduce((acc, point, idx) => {
        if (idx === 0) return acc;
        return acc + Math.abs(Number(point.value || 0) - Number(line[idx - 1]?.value || 0));
      }, 0) / Math.max(line.length - 1, 1)
      : 0;
    const confidence = Math.max(72, Math.min(97, Math.round(88 - Math.min(volatility / 1200, 12) + Math.max(growth / 10, -4))));

    return {
      forecastGrowth: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`,
      forecastConfidence: `${confidence}%`,
      volatilityBand: formatMetric(Math.round(volatility || 0)),
    };
  }, [data.line, formatMetric]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    let hardStopTimer = null;

    const loadChartData = async () => {
      setLoadingStep(0);
      setInsight('Running analysis for your prompt...');
      setData({ bar: [], line: [], scatter: [] });
      setAutoInsights([]);

      const t1 = setTimeout(() => setLoadingStep(1), 350);
      const t2 = setTimeout(() => setLoadingStep(2), 900);
      hardStopTimer = setTimeout(() => {
        if (!cancelled) {
          setInsight('Data service is taking longer than expected. Showing fallback visualization.');
          setData(fallbackData);
          setLoadingStep(3);
        }
      }, 6000);

      try {
        const dbMode = Boolean(filters?.useUserDb || filters?.datasetId);
        const [chatResult, salesResult, categoryResult, regionResult] = await Promise.allSettled(
          dbMode
            ? [
              withTimeout(apiPost('/api/chat', { query, filters, usageType: 'dashboard_generation' })),
            ]
            : [
              withTimeout(apiPost('/api/chat', { query, filters, usageType: 'dashboard_generation' })),
              withTimeout(apiGet('/api/dashboards/sales-overview', filters)),
              withTimeout(apiGet('/api/dashboards/category-analysis', filters)),
              withTimeout(apiGet('/api/dashboards/regional-trends', filters)),
            ]
        );

        if (cancelled) return;

        const chatResponse = chatResult.status === 'fulfilled' ? chatResult.value : {};
        const salesOverview = salesResult?.status === 'fulfilled' ? salesResult.value : {};
        const categoryAnalysis = categoryResult?.status === 'fulfilled' ? categoryResult.value : {};
        const regionalTrends = regionResult?.status === 'fulfilled' ? regionResult.value : {};
        const datasetRequested = Boolean(filters?.useUserDb || filters?.datasetId);
        const datasetResponseActive = datasetRequested && (chatResponse?.provider === 'dataset-engine' || chatResponse?.provider === 'user-db-engine');

        const chatData = Array.isArray(chatResponse?.data)
          ? chatResponse.data.map((row) => ({
            name: row.name || row.customerType || row.state || 'Item',
            value: Number(row.value ?? row.revenue ?? row.total ?? 0),
          }))
          : [];

        const isMonthSeriesFromChat = chatResponse?.parsedQuery?.group_by === 'month';
        const isDateSeriesFromChat = chatResponse?.parsedQuery?.group_by === 'date';
        const isTimeSeriesFromChat = isMonthSeriesFromChat || isDateSeriesFromChat;

        const categoryData = Array.isArray(categoryAnalysis?.categorySales)
          ? categoryAnalysis.categorySales.map((row) => ({ name: row.name, value: Number(row.value || 0) }))
          : [];

        const regionData = Array.isArray(regionalTrends?.topStates)
          ? regionalTrends.topStates.map((row) => ({ name: row.state, value: Number(row.revenue || 0) }))
          : [];

        const monthlyLine = Array.isArray(salesOverview?.monthlyRevenue)
          ? salesOverview.monthlyRevenue.map((row) => ({
            name: formatMonthLabel(row.month),
            value: Number(row.revenue || 0),
          }))
          : [];

        const barSeries = datasetResponseActive
          ? chatData
          : (chatData.length > 0 ? chatData : (categoryData.length > 0 ? categoryData : regionData));
        const safeBar = barSeries.length > 0 ? barSeries : fallbackData.bar;
        const lineSeries = datasetResponseActive
          ? (
            isTimeSeriesFromChat && chatData.length > 0
              ? (isMonthSeriesFromChat
                ? sortMonthSeries(chatData).map((row) => ({ ...row, name: monthCodeToLabel(row.name) }))
                : isDateSeriesFromChat
                  ? chatData.map((row) => ({ ...row, name: formatDateLabel(row.name) }))
                  : chatData)
              : safeBar.map((row, index) => ({ name: row.name || `P${index + 1}`, value: row.value }))
          )
          : (
            isTimeSeriesFromChat && chatData.length > 0
              ? (isMonthSeriesFromChat
                ? sortMonthSeries(chatData).map((row) => ({ ...row, name: monthCodeToLabel(row.name) }))
                : isDateSeriesFromChat
                  ? chatData.map((row) => ({ ...row, name: formatDateLabel(row.name) }))
                  : chatData)
              : (safeBar.length > 0
                ? safeBar
                : (monthlyLine.length > 0
                  ? monthlyLine
                  : fallbackData.line))
          );
        const safeLine = lineSeries.length > 0 ? lineSeries : fallbackData.line;
        const scatterSeries = lineSeries.map((row, index) => ({
          x: index + 1,
          y: row.value,
          z: Math.max(50, Math.round(row.value / 20)),
          label: row.name,
        }));

        setData({
          bar: safeBar,
          line: safeLine,
          scatter: scatterSeries.length > 0 ? scatterSeries : fallbackData.scatter,
        });
        if (!datasetRequested) {
          setInsight('Connect your database URL to enable AI insights for this chart.');
          setAutoInsights([]);
        } else {
          const baseInsight = chatResponse?.answer || 'Generated insight based on the selected business query.';
          if (!datasetResponseActive) {
            setInsight(`${baseInsight} Connected database unavailable, using default app dataset.`);
            setAutoInsights([]);
          } else {
            setInsight(baseInsight);
            if (Array.isArray(chatResponse?.insights) && chatResponse.insights.length > 0) {
              setAutoInsights(chatResponse.insights);
            }
          }
        }

        const suggestedType = (chatResponse?.chartType || '').toLowerCase();
        if (suggestedType === 'bar') setChartType('Bar Chart');
        if (suggestedType === 'pie') setChartType('Pie Chart');
        if (suggestedType === 'line') setChartType('Line Graph');
        if (isTimeSeriesFromChat) setChartType('Line Graph');
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load generated chart data:', err);
          setInsight('Unable to fetch backend insights right now. Please retry your query.');
          setData(fallbackData);
        }
      } finally {
        if (!cancelled) {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(hardStopTimer);
          setLoadingStep(3);
        }
      }
    };

    loadChartData();

    return () => {
      cancelled = true;
      if (hardStopTimer) clearTimeout(hardStopTimer);
    };
  }, [query, filters, isOpen]);

  const exportFileNameBase = useMemo(
    () => `TalkingBI_${chartTitle.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    [chartTitle]
  );

  const UNSUPPORTED_COLOR_REGEX = /oklab|oklch|lch|lab|color\s*\(/gi;

  const isUnsupportedColor = (value) => {
    if (!value) return false;
    UNSUPPORTED_COLOR_REGEX.lastIndex = 0;
    return UNSUPPORTED_COLOR_REGEX.test(value);
  };

  const stripUnsupportedColors = (element) => {
    if (!element || element.nodeType !== 1) return;
    const style = element.style;
    const colorProps = ['color', 'backgroundColor', 'borderColor', 'boxShadow', 'textShadow', 'fill', 'stroke'];
    colorProps.forEach((prop) => {
      const value = style.getPropertyValue(prop);
      if (isUnsupportedColor(value)) {
        style.removeProperty(prop);
      }
    });
    const styleAttr = element.getAttribute('style');
    if (styleAttr && isUnsupportedColor(styleAttr)) {
      const cleaned = styleAttr
        .split(';')
        .filter(rule => !isUnsupportedColor(rule))
        .join(';');
      if (cleaned.trim()) {
        element.setAttribute('style', cleaned);
      } else {
        element.removeAttribute('style');
      }
    }
    Array.from(element.children || []).forEach(child => stripUnsupportedColors(child));
  };

  const captureExportCanvas = useCallback(async (targetRef) => {
    if (!targetRef?.current) return null;
    const exportNode = targetRef.current.querySelector('[data-export-chart="true"]') || targetRef.current;
    const clonedNode = exportNode.cloneNode(true);
    stripUnsupportedColors(clonedNode);
    
    try {
      // Timeout wrapper for html2canvas (25 seconds max)
      const canvasPromise = html2canvas(clonedNode, {
        backgroundColor: null,
        scale: 1.5, // Reduced from 2 for faster capture
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowHeight: clonedNode.scrollHeight,
        windowWidth: clonedNode.scrollWidth,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chart capture timeout')), 25000)
      );

      return await Promise.race([canvasPromise, timeoutPromise]);
    } catch (err) {
      console.error('Canvas capture error:', err);
      throw err;
    }
  }, []);

  const handleExportPng = useCallback(async (targetRef, variant) => {
    try {
      setIsExporting(true);
      const canvas = await captureExportCanvas(targetRef);
      if (!canvas) {
        alert('Failed to capture chart. Please try again.');
        return;
      }
      const link = document.createElement('a');
      link.download = `${exportFileNameBase}_${variant}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      alert(`PNG export failed: ${err?.message || 'Unknown error'}`);
      console.error('PNG export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, [captureExportCanvas, exportFileNameBase]);

  const handleExportPdf = useCallback(async (targetRef, variant) => {
    try {
      setIsExporting(true);
      const canvas = await captureExportCanvas(targetRef);
      if (!canvas) {
        alert('Failed to capture chart. Please try again.');
        return;
      }
      const imageData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageRatio = canvas.width / canvas.height;

      let renderWidth = pageWidth - 36;
      let renderHeight = renderWidth / imageRatio;
      if (renderHeight > pageHeight - 36) {
        renderHeight = pageHeight - 36;
        renderWidth = renderHeight * imageRatio;
      }

      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;
      pdf.addImage(imageData, 'PNG', x, y, renderWidth, renderHeight, undefined, 'FAST');
      pdf.save(`${exportFileNameBase}_${variant}.pdf`);
    } catch (err) {
      alert(`PDF export failed: ${err?.message || 'Unknown error'}`);
      console.error('PDF export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, [captureExportCanvas, exportFileNameBase]);

  if (loadingStep < 3) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`chart-loading-card ${isPremiumView ? 'premium-loading' : ''}`}
      >
        <div className="chart-loader-icon">
          <div className="loader-ring"></div>
          <div className="loader-ring secondary"></div>
          <div className="loader-core"><Sparkles size={18} /></div>
        </div>
        <AnimatePresence mode="wait">
          <motion.h3
            key={loadingStep} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="chart-loading-text"
          >
            {loadingStep === 0 && "Initializing..."}
            {loadingStep === 1 && "Querying Data Clusters..."}
            {loadingStep === 2 && "Synthesizing AI Insight..."}
          </motion.h3>
        </AnimatePresence>
      </motion.div>
    );
  }

  const tooltipStyle = {
    backgroundColor: chartTheme.tooltipBg,
    border: chartTheme.tooltipBorder,
    borderRadius: '12px',
    color: chartTheme.tooltipColor,
    boxShadow: isPremiumView ? '0 12px 24px rgba(15,23,42,0.35)' : '0 8px 18px rgba(17,24,39,0.12)',
  };

  const axisLabelStyle = {
    fill: chartTheme.axis,
    fontSize: 11,
    fontWeight: 600,
  };

  const yAxisProps = {
    stroke: chartTheme.axis,
    axisLine: false,
    tickLine: false,
    width: yAxisWidth,
    tickFormatter: formatAxisTick,
    label: { value: yAxisLabel, angle: -90, position: 'insideLeft', dx: -2, style: axisLabelStyle },
  };

  const xAxisProps = {
    stroke: chartTheme.axis,
    axisLine: false,
    tickLine: false,
    height: 44,
    label: { value: xAxisLabel, position: 'insideBottom', offset: -12, style: axisLabelStyle },
  };

  const renderChart = (mode = 'free') => {
    const localTheme = mode === 'premium' ? premiumTheme : chartTheme;
    const localXAxisLabel = mode === 'premium' ? premiumAxisLabels.xAxis : xAxisLabel;
    const localYAxisLabel = mode === 'premium' ? premiumAxisLabels.yAxis : yAxisLabel;
    const localXAxisProps = {
      ...xAxisProps,
      stroke: localTheme.axis,
      label: { ...(xAxisProps.label || {}), value: localXAxisLabel, style: { ...axisLabelStyle, fill: localTheme.axis } },
    };
    const localYAxisProps = {
      ...yAxisProps,
      stroke: localTheme.axis,
      label: { ...(yAxisProps.label || {}), value: localYAxisLabel, style: { ...axisLabelStyle, fill: localTheme.axis } },
    };
    const localTooltipStyle = {
      ...tooltipStyle,
      backgroundColor: localTheme.tooltipBg,
      border: localTheme.tooltipBorder,
      color: localTheme.tooltipColor,
    };
    const legendFormatter = (value) => <span style={{ color: localTheme.axis }}>{value}</span>;

    switch (chartType) {
      case 'Bar Chart':
      case 'Column Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.bar} margin={cartesianMargin}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="name" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip
                cursor={{ fill: localTheme.cursor }}
                contentStyle={localTooltipStyle}
                formatter={(value) => [formatMetric(value), localYAxisLabel]}
              />
              <Bar
                dataKey="value"
                fill={mode === 'premium' ? 'url(#colorBarPremium)' : localTheme.primary}
                radius={mode === 'premium' ? [12, 12, 2, 2] : [4, 4, 0, 0]}
                animationDuration={mode === 'premium' ? 900 : 520}
              />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Line Graph':
        {
          const lineData = mode === 'premium' ? premiumLineData : data.line;
          return (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={cartesianMargin}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
                <XAxis dataKey="name" {...localXAxisProps} />
                <YAxis {...localYAxisProps} />
                <RechartsTooltip
                  contentStyle={localTooltipStyle}
                  formatter={(value) => [formatMetric(value), localYAxisLabel]}
                />
                {mode === 'premium' && premiumConfig.comparePreviousPeriod && (
                  <Line
                    type="linear"
                    dataKey="previousValue"
                    stroke={mixHex(localTheme.accent, '#94a3b8', 0.55)}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Previous period"
                    animationDuration={900}
                  />
                )}
                <Line
                  type={mode === 'premium' ? premiumConfig.lineStyle : 'monotone'}
                  dataKey="value"
                  stroke={mode === 'premium' ? localTheme.accent : localTheme.primary}
                  strokeWidth={mode === 'premium' ? 3.2 : 2.6}
                  dot={{ r: mode === 'premium' ? 3.6 : 3, fill: '#FFFFFF', stroke: localTheme.primary, strokeWidth: 2 }}
                  activeDot={{ r: mode === 'premium' ? 6 : 4, stroke: localTheme.accent, strokeWidth: 2, fill: '#fff' }}
                  animationDuration={mode === 'premium' ? 1000 : 520}
                />
                {mode === 'premium' && premiumConfig.showTrendline && (
                  <Line
                    type="linear"
                    dataKey="trendValue"
                    stroke={localTheme.highlight}
                    strokeWidth={2.2}
                    strokeDasharray="3 4"
                    dot={false}
                    name="Trendline"
                    animationDuration={900}
                  />
                )}
                {mode === 'premium' && premiumConfig.showGoalLine && data.line.length > 0 && (
                  <ReferenceLine
                    y={Math.round(data.line.reduce((sum, row) => sum + Number(row.value || 0), 0) / data.line.length)}
                    stroke={localTheme.highlight}
                    strokeDasharray="5 5"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          );
        }
      case 'Area Chart':
        {
          const areaData = mode === 'premium' ? premiumLineData : data.line;
          return (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={areaData} margin={cartesianMargin}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
                <XAxis dataKey="name" {...localXAxisProps} />
                <YAxis {...localYAxisProps} />
                <RechartsTooltip
                  contentStyle={localTooltipStyle}
                  formatter={(value) => [formatMetric(value), localYAxisLabel]}
                />
                {mode === 'premium' && premiumConfig.comparePreviousPeriod && (
                  <Line
                    type="linear"
                    dataKey="previousValue"
                    stroke={mixHex(localTheme.accent, '#94a3b8', 0.55)}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Previous period"
                    animationDuration={900}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={mode === 'premium' ? localTheme.accent : localTheme.primary}
                  fill={mode === 'premium' ? 'url(#colorRevPremium)' : 'url(#colorRevFree)'}
                  strokeWidth={mode === 'premium' ? 3 : 2.4}
                  animationDuration={mode === 'premium' ? 900 : 520}
                />
                {mode === 'premium' && premiumConfig.showTrendline && (
                  <Line
                    type="linear"
                    dataKey="trendValue"
                    stroke={localTheme.highlight}
                    strokeWidth={2.2}
                    strokeDasharray="3 4"
                    dot={false}
                    name="Trendline"
                    animationDuration={900}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          );
        }
      case 'Pie Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.bar}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                labelLine={false}
                label={renderPieDataLabel}
                animationDuration={1500}
              >
                {data.bar.map((entry, index) => <Cell key={`cell-${index}`} fill={mode === 'premium' ? premiumPalette[index % premiumPalette.length] : ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#FB7185'][index % 5]} />)}
              </Pie>
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Legend verticalAlign="bottom" height={28} formatter={legendFormatter} />
            </PieChart>
          </ResponsiveContainer>
        );
      case 'Donut Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.bar}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={75}
                outerRadius={105}
                paddingAngle={3}
                labelLine={false}
                label={renderPieDataLabel}
                animationDuration={1500}
              >
                {data.bar.map((entry, index) => <Cell key={`cell-${index}`} fill={mode === 'premium' ? premiumPalette[index % premiumPalette.length] : ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#FB7185'][index % 5]} />)}
              </Pie>
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Legend verticalAlign="bottom" height={28} formatter={legendFormatter} />
            </PieChart>
          </ResponsiveContainer>
        );
      case 'Scatter Plot':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={cartesianMargin}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis
                type="number"
                dataKey="x"
                stroke={localTheme.axis}
                axisLine={false}
                tickLine={false}
                label={{ value: localXAxisLabel, position: 'insideBottom', offset: -12, style: { ...axisLabelStyle, fill: localTheme.axis } }}
              />
              <YAxis
                type="number"
                dataKey="y"
                stroke={localTheme.axis}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatAxisTick}
                width={yAxisWidth}
                label={{ value: localYAxisLabel, angle: -90, position: 'insideLeft', dx: -2, style: { ...axisLabelStyle, fill: localTheme.axis } }}
              />
              <ZAxis type="number" dataKey="z" range={[50, 400]} />
              <RechartsTooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={localTooltipStyle}
                formatter={(value) => [formatMetric(value), localYAxisLabel]}
              />
              <Scatter data={data.scatter} fill={mode === 'premium' ? localTheme.accent : localTheme.primary} animationDuration={mode === 'premium' ? 900 : 520} />
              <Scatter data={data.scatter} fill="transparent" isAnimationActive={false}>
                <LabelList dataKey="label" position="top" fill={localTheme.axis} fontSize={10} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        );
      case 'Bubble Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={cartesianMargin}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis type="number" dataKey="x" stroke={localTheme.axis} axisLine={false} tickLine={false} />
              <YAxis type="number" dataKey="y" stroke={localTheme.axis} axisLine={false} tickLine={false} tickFormatter={formatAxisTick} width={yAxisWidth} />
              <ZAxis type="number" dataKey="z" range={[80, 700]} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Scatter data={data.scatter} fill={mode === 'premium' ? localTheme.accent : '#10B981'} animationDuration={mode === 'premium' ? 900 : 1500}>
                <LabelList dataKey="label" position="top" fill={localTheme.axis} fontSize={10} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        );
      case 'Histogram':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.line.map((point, idx) => ({ name: point.name, value: point.value, bin: `B${idx + 1}` }))} margin={cartesianMargin}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="bin" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Bar dataKey="value" fill={mode === 'premium' ? 'url(#colorBarPremium)' : '#2563EB'} radius={[2, 2, 0, 0]} animationDuration={mode === 'premium' ? 900 : 1500} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Stacked Bar Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.bar.map((item) => ({
                name: item.name,
                actual: Math.round(item.value * 0.7),
                projected: Math.round(item.value * 0.3),
              }))}
              margin={cartesianMargin}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="name" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Bar stackId="stack" dataKey="actual" fill={mode === 'premium' ? premiumPalette[0] : '#2563EB'} />
              <Bar stackId="stack" dataKey="projected" fill={mode === 'premium' ? premiumPalette[2] : '#10B981'} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Treemap':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data.bar.map((item) => ({ name: item.name, size: item.value }))}
              dataKey="size"
              stroke="#FFFFFF"
              fill={mode === 'premium' ? premiumPalette[0] : '#2563EB'}
              aspectRatio={4 / 3}
            />
          </ResponsiveContainer>
        );
      case 'Radar (Spider) Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data.bar}>
              <PolarGrid stroke={localTheme.grid} />
              <PolarAngleAxis dataKey="name" stroke={localTheme.axis} />
              <PolarRadiusAxis stroke={localTheme.axis} />
              <Radar name="Value" dataKey="value" stroke={mode === 'premium' ? localTheme.accent : '#2563EB'} fill={mode === 'premium' ? localTheme.accent : '#2563EB'} fillOpacity={0.35} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
            </RadarChart>
          </ResponsiveContainer>
        );
      case 'Funnel Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Funnel dataKey="value" data={data.bar} isAnimationActive nameKey="name">
                {data.bar.map((entry, index) => <Cell key={`cell-${index}`} fill={mode === 'premium' ? premiumPalette[index % premiumPalette.length] : ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#FB7185'][index % 5]} />)}
              </Funnel>
              <Legend verticalAlign="bottom" height={28} formatter={legendFormatter} />
            </FunnelChart>
          </ResponsiveContainer>
        );
      case 'Sankey Diagram':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={{
                nodes: data.bar.map((item) => ({ name: item.name })),
                links: data.bar.slice(0, data.bar.length - 1).map((item, idx) => ({
                  source: idx,
                  target: idx + 1,
                  value: Math.max(1, Math.round(item.value / 1000)),
                })),
              }}
              nodePadding={30}
              nodeWidth={12}
            />
          </ResponsiveContainer>
        );
      case 'Heatmap':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={cartesianMargin}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis type="number" dataKey="x" stroke={localTheme.axis} axisLine={false} tickLine={false} />
              <YAxis type="number" dataKey="y" stroke={localTheme.axis} axisLine={false} tickLine={false} tickFormatter={formatAxisTick} width={yAxisWidth} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Scatter data={data.scatter} fill={mode === 'premium' ? localTheme.accent : '#F59E0B'} />
            </ScatterChart>
          </ResponsiveContainer>
        );
      case 'Waterfall Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.line.map((point, idx) => ({
                name: point.name,
                change: idx === 0 ? point.value : point.value - data.line[idx - 1].value,
              }))}
              margin={cartesianMargin}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="name" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Bar dataKey="change" fill={mode === 'premium' ? localTheme.accent : '#2563EB'} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Gantt Chart':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={data.bar.map((item, idx) => ({
                task: item.name,
                duration: Math.max(1, Math.round(item.value / 5000)),
                start: idx + 1,
              }))}
              margin={cartesianMargin}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={localTheme.grid} />
              <XAxis type="number" stroke={localTheme.axis} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="task" stroke={localTheme.axis} axisLine={false} tickLine={false} width={100} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Bar dataKey="duration" fill={mode === 'premium' ? localTheme.accent : '#8B5CF6'} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Box and Whisker Plot':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.bar.map((item) => ({
                name: item.name,
                q1: Math.round(item.value * 0.5),
                median: Math.round(item.value * 0.75),
                q3: item.value,
              }))}
              margin={cartesianMargin}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="name" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Bar dataKey="q3" fill={mode === 'premium' ? mixHex(localTheme.accent, '#e2e8f0', 0.7) : '#E5E7EB'} />
              <Bar dataKey="median" fill={mode === 'premium' ? localTheme.accent : '#2563EB'} />
              <Bar dataKey="q1" fill={mode === 'premium' ? localTheme.growth : '#10B981'} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Bullet Graph':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.bar.map((item) => ({
                name: item.name,
                value: item.value,
                target: Math.round(item.value * 0.9),
              }))}
              margin={cartesianMargin}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="name" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <ReferenceLine y={0} stroke="#D1D5DB" />
              <Bar dataKey="value" fill={mode === 'premium' ? localTheme.accent : '#2563EB'} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'Pictogram':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.bar} margin={cartesianMargin}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={localTheme.grid} />
              <XAxis dataKey="name" {...localXAxisProps} />
              <YAxis {...localYAxisProps} />
              <RechartsTooltip contentStyle={localTooltipStyle} formatter={(value) => [formatMetric(value), localYAxisLabel]} />
              <Bar dataKey="value" fill={mode === 'premium' ? localTheme.highlight : '#F59E0B'} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      default: return null;
    }
  };

  const previewMetric = data.bar?.[0]?.value || data.line?.[0]?.value || 0;
  const previewLabel = data.bar?.[0]?.name || data.line?.[0]?.name || 'Top segment';

  if (!isOpen) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className={`generated-collapsed-shell ${isPremiumCard ? 'premium-collapsed' : ''}`}
      >
        <div className="generated-collapsed-left">
          <div className="generated-collapsed-head">
            <span className="collapsed-tier-chip">{tier === 'premium' ? '[PREMIUM]' : '[FREE]'}</span>
          </div>
          <h4>Graph is collapsed</h4>
          <p>
            Open this card from the header control to render free and premium preview graphs.
          </p>
        </div>

        <div className="generated-collapsed-stat">
          <span>{previewLabel}</span>
          <strong>{Number(previewMetric).toLocaleString()}</strong>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`generated-chart-root ${isFullscreen ? 'fullscreen' : ''} view-${visualMode}`}
    >
      <div className="insight-header-card">
        <div className="insight-header-icon">
          <Sparkles size={18} />
        </div>
        <div>
          <h2>AI Generated Insight</h2>
          <FormattedInsight text={insight} />
        </div>
      </div>

      {/* Auto-generated insights from smart query engine */}
      {autoInsights.length > 0 && (
        <div className="auto-insights-card">
          <button
            className="auto-insights-toggle"
            onClick={() => setShowAutoInsights(!showAutoInsights)}
          >
            <AlertTriangle size={14} />
            <span>{autoInsights.length} Auto-Insights Detected</span>
            <ChevronRight size={14} className={showAutoInsights ? 'rotated' : ''} />
          </button>
          <AnimatePresence>
            {showAutoInsights && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="auto-insights-list"
              >
                {autoInsights.map((ai, i) => (
                  <div key={i} className="auto-insight-row">
                    <ChevronRight size={12} />
                    <span>{ai}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div id="generated-graph-export" className="chart-surface-card">
        <svg width="0" height="0">
          <defs>
            <linearGradient id="colorBarPremium" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={mixHex(premiumTheme.accent, '#3B82F6', 0.2)} stopOpacity={0.95} />
              <stop offset="95%" stopColor={mixHex(premiumTheme.accent, '#8B5CF6', 0.25)} stopOpacity={1} />
            </linearGradient>
            <linearGradient id="colorRevPremium" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={premiumTheme.accent} stopOpacity={0.35} />
              <stop offset="95%" stopColor={mixHex(premiumTheme.accent, '#111827', 0.45)} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="colorRevFree" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563EB" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#2563EB" stopOpacity={0.02} />
            </linearGradient>
          </defs>
        </svg>

        <div className="chart-readable-header">
          <div>
            <h3>{chartTitle}</h3>
            <p>
              X-axis: {xAxisLabel} | Y-axis: {yAxisLabel}
            </p>
          </div>
          <span className={`chart-view-chip ${isPremiumView ? 'premium' : 'free'}`}>
            {isPremiumView ? 'Premium View' : 'Free View'}
          </span>
        </div>

        <div className="chart-action-bar">
          <div className="chart-pill-group">
            {chartTypes.map(c => (
              <button
                key={c.name}
                onClick={() => !c.locked && setChartType(c.name)}
                className={`chart-pill ${c.locked ? 'locked' : ''} ${chartType === c.name && !c.locked ? 'active' : ''}`}
              >
                <span>{c.icon} {c.name} {c.locked && <Lock className="w-3 h-3 ml-1" />}</span>
                {c.locked && (
                  <div className="chart-tooltip">
                    Plus/Pro Required
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="chart-actions-right">
            <button onClick={() => setIsFullscreen(!isFullscreen)} className="icon-btn" aria-label="Toggle fullscreen">
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="dual-chart-grid">
          <section className="chart-pane chart-pane-free">
            <div className="chart-pane-header">
              <h4>Free Graph (Open)</h4>
              <div className="chart-pane-actions">
                <span className="pane-chip free">FREE</span>
                <button onClick={() => handleExportPng(freeGraphRef, 'free_graph')} className="icon-btn export-pdf-btn disabled:opacity-50" disabled={isExporting} aria-label="Download free graph PNG" title={isExporting ? 'Exporting...' : 'Download PNG'}>
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={() => handleExportPdf(freeGraphRef, 'free_graph')} className="icon-btn export-pdf-btn disabled:opacity-50" disabled={isExporting} aria-label="Download free graph PDF" title={isExporting ? 'Exporting...' : 'Download PDF'}>
                  <FileText className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="chart-plot-area" ref={freeGraphRef}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={chartType}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="w-full h-full"
                  data-export-chart="true"
                >
                  {renderChart('free')}
                </motion.div>
              </AnimatePresence>
            </div>
          </section>

          <section className={`chart-pane ${hasPremiumAccess ? 'chart-pane-premium-unlocked' : 'chart-pane-premium-locked'}`}>
            <div className="chart-pane-header">
              <div>
                <h4>Premium Graph ({hasPremiumAccess ? 'Unlocked' : 'Locked Preview'})</h4>
                {hasPremiumAccess && <p className="premium-pane-subtitle">{premiumAxisLabels.title}</p>}
              </div>
              <div className="chart-pane-actions">
                <span className="pane-chip premium">
                  {hasPremiumAccess ? 'PREMIUM' : <><Lock size={12} /> LOCKED</>}
                </span>
                <button
                  onClick={() => handleExportPng(premiumGraphRef, 'premium_graph')}
                  className="icon-btn export-pdf-btn disabled:opacity-50"
                  disabled={isExporting}
                  aria-label="Download premium graph PNG"
                  title={isExporting ? 'Exporting...' : 'Download PNG'}
                  disabled={!hasPremiumAccess}
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleExportPdf(premiumGraphRef, 'premium_graph')}
                  className="icon-btn export-pdf-btn disabled:opacity-50"
                  disabled={isExporting}
                  aria-label="Download premium graph PDF"
                  title={isExporting ? 'Exporting...' : 'Download PDF'}
                  disabled={!hasPremiumAccess}
                >
                  <FileText className="w-4 h-4" />
                </button>
              </div>
            </div>

            {hasPremiumAccess && (
              <div className="premium-editor-box">
                <div className="premium-editor-header">
                  <span>Premium Edit Controls</span>
                  <button
                    type="button"
                    className="chart-toggle-btn premium-editor-toggle"
                    onClick={() => setShowPremiumEditor((prev) => !prev)}
                  >
                    {showPremiumEditor ? 'Hide' : 'Edit'}
                  </button>
                </div>

                {showPremiumEditor && (
                  <div className="premium-editor-grid">
                    <label>
                      Title
                      <input
                        value={premiumConfig.title}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="Premium title"
                      />
                    </label>
                    <label>
                      X-axis
                      <input
                        value={premiumConfig.xAxis}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, xAxis: e.target.value }))}
                        placeholder="X-axis label"
                      />
                    </label>
                    <label>
                      Y-axis
                      <input
                        value={premiumConfig.yAxis}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, yAxis: e.target.value }))}
                        placeholder="Y-axis label"
                      />
                    </label>
                    <label>
                      Accent
                      <input
                        type="color"
                        value={premiumConfig.accent}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, accent: e.target.value }))}
                      />
                    </label>
                    <label>
                      Line Style
                      <select
                        value={premiumConfig.lineStyle}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, lineStyle: e.target.value }))}
                      >
                        <option value="monotone">Monotone</option>
                        <option value="linear">Linear</option>
                        <option value="step">Step</option>
                      </select>
                    </label>
                    <label className="premium-slider-row">
                      Smoothing Level ({premiumConfig.smoothingLevel}%)
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={premiumConfig.smoothingLevel}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, smoothingLevel: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="premium-textarea-row">
                      Annotation
                      <input
                        value={premiumConfig.annotation}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, annotation: e.target.value }))}
                        placeholder="Add an analyst note"
                      />
                    </label>
                    <label className="premium-checkbox">
                      <input
                        type="checkbox"
                        checked={premiumConfig.showGoalLine}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, showGoalLine: e.target.checked }))}
                      />
                      Show goal line
                    </label>
                    <label className="premium-checkbox">
                      <input
                        type="checkbox"
                        checked={premiumConfig.showTrendline}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, showTrendline: e.target.checked }))}
                      />
                      Trendline on/off
                    </label>
                    <label className="premium-checkbox">
                      <input
                        type="checkbox"
                        checked={premiumConfig.comparePreviousPeriod}
                        onChange={(e) => setPremiumConfig((prev) => ({ ...prev, comparePreviousPeriod: e.target.checked }))}
                      />
                      Compare previous period
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className={`chart-plot-area ${!hasPremiumAccess ? 'locked-blur-preview' : ''}`} ref={premiumGraphRef} aria-hidden={!hasPremiumAccess}>
              <motion.div
                className="w-full h-full"
                data-export-chart="true"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                {renderChart('premium')}
                {hasPremiumAccess && premiumConfig.annotation.trim() && (
                  <div className="premium-chart-annotation">
                    <span>Annotation</span>
                    <p>{premiumConfig.annotation.trim()}</p>
                  </div>
                )}
              </motion.div>
              {!hasPremiumAccess && (
                <div className="locked-overlay">
                  <div className="locked-overlay-card">
                    <Lock size={16} />
                    <strong>Unlock Premium Insights</strong>
                    <p>Advanced forecasting and deeper drill-down are available in premium.</p>
                  </div>
                </div>
              )}
            </div>

            {!hasPremiumAccess && (
              <div className="premium-teaser-insights">
                <div className="teaser-insight-row">Forecast model signals +18% potential growth next cycle.</div>
                <div className="teaser-insight-row">Churn risk concentration detected in two high-value segments.</div>
              </div>
            )}

            {hasPremiumAccess && (
              <div className="premium-feature-strip">
                <div className="premium-feature-item">
                  <span>Forecast Growth</span>
                  <strong>{premiumSignals.forecastGrowth}</strong>
                </div>
                <div className="premium-feature-item">
                  <span>AI Confidence</span>
                  <strong>{premiumSignals.forecastConfidence}</strong>
                </div>
                <div className="premium-feature-item">
                  <span>Volatility Band</span>
                  <strong>{premiumSignals.volatilityBand}</strong>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="chart-footer">
          <span>Chart quality: enterprise-ready formatting</span>
          <span>Type: {chartType} ({chartTypes.find((item) => item.name === chartType)?.tier?.toUpperCase() || 'FREE'})</span>
        </footer>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.5 }}
        className="follow-up-row"
      >
        <span><Sparkles className="w-3 h-3" /> Follow-up:</span>
        {['Show profit by region', 'Compare against last year', 'Drill down by product category'].map((s, i) => (
          <button
            key={i}
            className="suggestion-chip"
            type="button"
            onClick={() => onFollowup?.(s)}
          >
            Try: "{s}"
          </button>
        ))}
      </motion.div>

    </motion.div>
  );
}

// Formats AI insight text with proper markdown rendering
const FormattedInsight = ({ text }) => {
  if (!text) return null;

  const renderFormattedText = (raw) => {
    // First, split inline numbered items: "text 1. item 2. item" → separate lines
    let normalized = raw.replace(/\s+(\d+)\.\s+/g, '\n$1. ');
    // Also handle bullet points inline
    normalized = normalized.replace(/\s+[-•]\s+/g, '\n• ');

    const lines = normalized.split('\n').filter(line => line.trim());
    return lines.map((line, i) => {
      // Replace **bold** with <strong>
      const parts = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;

      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(<span key={`t-${i}-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>);
        }
        parts.push(<strong key={`b-${i}-${match.index}`} style={{ color: '#a78bfa', fontWeight: 700 }}>{match[1]}</strong>);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        parts.push(<span key={`e-${i}`}>{line.slice(lastIndex)}</span>);
      }

      const content = parts.length > 0 ? parts : line;

      // Check if it's a numbered list item
      const numberedMatch = line.match(/^(\d+)\.\s+(.*)/);
      // Check if it's a bullet point
      const bulletMatch = line.match(/^[-•]\s+(.*)/);

      if (numberedMatch) {
        return (
          <div key={i} className="insight-list-item">
            <span className="insight-list-number">{numberedMatch[1]}</span>
            <span className="insight-list-content">{content}</span>
          </div>
        );
      }
      if (bulletMatch) {
        return (
          <div key={i} className="insight-list-item">
            <span className="insight-list-bullet">•</span>
            <span className="insight-list-content">{content}</span>
          </div>
        );
      }

      return <p key={i} className="insight-paragraph">{content}</p>;
    });
  };

  return <div className="insight-formatted-text">{renderFormattedText(text)}</div>;
};
