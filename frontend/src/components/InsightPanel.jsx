import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2, TrendingUp, HelpCircle, Lightbulb, Search as SearchIcon,
  AlertTriangle, ChevronRight, ArrowUpRight, ArrowDownRight, Minus,
  Target, Zap, Shield, Layers, Activity, Clock, Sparkles
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, Area, AreaChart, ReferenceLine
} from 'recharts';
import { apiGet, apiPost } from '../api';

const monthMap = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'
};

const formatMonthLabel = (monthValue) => {
  const key = String(monthValue || '').padStart(2, '0');
  return monthMap[key] || String(monthValue || 'NA');
};

const TABS = [
  { id: 'descriptive', label: 'Descriptive', icon: BarChart2, color: '#2563eb' },
  { id: 'diagnostic', label: 'Why', icon: HelpCircle, color: '#f59e0b' },
  { id: 'predictive', label: 'Forecast', icon: TrendingUp, color: '#10b981' },
  { id: 'prescriptive', label: 'Actions', icon: Lightbulb, color: '#8b5cf6' },
];

export default function InsightPanel({ filters, onExplore }) {
  const [activeTab, setActiveTab] = useState('descriptive');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState({});
  const [explorationData, setExplorationData] = useState(null);
  const [showExploration, setShowExploration] = useState(false);
  const [dataQuality, setDataQuality] = useState(null);

  const fetchTab = useCallback(async (tabId) => {
    setLoading(prev => ({ ...prev, [tabId]: true }));
    try {
      if (filters?.useUserDb || filters?.datasetId) {
        const prompts = {
          descriptive: 'Give descriptive insights from this connected database result set.',
          diagnostic: 'Explain why the main trends are happening in this connected database.',
          predictive: 'Provide a short forecast from this connected database based on available columns.',
          prescriptive: 'Provide action-oriented recommendations from this connected database.',
        };

        const result = await apiPost('/api/chat', {
          query: prompts[tabId] || prompts.descriptive,
          filters,
          usageType: 'chat',
        });

        const summary = [result?.answer, ...(Array.isArray(result?.insights) ? result.insights : [])]
          .filter(Boolean)
          .slice(0, 8);

        setData(prev => ({
          ...prev,
          [tabId]: {
            summary,
            provider: result?.provider || 'dataset-engine',
          },
        }));
        return;
      }

      const result = await apiGet(`/api/insights/${tabId}`, filters);
      setData(prev => ({ ...prev, [tabId]: result }));
    } catch (err) {
      console.error(`Failed to load ${tabId} insights:`, err);
    } finally {
      setLoading(prev => ({ ...prev, [tabId]: false }));
    }
  }, [filters]);

  useEffect(() => {
    fetchTab(activeTab);
  }, [activeTab, fetchTab]);

  useEffect(() => {
    if (filters?.useUserDb || filters?.datasetId) {
      setDataQuality(null);
      return;
    }
    apiGet('/api/data-quality', filters).then(setDataQuality).catch(() => {});
  }, [filters]);

  const handleExplore = async () => {
    setShowExploration(true);
    try {
      if (filters?.useUserDb || filters?.datasetId) {
        const result = await apiPost('/api/chat', {
          query: 'Find anomalies and unusual patterns in this connected database data.',
          filters,
          usageType: 'chat',
        });
        setExplorationData({
          anomalies: (result?.insights || []).map((text, idx) => ({
            id: `dataset-anomaly-${idx}`,
            type: 'trend',
            severity: 'info',
            description: text,
          })),
        });
        return;
      }

      const result = await apiGet('/api/explore', filters);
      setExplorationData(result);
    } catch (err) {
      console.error('Exploration failed:', err);
    }
  };

  const tabData = data[activeTab];
  const isLoading = loading[activeTab];

  return (
    <div className="insight-panel-v2">
      {/* Data Quality Badge */}
      {dataQuality && (
        <div className="data-quality-badge">
          <Shield size={14} />
          <span>Data Quality: {dataQuality.overallCompleteness}%</span>
          <div className="quality-bar">
            <div className="quality-fill" style={{ width: `${dataQuality.overallCompleteness}%` }} />
          </div>
          <span className={`quality-grade grade-${dataQuality.grade}`}>{dataQuality.grade}</span>
        </div>
      )}

      {/* Section Header */}
      <div className="section-header">
        <h2><Sparkles size={18} /> AI Insights</h2>
        <span>Live</span>
      </div>

      {/* Tab Navigation */}
      <div className="insight-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`insight-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={activeTab === tab.id ? { '--tab-color': tab.color } : {}}
          >
            <tab.icon size={14} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="insight-tab-content"
        >
          {isLoading ? (
            <div className="insight-loading">
              <div className="insight-loader-ring" />
              <p>Analyzing data...</p>
            </div>
          ) : tabData ? (
            <>
              {filters?.useUserDb || filters?.datasetId ? (
                <DatasetInsightTab data={tabData} />
              ) : (
                <>
                  {activeTab === 'descriptive' && <DescriptiveTab data={tabData} />}
                  {activeTab === 'diagnostic' && <DiagnosticTab data={tabData} />}
                  {activeTab === 'predictive' && <PredictiveTab data={tabData} />}
                  {activeTab === 'prescriptive' && <PrescriptiveTab data={tabData} />}
                </>
              )}
            </>
          ) : (
            <div className="insight-empty">
              <p>Click a tab to load insights</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Action Buttons */}
      <div className="insight-actions">
        <button className="insight-action-btn why-btn" onClick={() => setActiveTab('diagnostic')}>
          <HelpCircle size={14} />
          Why did this happen?
        </button>
        <button className="insight-action-btn explore-btn" onClick={handleExplore}>
          <SearchIcon size={14} />
          Explore Data
        </button>
      </div>

      {/* Exploration Panel */}
      <AnimatePresence>
        {showExploration && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="exploration-panel"
          >
            <div className="exploration-header">
              <h3><Activity size={16} /> Exploration Results</h3>
              <button className="icon-btn" onClick={() => setShowExploration(false)}>&times;</button>
            </div>
            {explorationData ? (
              <div className="anomaly-list">
                {explorationData.anomalies.length === 0 ? (
                  <p className="no-anomalies">No anomalies detected. Your data looks healthy! ✓</p>
                ) : (
                  explorationData.anomalies.slice(0, 6).map((a, i) => (
                    <div key={a.id || i} className={`anomaly-card severity-${a.severity}`}>
                      <div className="anomaly-icon">
                        {a.type === 'spike' && <ArrowUpRight size={14} />}
                        {a.type === 'drop' && <ArrowDownRight size={14} />}
                        {a.type === 'trend' && <TrendingUp size={14} />}
                        {a.type === 'risk' && <AlertTriangle size={14} />}
                      </div>
                      <div className="anomaly-body">
                        <p className="anomaly-desc">{a.description}</p>
                        {a.deviation && <span className="anomaly-badge">{a.deviation}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="insight-loading">
                <div className="insight-loader-ring" />
                <p>Scanning for anomalies...</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DatasetInsightTab({ data }) {
  const items = Array.isArray(data?.summary) ? data.summary : [];
  return (
    <div className="descriptive-content">
      <div className="insight-summary-list">
        {items.length > 0 ? items.map((s, i) => (
          <div key={i} className="insight-summary-item">
            <ChevronRight size={12} />
            <p>{s}</p>
          </div>
        )) : (
          <p className="insight-empty-text">No AI insight generated yet for connected database.</p>
        )}
      </div>
    </div>
  );
}

// ========== TAB COMPONENTS ==========

function DescriptiveTab({ data }) {
  if (!data) return null;
  return (
    <div className="descriptive-content">
      {/* Summary insights */}
      <div className="insight-summary-list">
        {(data.summary || []).map((s, i) => (
          <div key={i} className="insight-summary-item">
            <ChevronRight size={12} />
            <p>{s}</p>
          </div>
        ))}
      </div>

      {/* Stat cards */}
      {data.stats && (
        <div className="mini-stat-grid">
          <div className="mini-stat">
            <span className="mini-stat-label">Revenue</span>
            <span className="mini-stat-value">₹{Number(data.stats.totalRevenue || 0).toLocaleString('en-IN')}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-stat-label">Profit</span>
            <span className="mini-stat-value">₹{Number(data.stats.totalProfit || 0).toLocaleString('en-IN')}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-stat-label">Orders</span>
            <span className="mini-stat-value">{Number(data.stats.totalOrders || 0).toLocaleString('en-IN')}</span>
          </div>
          <div className="mini-stat">
            <span className="mini-stat-label">Margin</span>
            <span className="mini-stat-value">{data.profitMargin || 0}%</span>
          </div>
        </div>
      )}

      {/* Growth indicator */}
      {data.growthPct !== null && (
        <div className={`growth-indicator ${data.growthPct >= 0 ? 'positive' : 'negative'}`}>
          {data.growthPct >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          <span>{Math.abs(data.growthPct)}% {data.growthPct >= 0 ? 'growth' : 'decline'} vs previous month</span>
        </div>
      )}
    </div>
  );
}

function DiagnosticTab({ data }) {
  if (!data) return null;
  return (
    <div className="diagnostic-content">
      {/* Summary */}
      <div className="insight-summary-list">
        {(data.summary || []).map((s, i) => (
          <div key={i} className="insight-summary-item">
            <HelpCircle size={12} />
            <p>{s}</p>
          </div>
        ))}
      </div>

      {/* Category factors */}
      {data.categoryFactors && data.categoryFactors.length > 0 && (
        <div className="factors-section">
          <h4>Contributing Factors</h4>
          {data.categoryFactors.slice(0, 5).map((f, i) => (
            <div key={i} className="factor-row">
              <div className="factor-info">
                <span className="factor-name">{f.name}</span>
                <span className={`factor-change ${f.impact >= 0 ? 'positive' : 'negative'}`}>
                  {f.impact >= 0 ? '+' : ''}{f.changePct}%
                </span>
              </div>
              <div className="factor-bar-track">
                <div
                  className={`factor-bar-fill ${f.impact >= 0 ? 'positive' : 'negative'}`}
                  style={{ width: `${Math.min(100, Math.abs(f.changePct))}%` }}
                />
              </div>
              <span className="factor-impact">
                {f.impact >= 0 ? '+' : ''}₹{Number(f.impact).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictiveTab({ data }) {
  if (!data) return null;

  // Combine historical and forecast for the chart
  const chartData = [
    ...(data.historical || []).map(h => ({
      name: formatMonthLabel(h.month),
      actual: h.revenue,
      forecast: null,
    })),
    ...(data.forecast || []).map(f => ({
      name: formatMonthLabel(f.month),
      actual: null,
      forecast: f.revenue,
    })),
  ];

  // Bridge: add forecast start at last actual point
  if (data.historical?.length > 0 && data.forecast?.length > 0) {
    const lastActual = data.historical[data.historical.length - 1];
    const bridgeIdx = data.historical.length - 1;
    if (chartData[bridgeIdx]) {
      chartData[bridgeIdx].forecast = lastActual.revenue;
    }
  }

  return (
    <div className="predictive-content">
      {/* Summary */}
      <div className="insight-summary-list">
        {(data.summary || []).map((s, i) => (
          <div key={i} className="insight-summary-item">
            <TrendingUp size={12} />
            <p>{s}</p>
          </div>
        ))}
      </div>

      {/* Trend Badge */}
      {data.trend && (
        <div className={`trend-badge trend-${data.trend}`}>
          {data.trend === 'upward' && <ArrowUpRight size={14} />}
          {data.trend === 'downward' && <ArrowDownRight size={14} />}
          {data.trend === 'flat' && <Minus size={14} />}
          <span>Trend: {data.trend}</span>
        </div>
      )}

      {/* Forecast Chart */}
      {chartData.length > 0 && (
        <div className="forecast-chart-wrap">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <RechartsTooltip
                contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                formatter={(val) => val !== null ? [`₹${Number(val).toLocaleString('en-IN')}`, ''] : ['-', '']}
              />
              <Area type="monotone" dataKey="actual" stroke="#2563eb" fill="url(#actualGrad)" strokeWidth={2} connectNulls={false} dot={{ r: 3, fill: '#fff', stroke: '#2563eb', strokeWidth: 2 }} />
              <Area type="monotone" dataKey="forecast" stroke="#10b981" fill="url(#forecastGrad)" strokeWidth={2} strokeDasharray="6 3" connectNulls={false} dot={{ r: 3, fill: '#fff', stroke: '#10b981', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="chart-legend">
            <span className="legend-item"><span className="legend-dot actual" /> Actual</span>
            <span className="legend-item"><span className="legend-dot forecast" /> Forecast</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PrescriptiveTab({ data }) {
  if (!data) return null;
  const typeIcons = { growth: Target, cost: Shield, expansion: Layers, risk: AlertTriangle, optimization: Zap };
  const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

  return (
    <div className="prescriptive-content">
      {(data.recommendations || []).map((rec, i) => {
        const Icon = typeIcons[rec.type] || Lightbulb;
        return (
          <motion.div
            key={rec.id || i}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="recommendation-card"
          >
            <div className="rec-header">
              <div className="rec-icon" style={{ color: priorityColors[rec.priority] || '#6b7280' }}>
                <Icon size={16} />
              </div>
              <div className="rec-meta">
                <span className="rec-priority" style={{ color: priorityColors[rec.priority] }}>{rec.priority}</span>
                <span className="rec-type">{rec.type}</span>
              </div>
            </div>
            <h4 className="rec-title">{rec.title}</h4>
            <p className="rec-desc">{rec.description}</p>
            <div className="rec-impact">
              <Zap size={12} />
              Impact: {rec.impact}
            </div>
          </motion.div>
        );
      })}
      {(!data.recommendations || data.recommendations.length === 0) && (
        <p className="insight-empty-text">No recommendations yet. More data needed.</p>
      )}
    </div>
  );
}
