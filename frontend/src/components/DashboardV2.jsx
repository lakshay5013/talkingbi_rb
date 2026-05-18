import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Tooltip as RechartsTooltip, 
  XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer, Cell, AreaChart, Area
} from 'recharts';
import { 
  Lock, TrendingUp, Users, ShoppingCart, DollarSign, Download, Play, Pause, BarChart2, PieChart as PieIcon, Activity, AlertCircle
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { apiGet, apiPost } from '../api';

const monthMap = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

const formatMonthLabel = (monthValue) => {
  const key = String(monthValue || '').padStart(2, '0');
  return monthMap[key] || String(monthValue || 'NA');
};

const renderPieSliceLabel = ({ name, percent }) => {
  if (!percent || percent < 0.05) return '';
  return `${name}: ${(percent * 100).toFixed(0)}%`;
};

// Auto-counting number component
const AnimatedNumber = ({ value, prefix = "" }) => {
  const [displayValue, setDisplayValue] = useState(0);
  
  useEffect(() => {
    let startTimestamp = null;
    const duration = 1500;
    const startValue = displayValue;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.floor(easeProgress * (value - startValue) + startValue));
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }, [value]);

  return <span>{prefix}{displayValue.toLocaleString('en-IN')}</span>;
};

export default function DashboardV2({ plan, filters }) {
  const isPremium = plan === 'Premium';
  const isProMode = plan === 'Pro' || isPremium;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({
    kpis: { totalRevenue: 0, totalOrders: 0, averageOrderValue: 0, uniqueProducts: 0 },
    monthlyRevenue: [],
    categorySales: [],
    topStates: []
  });
  const [focusModeId, setFocusModeId] = useState(null);

  // Fetch real data from backend APIs
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // If an imported dataset is present, use dataset analysis via dataset APIs and /api/chat
        if (filters?.datasetId) {
          try {
            console.debug('[Reports] Detected datasetId:', filters.datasetId);
            const seriesFromResp = (r) => {
              if (!r) return [];
              if (Array.isArray(r.data)) return r.data;
              if (Array.isArray(r.rows)) return r.rows;
              if (Array.isArray(r.result)) return r.result;
              // sometimes API returns wrapped object
              if (Array.isArray(r?.data?.data)) return r.data.data;
              return [];
            };
            // KPIs from dataset
            const dsKpisResp = await apiGet('/api/datasets/kpis', { datasetId: filters.datasetId });
            console.debug('[Reports] /api/datasets/kpis response:', dsKpisResp);
            const kpis = dsKpisResp?.kpis || {};

            // Revenue trend via AI dataset analysis
            const trendResp = await apiPost('/api/chat', { query: 'Show revenue by month', filters: { datasetId: filters.datasetId }, usageType: 'dashboard_generation' });
            const categoryResp = await apiPost('/api/chat', { query: 'Show sales by category', filters: { datasetId: filters.datasetId }, usageType: 'dashboard_generation' });
            const regionResp = await apiPost('/api/chat', { query: 'Show revenue by state', filters: { datasetId: filters.datasetId }, usageType: 'dashboard_generation' });

            console.debug('[Reports] /api/chat trendResp:', trendResp);
            console.debug('[Reports] /api/chat categoryResp:', categoryResp);
            console.debug('[Reports] /api/chat regionResp:', regionResp);

            const monthlyRaw = seriesFromResp(trendResp);
            const monthlyRevenue = monthlyRaw.map(m => ({
              month: String(m.name).length === 7 && m.name.includes('-') ? formatMonthLabel(m.name.split('-')[1]) : String(m.name),
              revenue: Number(m.value || m.revenue || m[Object.keys(m)[1]] || 0),
            }));

            const categoryRaw = seriesFromResp(categoryResp);
            const categorySales = categoryRaw.map(c => ({ name: c.name, value: Number(c.value || c.revenue || 0) }));

            const regionRaw = seriesFromResp(regionResp);
            const topStates = regionRaw.map(s => ({ state: s.name || s.state || 'Unknown', revenue: Number(s.value || s.revenue || 0) }));

            setData({
              kpis: {
                totalRevenue: Number(kpis.totalRevenue || 0),
                totalOrders: Number(kpis.totalOrders || 0),
                averageOrderValue: Number(kpis.averageOrderValue || 0),
                uniqueProducts: Number(kpis.uniqueProducts || 0),
              },
              monthlyRevenue,
              categorySales,
              topStates,
            });
            if (cancelled) return;
            setLoading(false);
            return;
          } catch (dsErr) {
            // If dataset-based analysis fails, fall back to server dashboards
            console.warn('Dataset-driven dashboard failed, falling back to platform dashboards:', dsErr.message || dsErr);
          }
        }

        // Default/platform dataset path
        const [salesOverview, categoryAnalysis, regionalTrends] = await Promise.all([
          apiGet('/api/dashboards/sales-overview', filters),
          apiGet('/api/dashboards/category-analysis', filters),
          apiGet('/api/dashboards/regional-trends', filters),
        ]);

        if (cancelled) return;

        const kpis = salesOverview?.kpis || {};
        const monthlyRevenue = (salesOverview?.monthlyRevenue || []).map(m => ({
          month: formatMonthLabel(m.month),
          revenue: Number(m.revenue || 0),
        }));
        const categorySales = (categoryAnalysis?.categorySales || []).map(c => ({
          name: c.name,
          value: Number(c.value || 0),
        }));
        const topStates = (regionalTrends?.topStates || []).map(s => ({
          state: s.state,
          revenue: Number(s.revenue || 0),
        }));

        setData({
          kpis: {
            totalRevenue: Number(kpis.totalRevenue || 0),
            totalOrders: Number(kpis.totalOrders || 0),
            averageOrderValue: Number(kpis.averageOrderValue || 0),
            uniqueProducts: Number(kpis.uniqueProducts || 0),
          },
          monthlyRevenue,
          categorySales,
          topStates,
        });
      } catch (err) {
        if (!cancelled) {
          console.error('Dashboard fetch error:', err);
          setError('Failed to load dashboard data. Make sure the backend is running.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [filters]);

  const toggleFocus = (id) => {
     if (focusModeId === id) setFocusModeId(null);
     else setFocusModeId(id);
  };

  const getCardClass = (id) => {
    if (!focusModeId) return "bg-white border border-[#E5E7EB] shadow-[0_10px_30px_rgba(37,99,235,0.08)]";
    if (focusModeId === id) return "bg-white border border-[#BFDBFE] shadow-[0_16px_40px_rgba(37,99,235,0.14)] ring-1 ring-[#DBEAFE]";
    return "opacity-25 scale-[0.99] blur-[1px] pointer-events-none";
  };

  if (loading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto flex min-h-[400px] max-w-7xl flex-col items-center justify-center rounded-[28px] border border-[#E5E7EB] bg-white p-8 shadow-[0_10px_30px_rgba(37,99,235,0.08)]">
        <div className="loader-ring" style={{ width: 48, height: 48 }}></div>
        <p className="mt-4 text-sm font-medium text-[#6B7280]">Loading real-time dashboard data...</p>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto flex min-h-[400px] max-w-7xl flex-col items-center justify-center rounded-[28px] border border-[#FECACA] bg-white p-8 shadow-[0_10px_30px_rgba(37,99,235,0.08)]">
        <AlertCircle className="mb-4 h-12 w-12 text-[#EF4444]" />
        <p className="text-lg font-semibold text-[#111827]">{error}</p>
        <p className="mt-2 text-sm text-[#6B7280]">Check that backend server is running on port 3001</p>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mx-auto max-w-7xl space-y-8 rounded-[28px] border border-[#E5E7EB] bg-white p-6 pb-20 text-[#111827] shadow-[0_10px_30px_rgba(37,99,235,0.08)] md:p-8"
    >
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-[-0.03em] text-[#111827] md:text-4xl">
            Sales Cockpit <span className="rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1 text-xs font-semibold tracking-widest text-[#2563EB]">Live Data</span>
          </h1>
          <p className="mt-2 text-sm font-medium text-[#6B7280]">Real-time intelligence from Orders & Details datasets.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Revenue" value={data.kpis.totalRevenue} prefix="₹" icon={<DollarSign/>} delay={0.1} />
        <KpiCard title="Total Orders" value={data.kpis.totalOrders} icon={<ShoppingCart/>} delay={0.2} />
        <KpiCard title="Avg Order Value" value={data.kpis.averageOrderValue} prefix="₹" icon={<TrendingUp/>} delay={0.3} />
        <KpiCard title="Unique Products" value={data.kpis.uniqueProducts} icon={<Activity/>} delay={0.4} />
      </div>

      {/* Insight Section */}
      <InsightSection isPremium={isPremium} />

      {/* Main Charts Grid */}
      <div className="relative mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Background Overlay for Focus Mode */}
        <AnimatePresence>
          {focusModeId && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 pointer-events-none bg-[#F5F7FB]/80 backdrop-blur-sm"
            />
          )}
        </AnimatePresence>

        {/* Revenue Trend Chart */}
        <motion.div layout onClick={() => toggleFocus('revenue')} className={`group cursor-pointer overflow-hidden rounded-[24px] p-6 transition-all duration-500 ${getCardClass('revenue')}`}>
           <ChartHeader title="Revenue Velocity" />
           {data.monthlyRevenue.length > 0 ? (
             <ResponsiveContainer width="100%" height={300}>
               <AreaChart data={data.monthlyRevenue} margin={{top:10, right:30, left:0, bottom:0}}>
                 <defs>
                   <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.32}/>
                     <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.22)" />
                 <XAxis dataKey="month" stroke="#64748B" tickLine={false} axisLine={false} />
                 <YAxis stroke="#64748B" tickLine={false} axisLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                 <RechartsTooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius:'12px', color:'#111827', boxShadow: '0 12px 30px rgba(15,23,42,0.08)' }} formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Revenue']} />
                 <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
               </AreaChart>
             </ResponsiveContainer>
           ) : (
             <div className="flex h-[300px] items-center justify-center text-sm text-[#9CA3AF]">No monthly data available</div>
           )}
        </motion.div>

        {/* Categories Bar */}
        <motion.div layout onClick={() => toggleFocus('categories')} className={`group cursor-pointer overflow-hidden rounded-[24px] p-6 transition-all duration-500 ${getCardClass('categories')}`}>
           <ChartHeader title="Category Dominance" />
           {data.categorySales.length > 0 ? (
             <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.categorySales} margin={{top:20, right:30, left:0, bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.22)" />
                  <XAxis dataKey="name" stroke="#64748B" tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <RechartsTooltip cursor={{ fill: 'rgba(37,99,235,0.06)' }} contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius:'12px', color:'#111827', boxShadow: '0 12px 30px rgba(15,23,42,0.08)' }} formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Revenue']} />
                  <Bar dataKey="value" radius={[10,10,4,4]}>
                    {data.categorySales.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={['#3B82F6', '#60A5FA', '#2563EB', '#93C5FD', '#1D4ED8'][index%5]} />
                    ))}
                  </Bar>
                </BarChart>
             </ResponsiveContainer>
           ) : (
             <div className="flex h-[300px] items-center justify-center text-sm text-[#9CA3AF]">No category data available</div>
           )}
        </motion.div>
        
        {/* Regions Pie */}
        <motion.div layout onClick={() => toggleFocus('regions')} className={`group col-span-1 cursor-pointer overflow-hidden rounded-[24px] p-6 transition-all duration-500 lg:col-span-2 ${getCardClass('regions')}`}>
           <ChartHeader title="Regional Distribution" />
           {data.topStates.length > 0 ? (
             <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={data.topStates}
                    dataKey="revenue"
                    nameKey="state"
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={2}
                    labelLine={false}
                    label={renderPieSliceLabel}
                  >
                    {data.topStates.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#1D4ED8', '#0EA5E9', '#38BDF8', '#1E40AF', '#BFDBFE', '#2563EB'][index % 10]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #E5E7EB', borderRadius:'12px', color:'#111827', boxShadow: '0 12px 30px rgba(15,23,42,0.08)' }} formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Revenue']} />
                  <Legend verticalAlign="bottom" height={28} formatter={(value) => <span style={{ color: '#334155' }}>{value}</span>} />
                </PieChart>
             </ResponsiveContainer>
           ) : (
             <div className="flex h-[350px] items-center justify-center text-sm text-[#9CA3AF]">No regional data available</div>
           )}
        </motion.div>
      </div>

    </motion.div>
  );
}

const ChartHeader = ({ title }) => (
  <div className="mb-5 flex items-center justify-between">
    <h3 className="text-lg font-bold tracking-[-0.01em] text-[#111827]">{title}</h3>
  </div>
);

const KpiCard = ({ title, value, prefix, icon, delay }) => (
  <motion.div 
    initial={{ opacity: 0, y: 30 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, delay, type: "spring" }}
    className="group relative overflow-hidden rounded-[24px] border border-[#E5E7EB] bg-white p-6 text-[#111827] shadow-[0_10px_30px_rgba(37,99,235,0.08)]"
  >
    <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#DBEAFE] blur-[30px] transition-colors duration-500 group-hover:bg-[#BFDBFE]" />
    
    <div className="relative z-10 mb-6 flex items-center justify-between text-[#6B7280]">
      <span className="text-sm font-semibold uppercase tracking-[0.08em]">{title}</span>
      <div className="rounded-xl bg-[#EFF6FF] p-2.5 text-[#2563EB] transition-colors group-hover:bg-[#DBEAFE]">{icon}</div>
    </div>
    <div className="relative z-10 text-4xl font-black tracking-tight text-[#111827]">
      <AnimatedNumber value={value} prefix={prefix} />
    </div>
  </motion.div>
);

const InsightSection = ({ isPremium }) => (
  <motion.div 
    initial={{ opacity: 0, scale: 0.98 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay: 0.5, duration: 0.8 }}
    className={`relative overflow-hidden rounded-[24px] border border-[#BFDBFE] bg-[rgba(219,234,254,0.22)] p-8 ${!isPremium ? 'select-none' : ''}`}
  >
    <div className="absolute inset-x-0 -top-px h-px w-full bg-gradient-to-r from-transparent via-[#60A5FA] to-transparent opacity-50" />
    <h3 className="mb-4 flex items-center gap-2 text-2xl font-bold text-[#111827]">
      <SparkleIcon /> Priority AI Insights
    </h3>
    <div className="space-y-3">
      <p className="text-lg text-[#6B7280]">→ Use the <span className="rounded bg-[#EFF6FF] px-2 py-0.5 font-bold text-[#2563EB]">Chat Assistant</span> to ask about trends, predictions, and data analysis.</p>
      <p className="text-lg text-[#6B7280]">→ Try: <span className="rounded bg-[#EFF6FF] px-2 py-0.5 font-bold text-[#2563EB]">"What trends do you see?"</span> or <span className="rounded bg-[#EFF6FF] px-2 py-0.5 font-bold text-[#2563EB]">"Which category should I invest in?"</span></p>
    </div>
    
    {!isPremium && (
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none">
        <div className="scale-110 rounded-2xl border border-[#BFDBFE] bg-white p-6 text-center shadow-2xl">
          <Lock className="mx-auto mb-3 h-10 w-10 animate-pulse text-[#2563EB]/50" />
          <h4 className="mb-1 text-xl font-bold text-[#111827]">Premium Insight Hidden</h4>
          <p className="text-sm text-[#6B7280]">Upgrade to unlock predictive forecasting.</p>
        </div>
      </div>
    )}
  </motion.div>
);

const SparkleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400"><path d="M12 3v18"/><path d="m5 8 14 8"/><path d="m19 8-14 8"/></svg>
);


