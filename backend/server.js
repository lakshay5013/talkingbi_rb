require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { saasRouter, optionalAuth, applyUsagePolicy, getDatasetAnalytics, getUserDbAnalytics, prisma } = require('./src/saas');
const { runUnifiedAgent } = require('./src/unifiedQueryAgent');

const app = express();
const port = process.env.PORT || 3001;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

app.use(cors());
app.use(express.json());
app.use(optionalAuth);
app.use('/api', saasRouter);

// Request logging
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// ==========================================
// HELPERS
// ==========================================
const queryDB = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// ==========================================
// LRU QUERY CACHE (in-memory)
// ==========================================
class QueryCache {
    constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }
    _key(sql, params) {
        return JSON.stringify({ sql, params });
    }
    get(sql, params) {
        const k = this._key(sql, params);
        const entry = this.cache.get(k);
        if (!entry) return null;
        if (Date.now() - entry.ts > this.ttlMs) {
            this.cache.delete(k);
            return null;
        }
        // Move to end (most recent)
        this.cache.delete(k);
        this.cache.set(k, entry);
        return entry.data;
    }
    set(sql, params, data) {
        const k = this._key(sql, params);
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(k, { data, ts: Date.now() });
    }
}
const cache = new QueryCache();

const cachedQuery = async (sql, params = []) => {
    const cached = cache.get(sql, params);
    if (cached) return cached;
    const result = await queryDB(sql, params);
    cache.set(sql, params, result);
    return result;
};

// ==========================================
// CONTEXT-AWARE CHAT SESSIONS
// ==========================================
const chatSessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 min

function getSession(sessionId) {
    if (!sessionId) return { context: {} };
    let session = chatSessions.get(sessionId);
    if (!session || Date.now() - session.lastUsed > SESSION_TTL) {
        session = { context: {}, lastUsed: Date.now() };
        chatSessions.set(sessionId, session);
    }
    session.lastUsed = Date.now();
    return session;
}

// Cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, sess] of chatSessions.entries()) {
        if (now - sess.lastUsed > SESSION_TTL) chatSessions.delete(id);
    }
}, 5 * 60 * 1000);

// ==========================================
// FILTER HELPERS
// ==========================================
const getMonthsForDateRange = (dateRange) => {
    switch (dateRange) {
        case 'Last 7 days': return ['12'];
        case 'Last 30 days': return ['11', '12'];
        case 'This quarter': return ['10', '11', '12'];
        case 'This year': return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
        default: return [];
    }
};

const buildFilterClauses = (filters = {}) => {
    const clauses = [];
    const params = [];
    if (filters.category && filters.category !== 'All categories') {
        clauses.push('Category = ?');
        params.push(filters.category);
    }
    if (filters.region && filters.region !== 'All regions') {
        clauses.push('Ship_State = ?');
        params.push(filters.region);
    }
    if (filters.months && filters.months.length > 0) {
        clauses.push(`Month IN (${filters.months.map(() => '?').join(', ')})`);
        params.push(...filters.months);
    } else {
        const months = getMonthsForDateRange(filters.dateRange);
        if (months.length > 0) {
            clauses.push(`Month IN (${months.map(() => '?').join(', ')})`);
            params.push(...months);
        }
    }
    return { clauses, params };
};

const buildWhere = (filters = {}, baseClauses = [], baseParams = []) => {
    const { clauses, params } = buildFilterClauses(filters);
    const allClauses = [...baseClauses, ...clauses];
    return {
        whereSql: allClauses.length > 0 ? `WHERE ${allClauses.join(' AND ')}` : '',
        params: [...baseParams, ...params],
    };
};

// ==========================================
// DASHBOARD APIs (unchanged)
// ==========================================
app.get('/api/dashboards/sales-overview', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query);
        const kpis = await cachedQuery(`
            SELECT 
                ROUND(COALESCE(SUM(Amount), 0), 2) as totalRevenue,
                COUNT(Order_ID) as totalOrders,
                ROUND(COALESCE(AVG(Amount), 0), 2) as averageOrderValue,
                COUNT(DISTINCT CASE WHEN Category != '' THEN Category || '-' || Sub_Category ELSE NULL END) as uniqueProducts
            FROM orders
            ${whereSql}
        `, params);

        const monthWhere = buildWhere(req.query, ["Month != ''"]);
        const monthlyRevenue = await cachedQuery(`
            SELECT 
                Month as month,
                ROUND(COALESCE(SUM(Amount), 0), 2) as revenue
            FROM orders
            ${monthWhere.whereSql}
            GROUP BY month
            ORDER BY month ASC
        `, monthWhere.params);

        res.json({ kpis: kpis[0], monthlyRevenue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboards/category-analysis', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query, ["Category != ''"]);
        const categorySales = await cachedQuery(`
            SELECT 
                Category as name, 
                ROUND(COALESCE(SUM(Amount), 0), 2) as value
            FROM orders 
            ${whereSql}
            GROUP BY Category
            ORDER BY value DESC
            LIMIT 10
        `, params);
        res.json({ categorySales });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboards/customer-insights', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query);
        const b2bSplit = await cachedQuery(`
            SELECT 
                CASE WHEN B2B = 'True' THEN 'B2B' ELSE 'B2C' END as customerType,
                ROUND(COALESCE(SUM(Amount), 0), 2) as revenue
            FROM orders 
            ${whereSql}
            GROUP BY customerType
        `, params);
        res.json({ b2bSplit });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboards/regional-trends', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query, ["Ship_State != ''"]);
        const topStates = await cachedQuery(`
            SELECT 
                Ship_State as state, 
                ROUND(COALESCE(SUM(Amount), 0), 2) as revenue,
                COUNT(DISTINCT CustomerName) as customerCount
            FROM orders 
            ${whereSql}
            GROUP BY Ship_State
            ORDER BY revenue DESC
            LIMIT 10
        `, params);
        res.json({ topStates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// MULTI-LEVEL INSIGHT ENGINE
// ==========================================

// 1. DESCRIPTIVE — "What happened?"
app.get('/api/insights/descriptive', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query);
        const catWhere = buildWhere(req.query, ["Category != ''"]);
        const stateWhere = buildWhere(req.query, ["Ship_State != ''"]);
        const monthWhere = buildWhere(req.query, ["Month != ''"]);

        const [totals, topCategories, topStates, monthlyTrend] = await Promise.all([
            cachedQuery(`SELECT 
                ROUND(COALESCE(SUM(Amount), 0), 2) as totalRevenue,
                ROUND(COALESCE(SUM(Profit), 0), 2) as totalProfit,
                COUNT(Order_ID) as totalOrders,
                ROUND(COALESCE(AVG(Amount), 0), 2) as avgOrderValue,
                SUM(Qty) as totalQty
            FROM orders ${whereSql}`, params),

            cachedQuery(`SELECT Category as name, ROUND(SUM(Amount), 2) as value, ROUND(SUM(Profit), 2) as profit
                FROM orders ${catWhere.whereSql} GROUP BY Category ORDER BY value DESC LIMIT 5`, catWhere.params),

            cachedQuery(`SELECT Ship_State as name, ROUND(SUM(Amount), 2) as value
                FROM orders ${stateWhere.whereSql} GROUP BY Ship_State ORDER BY value DESC LIMIT 5`, stateWhere.params),

            cachedQuery(`SELECT Month as month, ROUND(SUM(Amount), 2) as revenue, ROUND(SUM(Profit), 2) as profit
                FROM orders ${monthWhere.whereSql} GROUP BY Month ORDER BY Month ASC`, monthWhere.params),
        ]);

        const stats = totals[0] || {};
        const profitMargin = stats.totalRevenue > 0 ? ((stats.totalProfit / stats.totalRevenue) * 100).toFixed(1) : 0;

        // Calculate growth from monthly trend
        let growthPct = null;
        if (monthlyTrend.length >= 2) {
            const last = monthlyTrend[monthlyTrend.length - 1].revenue;
            const prev = monthlyTrend[monthlyTrend.length - 2].revenue;
            if (prev > 0) growthPct = (((last - prev) / prev) * 100).toFixed(1);
        }

        const insights = [];
        insights.push(`Total revenue is ₹${Number(stats.totalRevenue).toLocaleString('en-IN')} across ${Number(stats.totalOrders).toLocaleString('en-IN')} orders.`);
        if (growthPct !== null) {
            const dir = Number(growthPct) >= 0 ? 'increased' : 'decreased';
            insights.push(`Sales ${dir} by ${Math.abs(growthPct)}% compared to the previous month.`);
        }
        insights.push(`Average order value is ₹${Number(stats.avgOrderValue).toLocaleString('en-IN')} with a ${profitMargin}% profit margin.`);
        if (topCategories.length > 0) {
            insights.push(`Top category: ${topCategories[0].name} contributing ₹${Number(topCategories[0].value).toLocaleString('en-IN')}.`);
        }
        if (topStates.length > 0) {
            insights.push(`Leading region: ${topStates[0].name} with ₹${Number(topStates[0].value).toLocaleString('en-IN')} in sales.`);
        }

        res.json({
            type: 'descriptive',
            summary: insights,
            stats,
            topCategories,
            topStates,
            monthlyTrend,
            growthPct: growthPct !== null ? Number(growthPct) : null,
            profitMargin: Number(profitMargin),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. DIAGNOSTIC — "Why did this happen?"
app.get('/api/insights/diagnostic', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query, ["Month != ''"]);

        // Monthly revenue to find changes
        const monthly = await cachedQuery(`
            SELECT Month as month, ROUND(SUM(Amount), 2) as revenue, ROUND(SUM(Profit), 2) as profit
            FROM orders ${whereSql} GROUP BY Month ORDER BY Month ASC
        `, params);

        if (monthly.length < 2) {
            return res.json({
                type: 'diagnostic',
                summary: ['Insufficient data for diagnostic analysis. Need at least 2 months of data.'],
                factors: [],
            });
        }

        const lastMonth = monthly[monthly.length - 1];
        const prevMonth = monthly[monthly.length - 2];
        const change = lastMonth.revenue - prevMonth.revenue;
        const changePct = prevMonth.revenue > 0 ? ((change / prevMonth.revenue) * 100).toFixed(1) : 0;

        // Category-level breakdown for both months to find drivers
        const catBreakdown = await cachedQuery(`
            SELECT Month, Category as name, ROUND(SUM(Amount), 2) as value
            FROM orders WHERE Category != '' AND Month IN (?, ?)
            GROUP BY Month, Category ORDER BY value DESC
        `, [prevMonth.month, lastMonth.month]);

        const prevCats = {};
        const currCats = {};
        for (const row of catBreakdown) {
            if (row.Month === prevMonth.month) prevCats[row.name] = row.value;
            else currCats[row.name] = row.value;
        }

        const allCatNames = [...new Set([...Object.keys(prevCats), ...Object.keys(currCats)])];
        const factors = allCatNames.map(name => {
            const prev = prevCats[name] || 0;
            const curr = currCats[name] || 0;
            const impact = curr - prev;
            const pct = prev > 0 ? (((curr - prev) / prev) * 100).toFixed(1) : (curr > 0 ? 100 : 0);
            return { name, previousValue: prev, currentValue: curr, impact, changePct: Number(pct) };
        }).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

        // State-level contributing factors
        const stateBreakdown = await cachedQuery(`
            SELECT Month, Ship_State as name, ROUND(SUM(Amount), 2) as value
            FROM orders WHERE Ship_State != '' AND Month IN (?, ?)
            GROUP BY Month, Ship_State ORDER BY value DESC
        `, [prevMonth.month, lastMonth.month]);

        const prevStates = {};
        const currStates = {};
        for (const row of stateBreakdown) {
            if (row.Month === prevMonth.month) prevStates[row.name] = row.value;
            else currStates[row.name] = row.value;
        }

        const stateFactors = [...new Set([...Object.keys(prevStates), ...Object.keys(currStates)])]
            .map(name => {
                const prev = prevStates[name] || 0;
                const curr = currStates[name] || 0;
                return { name, previousValue: prev, currentValue: curr, impact: curr - prev, changePct: prev > 0 ? Number((((curr - prev) / prev) * 100).toFixed(1)) : 0 };
            })
            .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
            .slice(0, 5);

        const direction = change >= 0 ? 'increased' : 'decreased';
        const insights = [];
        insights.push(`Revenue ${direction} by ${Math.abs(changePct)}% (₹${Math.abs(change).toLocaleString('en-IN')}) from month ${prevMonth.month} to ${lastMonth.month}.`);

        if (factors.length > 0) {
            const topDriver = factors[0];
            const driverDir = topDriver.impact >= 0 ? 'growth' : 'decline';
            insights.push(`Largest contributor: ${topDriver.name} category with ₹${Math.abs(topDriver.impact).toLocaleString('en-IN')} ${driverDir}.`);
        }
        if (factors.length > 1) {
            insights.push(`Second factor: ${factors[1].name} category (${factors[1].changePct >= 0 ? '+' : ''}${factors[1].changePct}%).`);
        }
        if (stateFactors.length > 0) {
            const topState = stateFactors[0];
            insights.push(`Regional driver: ${topState.name} contributed ₹${Math.abs(topState.impact).toLocaleString('en-IN')} in ${topState.impact >= 0 ? 'growth' : 'decline'}.`);
        }

        res.json({
            type: 'diagnostic',
            summary: insights,
            overallChange: { from: prevMonth.revenue, to: lastMonth.revenue, change, changePct: Number(changePct) },
            categoryFactors: factors,
            regionFactors: stateFactors,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. PREDICTIVE — "What will happen?"
app.get('/api/insights/predictive', async (req, res) => {
    try {
        const { whereSql, params } = buildWhere(req.query, ["Month != ''"]);
        const monthly = await cachedQuery(`
            SELECT Month as month, ROUND(SUM(Amount), 2) as revenue, ROUND(SUM(Profit), 2) as profit, COUNT(*) as orders
            FROM orders ${whereSql} GROUP BY Month ORDER BY Month ASC
        `, params);

        if (monthly.length < 3) {
            return res.json({
                type: 'predictive',
                summary: ['Not enough data for prediction. Need at least 3 months.'],
                historical: monthly, forecast: [],
            });
        }

        // Simple linear regression on monthly revenue
        const n = monthly.length;
        const xs = monthly.map((_, i) => i + 1);
        const ys = monthly.map(m => m.revenue);
        const sumX = xs.reduce((a, b) => a + b, 0);
        const sumY = ys.reduce((a, b) => a + b, 0);
        const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
        const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Forecast next 3 months
        const monthNames = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
        const lastMonthIdx = monthNames.indexOf(monthly[monthly.length - 1].month);
        const forecast = [];
        for (let i = 1; i <= 3; i++) {
            const x = n + i;
            const predicted = Math.max(0, Math.round((slope * x + intercept) * 100) / 100);
            const futureMonthIdx = (lastMonthIdx + i) % 12;
            forecast.push({
                month: monthNames[futureMonthIdx],
                revenue: predicted,
                type: 'forecast',
            });
        }

        // Calculate trend direction and growth
        const avgGrowth = monthly.length >= 2
            ? ((monthly[monthly.length - 1].revenue - monthly[0].revenue) / monthly[0].revenue * 100 / (monthly.length - 1)).toFixed(1)
            : 0;

        const trend = slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'flat';
        const insights = [];
        insights.push(`The overall trend is ${trend} with an average monthly growth of ${avgGrowth}%.`);
        insights.push(`Predicted revenue for next month: ₹${Number(forecast[0].revenue).toLocaleString('en-IN')}.`);
        if (forecast.length >= 3) {
            insights.push(`3-month forecast shows revenue reaching ₹${Number(forecast[2].revenue).toLocaleString('en-IN')}.`);
        }
        insights.push(`Based on linear regression across ${n} data points.`);

        res.json({
            type: 'predictive',
            summary: insights,
            historical: monthly.map(m => ({ ...m, type: 'actual' })),
            forecast,
            trend,
            slope: Math.round(slope * 100) / 100,
            avgMonthlyGrowth: Number(avgGrowth),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. PRESCRIPTIVE — "What to do?"
app.get('/api/insights/prescriptive', async (req, res) => {
    try {
        const catWhere = buildWhere(req.query, ["Category != ''"]);
        const stateWhere = buildWhere(req.query, ["Ship_State != ''"]);
        const monthWhere = buildWhere(req.query, ["Month != ''"]);

        const [categories, states, monthly] = await Promise.all([
            cachedQuery(`SELECT Category as name, ROUND(SUM(Amount), 2) as revenue, ROUND(SUM(Profit), 2) as profit, SUM(Qty) as qty
                FROM orders ${catWhere.whereSql} GROUP BY Category ORDER BY revenue DESC`, catWhere.params),
            cachedQuery(`SELECT Ship_State as name, ROUND(SUM(Amount), 2) as revenue, ROUND(SUM(Profit), 2) as profit
                FROM orders ${stateWhere.whereSql} GROUP BY Ship_State ORDER BY revenue DESC`, stateWhere.params),
            cachedQuery(`SELECT Month, Category, ROUND(SUM(Amount), 2) as revenue
                FROM orders ${monthWhere.whereSql} AND Category != '' GROUP BY Month, Category ORDER BY Month ASC`, monthWhere.params),
        ]);

        const recommendations = [];

        // Rule 1: Focus on top-performing category
        if (categories.length > 0) {
            const top = categories[0];
            const totalRev = categories.reduce((s, c) => s + c.revenue, 0);
            const share = ((top.revenue / totalRev) * 100).toFixed(0);
            recommendations.push({
                id: 'top-category',
                priority: 'high',
                title: `Double down on ${top.name}`,
                description: `${top.name} dominates with ${share}% of total revenue (₹${Number(top.revenue).toLocaleString('en-IN')}). Increase inventory and marketing spend here.`,
                impact: 'high',
                type: 'growth',
            });
        }

        // Rule 2: Address low-profit categories
        const lowProfit = categories.filter(c => c.profit < 0 || (c.revenue > 0 && c.profit / c.revenue < 0.05));
        if (lowProfit.length > 0) {
            recommendations.push({
                id: 'low-profit',
                priority: 'high',
                title: `Review pricing for ${lowProfit.map(c => c.name).join(', ')}`,
                description: `These categories have very low or negative profit margins. Consider price adjustments or cost reduction.`,
                impact: 'high',
                type: 'cost',
            });
        }

        // Rule 3: Underperforming regions
        if (states.length >= 3) {
            const bottomStates = states.slice(-3);
            recommendations.push({
                id: 'weak-regions',
                priority: 'medium',
                title: `Boost presence in underperforming regions`,
                description: `${bottomStates.map(s => s.name).join(', ')} are the weakest regions. Consider targeted campaigns or logistics improvements.`,
                impact: 'medium',
                type: 'expansion',
            });
        }

        // Rule 4: Top region opportunity
        if (states.length > 0) {
            recommendations.push({
                id: 'top-region',
                priority: 'medium',
                title: `Expand in ${states[0].name}`,
                description: `${states[0].name} leads with ₹${Number(states[0].revenue).toLocaleString('en-IN')} revenue. Deepen market penetration with additional product lines.`,
                impact: 'medium',
                type: 'growth',
            });
        }

        // Rule 5: Detect declining categories from monthly trends
        if (monthly.length > 0) {
            const catMonthly = {};
            monthly.forEach(r => {
                if (!catMonthly[r.Category]) catMonthly[r.Category] = [];
                catMonthly[r.Category].push(r);
            });
            for (const [cat, months] of Object.entries(catMonthly)) {
                if (months.length >= 2) {
                    const last = months[months.length - 1].revenue;
                    const prev = months[months.length - 2].revenue;
                    if (last < prev * 0.7) { // 30%+ decline
                        recommendations.push({
                            id: `declining-${cat}`,
                            priority: 'high',
                            title: `Investigate decline in ${cat}`,
                            description: `${cat} revenue dropped significantly. Consider promotional offers or investigating supply issues.`,
                            impact: 'high',
                            type: 'risk',
                        });
                    }
                }
            }
        }

        // Rule 6: Average order value optimization
        if (categories.length > 0) {
            const avgQty = categories.reduce((s, c) => s + c.qty, 0) / categories.length;
            const lowQtyCats = categories.filter(c => c.qty < avgQty * 0.5);
            if (lowQtyCats.length > 0) {
                recommendations.push({
                    id: 'bundle-opportunity',
                    priority: 'low',
                    title: 'Create bundle offers',
                    description: `${lowQtyCats.map(c => c.name).join(', ')} have low quantity per order. Bundle promotions could increase average order value.`,
                    impact: 'medium',
                    type: 'optimization',
                });
            }
        }

        res.json({
            type: 'prescriptive',
            summary: recommendations.slice(0, 3).map(r => r.description),
            recommendations,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// EXPLORATION / ANOMALY DETECTION
// ==========================================
app.get('/api/explore', async (req, res) => {
    try {
        const monthWhere = buildWhere(req.query, ["Month != ''"]);
        const catWhere = buildWhere(req.query, ["Category != ''", "Month != ''"]);

        const [monthlyData, categoryMonthly] = await Promise.all([
            cachedQuery(`SELECT Month as month, ROUND(SUM(Amount), 2) as revenue, ROUND(SUM(Profit), 2) as profit, COUNT(*) as orders
                FROM orders ${monthWhere.whereSql} GROUP BY Month ORDER BY Month ASC`, monthWhere.params),
            cachedQuery(`SELECT Month, Category as name, ROUND(SUM(Amount), 2) as value
                FROM orders ${catWhere.whereSql} GROUP BY Month, Category ORDER BY Month ASC`, catWhere.params),
        ]);

        const anomalies = [];

        // Z-score anomaly detection on monthly revenue
        if (monthlyData.length >= 3) {
            const values = monthlyData.map(m => m.revenue);
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
            const monthMap = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec' };

            if (stdDev > 0) {
                monthlyData.forEach(m => {
                    const zScore = (m.revenue - mean) / stdDev;
                    if (Math.abs(zScore) > 1.5) {
                        const type = zScore > 0 ? 'spike' : 'drop';
                        anomalies.push({
                            id: `revenue-${m.month}`,
                            type,
                            severity: Math.abs(zScore) > 2 ? 'high' : 'medium',
                            metric: 'revenue',
                            period: monthMap[m.month] || m.month,
                            value: m.revenue,
                            expected: Math.round(mean),
                            deviation: `${(Math.abs(zScore) * 100 / 100).toFixed(1)}σ`,
                            description: `${type === 'spike' ? 'Spike' : 'Drop'} detected in ${monthMap[m.month] || m.month}: ₹${Number(m.revenue).toLocaleString('en-IN')} vs average ₹${Number(Math.round(mean)).toLocaleString('en-IN')}`,
                        });
                    }
                });
            }
        }

        // Category-level anomaly detection
        const catByMonth = {};
        categoryMonthly.forEach(r => {
            if (!catByMonth[r.name]) catByMonth[r.name] = [];
            catByMonth[r.name].push({ month: r.Month, value: r.value });
        });

        for (const [cat, data] of Object.entries(catByMonth)) {
            if (data.length >= 3) {
                const vals = data.map(d => d.value);
                const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
                const monthMap = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec' };

                if (stdDev > 0) {
                    data.forEach(d => {
                        const z = (d.value - mean) / stdDev;
                        if (Math.abs(z) > 1.8) {
                            anomalies.push({
                                id: `${cat}-${d.month}`,
                                type: z > 0 ? 'spike' : 'drop',
                                severity: Math.abs(z) > 2.5 ? 'high' : 'medium',
                                metric: 'category_revenue',
                                category: cat,
                                period: monthMap[d.month] || d.month,
                                value: d.value,
                                expected: Math.round(mean),
                                deviation: `${Math.abs(z).toFixed(1)}σ`,
                                description: `${cat} shows unusual ${z > 0 ? 'growth' : 'decline'} in ${monthMap[d.month] || d.month}: ₹${Number(d.value).toLocaleString('en-IN')}`,
                            });
                        }
                    });
                }
            }

            // Trend detection: consistent growth or decline
            if (data.length >= 3) {
                let increasing = 0, decreasing = 0;
                for (let i = 1; i < data.length; i++) {
                    if (data[i].value > data[i - 1].value) increasing++;
                    else if (data[i].value < data[i - 1].value) decreasing++;
                }
                if (increasing >= data.length - 1) {
                    anomalies.push({
                        id: `trend-up-${cat}`,
                        type: 'trend',
                        severity: 'info',
                        metric: 'category_trend',
                        category: cat,
                        description: `${cat} shows consistent upward trend across ${data.length} months.`,
                    });
                } else if (decreasing >= data.length - 1) {
                    anomalies.push({
                        id: `trend-down-${cat}`,
                        type: 'trend',
                        severity: 'warning',
                        metric: 'category_trend',
                        category: cat,
                        description: `${cat} shows consistent downward trend. Needs attention.`,
                    });
                }
            }
        }

        // Profit anomaly: negative profit check
        const profitCheck = await cachedQuery(`
            SELECT Category as name, ROUND(SUM(Profit), 2) as profit, ROUND(SUM(Amount), 2) as revenue
            FROM orders WHERE Category != '' GROUP BY Category HAVING profit < 0
        `);
        profitCheck.forEach(c => {
            anomalies.push({
                id: `negative-profit-${c.name}`,
                type: 'risk',
                severity: 'high',
                metric: 'profit',
                category: c.name,
                description: `${c.name} has negative profit (₹${Number(c.profit).toLocaleString('en-IN')}) despite ₹${Number(c.revenue).toLocaleString('en-IN')} in revenue.`,
            });
        });

        res.json({
            type: 'exploration',
            anomalies: anomalies.sort((a, b) => {
                const sev = { high: 0, warning: 1, medium: 2, info: 3 };
                return (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4);
            }),
            totalAnomalies: anomalies.length,
            monthlyData,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// DATA QUALITY INDICATOR
// ==========================================
app.get('/api/data-quality', async (req, res) => {
    try {
        const total = await cachedQuery('SELECT COUNT(*) as cnt FROM orders');
        const totalRows = total[0].cnt;
        const columns = ['Order_ID', 'Date', 'Month', 'CustomerName', 'Ship_State', 'Ship_City', 'Category', 'Sub_Category', 'Amount', 'Profit', 'PaymentMode'];
        const quality = {};
        let totalFilled = 0;
        let totalCells = 0;

        for (const col of columns) {
            const missing = await cachedQuery(`SELECT COUNT(*) as cnt FROM orders WHERE ${col} IS NULL OR TRIM(${col}) = ''`);
            const filled = totalRows - missing[0].cnt;
            quality[col] = {
                total: totalRows,
                filled,
                missing: missing[0].cnt,
                completeness: totalRows > 0 ? Math.round((filled / totalRows) * 100) : 0,
            };
            totalFilled += filled;
            totalCells += totalRows;
        }

        const overallCompleteness = totalCells > 0 ? Math.round((totalFilled / totalCells) * 100) : 0;

        res.json({
            overallCompleteness,
            totalRows,
            columns: quality,
            grade: overallCompleteness >= 95 ? 'A' : overallCompleteness >= 85 ? 'B' : overallCompleteness >= 70 ? 'C' : 'D',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// SMART QUERY ENGINE (NLP Parser + SQL Gen)
// ==========================================
function parseQuery(rawQuery, sessionContext = {}) {
    const q = String(rawQuery || '')
        .toLowerCase()
        .replace(/[?.,!]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const normalizedQ = q
        .replace(/sabse\s+kam/g, 'least')
        .replace(/sabse\s+zyada/g, 'top')
        .replace(/most\s+least/g, 'least');

    const followUpHint = /\b(this|that|same|again|also|it|those|them|above|previous|continue|as well)\b/.test(normalizedQ);
    const parsed = followUpHint ? { ...sessionContext } : {};

    // Metric detection
    if (normalizedQ.match(/\b(sales?|revenue|revenu|revnue|revensue|amount|earning|earnings|gmv)\b/)) parsed.metric = 'sales';
    else if (normalizedQ.match(/\b(profit|margin|earning)\b/)) parsed.metric = 'profit';
    else if (normalizedQ.match(/\b(order|orders|order count)\b/)) parsed.metric = 'orders';
    else if (normalizedQ.match(/\b(quantity|qty|units)\b/)) parsed.metric = 'quantity';
    else if (normalizedQ.match(/\b(aov|average order)\b/)) parsed.metric = 'aov';
    else if (normalizedQ.match(/\b(customer|customers|customer count|distinct customer|count of customer)\b/)) parsed.metric = 'customers';

    // Common phrasing like "products sold" should map to quantity intent.
    if (!parsed.metric && normalizedQ.match(/\bsold\b|\bselling\b/)) {
        parsed.metric = normalizedQ.match(/\bproduct|item|sku|sub.?categor/)
            ? 'quantity'
            : 'orders';
    }

    // Category detection
    if (normalizedQ.match(/\belectronics?\b/)) parsed.category = 'Electronics';
    else if (normalizedQ.match(/\bclothing\b|clothes\b|apparel\b|fashion\b/)) parsed.category = 'Clothing';
    else if (normalizedQ.match(/\bfurniture\b/)) parsed.category = 'Furniture';
    else if (normalizedQ.match(/\ball\s*categor/)) parsed.category = 'All categories';

    // Specific month detection
    const monthMap = {
        'january': '01', 'jan': '01',
        'february': '02', 'feb': '02',
        'march': '03', 'mar': '03',
        'april': '04', 'apr': '04',
        'may': '05',
        'june': '06', 'jun': '06',
        'july': '07', 'jul': '07',
        'august': '08', 'aug': '08',
        'september': '09', 'sep': '09',
        'october': '10', 'oct': '10',
        'november': '11', 'nov': '11',
        'december': '12', 'dec': '12'
    };
    const foundMonths = [];
    Object.keys(monthMap).forEach(m => {
        if (new RegExp(`\\b${m}\\b`).test(normalizedQ)) {
            if (!foundMonths.includes(monthMap[m])) foundMonths.push(monthMap[m]);
        }
    });
    if (foundMonths.length > 0) parsed.months = foundMonths;

    // Time range detection
    if (normalizedQ.match(/\blast\s*(1\s*)?year\b|past\s*year\b|last\s*one\s*year\b|12\s*months?\b|full\s*year\b|yearly\b|annual\b/)) parsed.time_range = 'year';
    else if (normalizedQ.match(/\bthis\s*quarter\b|last\s*quarter\b|3\s*months?\b/)) parsed.time_range = 'quarter';
    else if (normalizedQ.match(/\blast\s*(1\s*)?month\b|30\s*days?\b/)) parsed.time_range = 'month';
    else if (normalizedQ.match(/\b(7\s*days?|last\s*week)\b/)) parsed.time_range = 'week';

    // Group by detection
    if (normalizedQ.match(/\bby\s*day\b|daily\b|date\b|day\s*wise\b/)) parsed.group_by = 'date';
    else if (normalizedQ.match(/\bby\s*month\b|monthly\b|month\s*wise\b|over\s*time\b|trend\b|month\s*on\s*month\b/)) parsed.group_by = 'month';
    else if (normalizedQ.match(/\bby\s*categor/)) parsed.group_by = 'category';
    else if (normalizedQ.match(/\bby\s*sub.?categor|by\s*product\b|\bproducts?\b|\bitems?\b/)) parsed.group_by = 'sub_category';
    else if (normalizedQ.match(/\btop\s*\d*\s*(product|item|sub.?categor)/)) parsed.group_by = 'sub_category';
    else if (normalizedQ.match(/\b(product|item)s?\b/) && normalizedQ.match(/\btop\b/)) parsed.group_by = 'sub_category';
    else if (normalizedQ.match(/\bby\s*state\b|\bby\s*regions?\b|\bregion\b|\bregions\b|\bregional\b/)) parsed.group_by = 'state';
    else if (normalizedQ.match(/\bby\s*city\b|cities\b/)) parsed.group_by = 'city';
    else if (normalizedQ.match(/\bby\s*customer\b|top\s*customer/)) parsed.group_by = 'customer';
    else if (normalizedQ.match(/\bby\s*payment\b|payment\s*mode\b/)) parsed.group_by = 'payment';
    else if (normalizedQ.match(/\bb2b\b.*\bb2c\b|\bb2c\b.*\bb2b\b/)) parsed.group_by = 'b2b';

    // Additional modifiers
    if (normalizedQ.match(/\bleast\b|\blowest\b|\bbottom\b|\bminimum\b|\bworst\b/)) {
        parsed.sort = 'asc';
    } else if (normalizedQ.match(/\btop\b|\bhighest\b|\bmaximum\b|\bbest\b/)) {
        parsed.sort = 'desc';
    }

    if (normalizedQ.match(/\btop\s*(\d+)/)) {
        const m = normalizedQ.match(/\btop\s*(\d+)/);
        parsed.limit = parseInt(m[1], 10);
    } else if (normalizedQ.match(/\b(least|lowest|bottom)\s*(\d+)/)) {
        const m = normalizedQ.match(/\b(least|lowest|bottom)\s*(\d+)/);
        parsed.limit = parseInt(m[2], 10);
    } else if (normalizedQ.match(/\b(?:show|list|give|find|get|display)?\s*(\d+)\s+(?:\w+\s+){0,4}(?:with\s+)?(top|highest|best|least|lowest|bottom)\b/)) {
        const m = normalizedQ.match(/\b(?:show|list|give|find|get|display)?\s*(\d+)\s+(?:\w+\s+){0,4}(?:with\s+)?(top|highest|best|least|lowest|bottom)\b/);
        parsed.limit = parseInt(m[1], 10);
    } else {
        const wordToNumber = {
            one: 1, two: 2, three: 3, four: 4, five: 5,
            six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        };
        const wordMatch = q.match(/\b(top|least|lowest|bottom)\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
        if (wordMatch) {
            parsed.limit = wordToNumber[wordMatch[2]];
        } else {
            const leadingWordMatch = normalizedQ.match(/\b(?:show|list|give|find|get|display)?\s*(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+){0,4}(?:with\s+)?(top|highest|best|least|lowest|bottom)\b/);
            if (leadingWordMatch) {
                parsed.limit = wordToNumber[leadingWordMatch[1]];
            }
        }

        if (parsed.limit === undefined) {
            if (normalizedQ.match(/\btop\b/)) {
                parsed.limit = 10;
            } else if (normalizedQ.match(/\bleast\b|\blowest\b|\bbottom\b/)) {
                parsed.limit = 10;
            }
        }
    }

    // Regional requests should default to state breakdown.
    if (!parsed.group_by && normalizedQ.match(/\bregional\b|\bregion\b|\bregions\b|\bstates?\b/)) {
        parsed.group_by = 'state';
    }

    // Clamp to a safe range so NLP mistakes do not create huge payloads.
    if (parsed.limit !== undefined) {
        const bounded = Math.max(1, Math.min(Number(parsed.limit) || 10, 50));
        parsed.limit = bounded;
    }

    // For clearly fresh prompts, remove stale numeric limits unless re-requested.
    if (!followUpHint && !normalizedQ.match(/\btop\b|\bhighest\b|\bmaximum\b|\bbest\b|\bleast\b|\blowest\b|\bbottom\b|\blimit\b/)) {
        delete parsed.limit;
    }
    if (!followUpHint && !normalizedQ.match(/\bleast\b|\blowest\b|\bbottom\b|\bminimum\b|\bworst\b|\btop\b|\bhighest\b|\bmaximum\b|\bbest\b/)) {
        delete parsed.sort;
    }
    if (normalizedQ.match(/\bcompare\b|comparison\b|vs\b/)) parsed.compare = true;

    // Default group_by based on month detection
    if (!parsed.group_by && parsed.months) {
        if (parsed.months.length === 1) {
            parsed.group_by = 'date';
        } else if (parsed.months.length > 1) {
            parsed.group_by = 'month';
        }
    }

    return parsed;
}

function buildSmartSQL(parsed, filters = {}) {
    const metric = parsed.metric || 'sales';
    const groupBy = parsed.group_by;
    const limit = Math.max(1, Math.min(Number(parsed.limit) || 10, 50));
    const sortDirection = parsed.sort === 'asc' ? 'ASC' : 'DESC';

    // Build SELECT aggregate
    let selectField, aggregateLabel;
    switch (metric) {
        case 'profit': selectField = 'ROUND(COALESCE(SUM(Profit), 0), 2)'; aggregateLabel = 'value'; break;
        case 'orders': selectField = 'COUNT(DISTINCT Order_ID)'; aggregateLabel = 'value'; break;
        case 'quantity': selectField = 'SUM(Qty)'; aggregateLabel = 'value'; break;
        case 'aov': selectField = 'ROUND(COALESCE(AVG(Amount), 0), 2)'; aggregateLabel = 'value'; break;
        case 'customers': selectField = 'COUNT(DISTINCT CustomerName)'; aggregateLabel = 'value'; break;
        default: selectField = 'ROUND(COALESCE(SUM(Amount), 0), 2)'; aggregateLabel = 'value'; break;
    }

    // Build GROUP BY dimension
    let groupField, groupAlias = 'name', orderBy = `value ${sortDirection}`, isTimeBased = false;
    switch (groupBy) {
        case 'date': groupField = 'Date'; groupAlias = 'name'; orderBy = "substr(Date, 7, 4) || '-' || substr(Date, 4, 2) || '-' || substr(Date, 1, 2) ASC"; isTimeBased = true; break;
        case 'month': groupField = 'Month'; groupAlias = 'name'; orderBy = 'Month ASC'; isTimeBased = true; break;
        case 'category': groupField = 'Category'; break;
        case 'sub_category': groupField = 'Sub_Category'; break;
        case 'state': groupField = 'Ship_State'; break;
        case 'city': groupField = 'Ship_City'; break;
        case 'customer': groupField = 'CustomerName'; break;
        case 'payment': groupField = 'PaymentMode'; break;
        case 'b2b': groupField = "CASE WHEN B2B = 'True' THEN 'B2B' ELSE 'B2C' END"; break;
        default: groupField = null; break;
    }

    // Merge parsed category into filters
    const effectiveFilters = { ...filters };
    if (parsed.category && parsed.category !== 'All categories') {
        effectiveFilters.category = parsed.category;
    }
    if (parsed.time_range) {
        switch (parsed.time_range) {
            case 'week': effectiveFilters.dateRange = 'Last 7 days'; break;
            case 'month': effectiveFilters.dateRange = 'Last 30 days'; break;
            case 'quarter': effectiveFilters.dateRange = 'This quarter'; break;
            case 'year': effectiveFilters.dateRange = 'This year'; break;
            default: break;
        }
    }
    if (parsed.months) {
        effectiveFilters.months = parsed.months;
    }

    const baseClauses = [];
    if (groupField && groupField !== "CASE WHEN B2B = 'True' THEN 'B2B' ELSE 'B2C' END") {
        baseClauses.push(`${groupField} != ''`);
    }

    const { whereSql, params } = buildWhere(effectiveFilters, baseClauses);

    if (!groupField) {
        // Scalar query
        const sql = `SELECT ${selectField} as total FROM orders ${whereSql}`;
        return { sql, params, isScalar: true, isTimeBased: false, metric };
    }

    const limitClause = isTimeBased ? '' : ` LIMIT ${limit}`;
    const sql = `SELECT ${groupField} as name, ${selectField} as ${aggregateLabel} FROM orders ${whereSql} GROUP BY ${groupField === "CASE WHEN B2B = 'True' THEN 'B2B' ELSE 'B2C' END" ? groupField : groupField} ORDER BY ${orderBy}${limitClause}`;
    return { sql, params, isScalar: false, isTimeBased, metric };
}

function autoChartType(parsed, dataLength) {
    if (!dataLength || dataLength <= 0) return null;
    if (parsed.group_by === 'month' || parsed.group_by === 'time' || parsed.group_by === 'date') return 'line';
    if (parsed.group_by === 'b2b' || parsed.group_by === 'payment') return 'pie';
    if (dataLength <= 4) return 'pie';
    if (parsed.group_by === 'category' || parsed.group_by === 'sub_category' || parsed.group_by === 'state' || parsed.group_by === 'city' || parsed.group_by === 'customer') return 'bar';
    return 'bar';
}

function formatMetricValue(metric, value) {
    const n = Number(value || 0);
    if (metric === 'orders' || metric === 'quantity' || metric === 'customers') {
        return Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '0';
    }
    return `₹${Number.isFinite(n) ? n.toLocaleString('en-IN') : '0'}`;
}

// Fetch summary stats to give Groq full context about the dataset
async function getDataSummaryForGroq() {
    try {
        const [totals, categories, states, monthly, payments, subCats] = await Promise.all([
            cachedQuery(`SELECT COUNT(*) as totalRows, ROUND(SUM(Amount),2) as totalRevenue, ROUND(SUM(Profit),2) as totalProfit, SUM(Qty) as totalQty, COUNT(DISTINCT Order_ID) as uniqueOrders, ROUND(AVG(Amount),2) as avgOrderValue, MIN(Date) as minDate, MAX(Date) as maxDate FROM orders`),
            cachedQuery(`SELECT Category, ROUND(SUM(Amount),2) as revenue, ROUND(SUM(Profit),2) as profit, COUNT(*) as orders FROM orders WHERE Category != '' GROUP BY Category ORDER BY revenue DESC`),
            cachedQuery(`SELECT Ship_State, ROUND(SUM(Amount),2) as revenue, COUNT(*) as orders FROM orders WHERE Ship_State != '' GROUP BY Ship_State ORDER BY revenue DESC LIMIT 10`),
            cachedQuery(`SELECT Month, ROUND(SUM(Amount),2) as revenue, ROUND(SUM(Profit),2) as profit FROM orders WHERE Month != '' GROUP BY Month ORDER BY Month ASC`),
            cachedQuery(`SELECT PaymentMode, COUNT(*) as count, ROUND(SUM(Amount),2) as revenue FROM orders WHERE PaymentMode != '' GROUP BY PaymentMode ORDER BY revenue DESC`),
            cachedQuery(`SELECT Sub_Category, ROUND(SUM(Amount),2) as revenue, ROUND(SUM(Profit),2) as profit FROM orders WHERE Sub_Category != '' GROUP BY Sub_Category ORDER BY revenue DESC LIMIT 10`),
        ]);
        return { totals: totals[0], categories, states, monthly, payments, subCats };
    } catch (err) {
        console.warn('[DATA SUMMARY] Error:', err.message);
        return null;
    }
}

async function maybeGroqAnswer({ query, parsed, data = [], insights = [], defaultAnswer, isOpenEnded = false }) {
    if (!GROQ_API_KEY) return { answer: defaultAnswer, provider: 'rule-based' };
    if (typeof fetch !== 'function') return { answer: defaultAnswer, provider: 'rule-based' };

    try {
        const payloadData = Array.isArray(data) ? data.slice(0, 15) : [];
        const payloadInsights = Array.isArray(insights) ? insights.slice(0, 6) : [];

        // Fetch data summary for context when it's an open-ended question
        let dataSummary = null;
        if (isOpenEnded || payloadData.length === 0) {
            dataSummary = await getDataSummaryForGroq();
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const systemContent = `You are "Talking BI", an expert AI business intelligence assistant. You have access to an e-commerce sales dataset stored in a SQLite database.

DATABASE SCHEMA:
Table: orders
- Order_ID (TEXT) - Unique order identifier, e.g. B-25681
- Date (TEXT) - Order date in DD-MM-YYYY format
- Month (TEXT) - Month extracted as 01-12
- CustomerName (TEXT) - Customer name
- Ship_State (TEXT) - Indian state, e.g. Maharashtra, Madhya Pradesh, Delhi
- Ship_City (TEXT) - City name
- Category (TEXT) - Product category: Electronics, Clothing, Furniture
- Sub_Category (TEXT) - E.g. Phones, Printers, Saree, Chairs, Bookcases, etc.
- Qty (INTEGER) - Quantity ordered
- Amount (REAL) - Order amount in INR (₹)
- Profit (REAL) - Profit in INR (can be negative)
- PaymentMode (TEXT) - COD, UPI, Credit Card, Debit Card, EMI
- Status (TEXT) - Order status
- B2B (TEXT) - B2B indicator
- SKU (TEXT) - Stock Keeping Unit

DATA SOURCE: This data comes from two CSV files merged together:
- Orders.csv: Contains Order ID, Order Date, CustomerName, State, City
- Details.csv: Contains Order ID, Amount, Profit, Quantity, Category, Sub-Category, PaymentMode
They are joined on Order ID.

${dataSummary ? `DATA SUMMARY:
- Total rows: ${dataSummary.totals?.totalRows}
- Total revenue: ₹${Number(dataSummary.totals?.totalRevenue || 0).toLocaleString('en-IN')}
- Total profit: ₹${Number(dataSummary.totals?.totalProfit || 0).toLocaleString('en-IN')}
- Total quantity: ${dataSummary.totals?.totalQty}
- Unique orders: ${dataSummary.totals?.uniqueOrders}
- Avg order value: ₹${Number(dataSummary.totals?.avgOrderValue || 0).toLocaleString('en-IN')}
- Date range: ${dataSummary.totals?.minDate} to ${dataSummary.totals?.maxDate}

CATEGORY BREAKDOWN:
${dataSummary.categories?.map(c => `  ${c.Category}: Revenue ₹${Number(c.revenue).toLocaleString('en-IN')}, Profit ₹${Number(c.profit).toLocaleString('en-IN')}, Orders: ${c.orders}`).join('\n') || 'N/A'}

TOP STATES:
${dataSummary.states?.map(s => `  ${s.Ship_State}: Revenue ₹${Number(s.revenue).toLocaleString('en-IN')}, Orders: ${s.orders}`).join('\n') || 'N/A'}

MONTHLY TREND:
${dataSummary.monthly?.map(m => `  Month ${m.Month}: Revenue ₹${Number(m.revenue).toLocaleString('en-IN')}, Profit ₹${Number(m.profit).toLocaleString('en-IN')}`).join('\n') || 'N/A'}

PAYMENT MODES:
${dataSummary.payments?.map(p => `  ${p.PaymentMode}: ${p.count} orders, Revenue ₹${Number(p.revenue).toLocaleString('en-IN')}`).join('\n') || 'N/A'}

TOP SUB-CATEGORIES:
${dataSummary.subCats?.map(s => `  ${s.Sub_Category}: Revenue ₹${Number(s.revenue).toLocaleString('en-IN')}, Profit ₹${Number(s.profit).toLocaleString('en-IN')}`).join('\n') || 'N/A'}` : ''}

INSTRUCTIONS:
- Answer in a clear, insightful, and professional manner
- Use actual numbers from the data provided — never invent data
- When discussing trends, cite specific months and percentage changes
- When asked about predictions/forecasts, use the monthly trend data to extrapolate
- When asked about graphs, explain what the data shows
- Format currency as ₹ with Indian numbering
- Keep responses concise but insightful (2-4 paragraphs max)
- Always respond in English, regardless of the language of the user's query`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: GROQ_MODEL,
                temperature: 0.3,
                max_tokens: 800,
                messages: [
                    { role: 'system', content: systemContent },
                    {
                        role: 'user',
                        content: `User Query: ${query}\n${parsed ? `Parsed Context: ${JSON.stringify(parsed)}` : ''}\n${payloadData.length > 0 ? `Query Result Data: ${JSON.stringify(payloadData)}` : ''}\n${payloadInsights.length > 0 ? `Auto-Insights: ${JSON.stringify(payloadInsights)}` : ''}\n${defaultAnswer ? `Rule-based Answer: ${defaultAnswer}` : ''}`,
                    },
                ],
            }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const text = await response.text();
            console.warn('[GROQ] non-OK response:', text.slice(0, 200));
            return { answer: defaultAnswer, provider: 'rule-based' };
        }

        const result = await response.json();
        const answer = result?.choices?.[0]?.message?.content?.trim();
        if (!answer) return { answer: defaultAnswer, provider: 'rule-based' };

        return { answer, provider: 'groq' };
    } catch (err) {
        console.warn('[GROQ] fallback to rule-based:', err.message);
        return { answer: defaultAnswer, provider: 'rule-based' };
    }
}

// ==========================================
// UNIFIED AI QUERY AGENT API (single + multi)
// ==========================================
const handleUnifiedQuery = async (req, res) => {
    const { query } = req.body || {};

    if (!query || !String(query).trim()) {
        return res.status(400).json({
            error: 'Query is required.',
        });
    }

    try {
        const result = await runUnifiedAgent({
            userQuery: String(query).trim(),
            queryFn: (sql) => cachedQuery(sql),
            apiKey: GROQ_API_KEY,
            model: GROQ_MODEL,
        });

        return res.json(result);
    } catch (err) {
        console.error('[UNIFIED QUERY ERROR]', err.message);
        return res.status(500).json({
            error: 'Failed to process query.',
            details: err.message,
        });
    }
};

app.post('/query', handleUnifiedQuery);
app.post('/api/query', handleUnifiedQuery);

// ==========================================
// LLM-BASED SQL GENERATOR
// ==========================================
async function generateSQLFromQuery(userQuery, filters = {}) {
    try {
        if (!GROQ_API_KEY) return null;

        const dataSummary = await getDataSummaryForGroq();
        const statesList = await cachedQuery(
            `SELECT DISTINCT Ship_State FROM orders WHERE Ship_State != '' ORDER BY Ship_State`,
            []
        );
        const statesStr = statesList.map(r => r.Ship_State).join(', ');

        const systemPrompt = `You are a SQLite SQL expert. Generate ONLY valid SQLite SQL queries based on user questions about an e-commerce dataset.

DATABASE SCHEMA:
Table: orders
- Order_ID (TEXT)
- Date (TEXT) - DD-MM-YYYY format
- Month (TEXT) - 01-12
- CustomerName (TEXT)
- Ship_State (TEXT) - Indian states: ${statesStr}
- Ship_City (TEXT)
- Category (TEXT) - Electronics, Clothing, Furniture
- Sub_Category (TEXT)
- Qty (INTEGER)
- Amount (REAL) - in INR
- Profit (REAL)
- PaymentMode (TEXT) - COD, UPI, Credit Card, Debit Card, EMI
- Status (TEXT)
- B2B (TEXT) - True/False
- SKU (TEXT)

RULES:
1. Use COUNT(DISTINCT CustomerName) for customer counts
2. Use COUNT(DISTINCT Order_ID) for order counts
3. Use SUM(Amount) for revenue
4. Use SUM(Qty) for quantities
5. Use ROUND(SUM(Profit), 2) for profit
6. Always use GROUP BY when multiple rows needed
7. For "top N" queries, use ORDER BY DESC LIMIT N
8. For "bottom/least N" queries, use ORDER BY ASC LIMIT N
9. For date filters, parse DD-MM-YYYY format
10. Always alias columns as 'name' (for categories/states) and 'value' (for metrics)

RESPOND WITH ONLY THE SQL QUERY, NO EXPLANATION.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userQuery },
                ],
                temperature: 0.1,
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            console.error('[SQL GENERATOR ERROR]', await response.text());
            return null;
        }

        const data = await response.json();
        const sql = data.choices?.[0]?.message?.content?.trim();

        // Validate SQL
        if (!sql || !sql.toUpperCase().startsWith('SELECT')) {
            console.warn('[SQL GENERATOR] Invalid SQL generated:', sql);
            return null;
        }

        // Security check - prevent dangerous operations
        const dangerous = /DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|VACUUM|PRAGMA/i;
        if (dangerous.test(sql)) {
            console.warn('[SQL GENERATOR] Dangerous SQL blocked:', sql);
            return null;
        }

        return sql;
    } catch (err) {
        console.error('[SQL GENERATOR ERROR]', err.message);
        return null;
    }
}

// ==========================================
// ENHANCED CHATBOT API
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { query, filters = {}, sessionId, usageType = 'chat', generationId } = req.body;
    const lowerQuery = (query || '').toLowerCase().trim();
    const datasetId = String(filters?.datasetId || '').trim();

    if (!lowerQuery) {
        return res.json({ answer: "Please type a question about your data.", sql: "", data: [], chartType: null, insights: [] });
    }

    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized. Please login to continue.' });
    }

    try {
        const normalizedUsageType = usageType === 'dashboard_generation' ? 'dashboard_generation' : 'chat';
        await applyUsagePolicy(req.user, normalizedUsageType, { generationId });

        if (datasetId) {
            const datasetAnalytics = getDatasetAnalytics(datasetId, req.user, lowerQuery);
            if (datasetAnalytics) {
                return res.json({
                    answer: datasetAnalytics.answer,
                    sql: '',
                    data: datasetAnalytics.data,
                    chartType: datasetAnalytics.chartType,
                    parsedQuery: { source: 'dataset_url' },
                    insights: datasetAnalytics.insights,
                    provider: 'dataset-engine',
                });
            }
        }

        // For chat conversations, always send the user's message to the LLM first.
        if (normalizedUsageType === 'chat') {
            const session = getSession(sessionId);
            const parsed = parseQuery(lowerQuery, session.context);

            Object.keys(parsed).forEach((k) => {
                if (parsed[k] !== undefined) session.context[k] = parsed[k];
            });

            const defaultAnswer = 'I understood your question. Please share more context if you want a deeper data-focused answer.';
            const llmResponse = await maybeGroqAnswer({
                query: lowerQuery,
                parsed,
                data: [],
                insights: [],
                defaultAnswer,
                isOpenEnded: true,
            });

            return res.json({
                answer: llmResponse.answer,
                sql: '',
                data: [],
                chartType: null,
                parsedQuery: parsed,
                insights: [],
                provider: llmResponse.provider,
            });
        }

        const userDbAnalytics = await getUserDbAnalytics(req.user, lowerQuery, filters);
        if (userDbAnalytics) {
            return res.json(userDbAnalytics);
        }

        const datasetAnalytics = getDatasetAnalytics(filters?.datasetId, req.user, lowerQuery);
        if (datasetAnalytics) {
            return res.json({
                answer: datasetAnalytics.answer,
                sql: '',
                data: datasetAnalytics.data,
                chartType: datasetAnalytics.chartType,
                parsedQuery: { source: 'dataset_url' },
                insights: datasetAnalytics.insights,
                provider: 'dataset-engine',
            });
        }

        // Get/update session context for follow-ups
        const session = getSession(sessionId);

        if (!isLikelyDatabaseQuestion(lowerQuery)) {
            return res.json({
                answer: 'I can answer only database-related questions for this project. Please ask about sales, profit, orders, categories, states, monthly trends, or similar data metrics.',
                sql: '',
                data: [],
                chartType: null,
                parsedQuery: { source: 'db-guard' },
                insights: [],
                provider: 'rule-based',
            });
        }

        // Deterministic NLP parsing + SQL generation
        const parsed = parseQuery(lowerQuery, session.context);

        // Update session context with latest parsed values
        Object.keys(parsed).forEach(k => {
            if (parsed[k] !== undefined) session.context[k] = parsed[k];
        });

        // If no group_by or metric detected and no context, fall back to heuristic
        if (!parsed.metric && !parsed.group_by && Object.keys(session.context).length === 0) {
            // Fallback heuristic for simple queries
            return handleFallbackQuery(lowerQuery, filters, res);
        }

        // If only metric detected with no group_by
        if (parsed.metric && !parsed.group_by) {
            if (!session.context.group_by) {
                // Return scalar
                const { sql, params, metric } = buildSmartSQL(parsed, filters);
                const data = await cachedQuery(sql, params);
                const val = data[0]?.total || 0;
                const metricLabel = { sales: 'total sales revenue', profit: 'total profit', orders: 'total orders', quantity: 'total units sold', aov: 'average order value' }[metric] || metric;
                const formatted = metric === 'orders' || metric === 'quantity' ? Number(val).toLocaleString('en-IN') : `₹${Number(val).toLocaleString('en-IN')}`;
                const defaultAnswer = `The ${metricLabel} is ${formatted}.`;
                return res.json({
                    answer: defaultAnswer,
                    sql, data: [], chartType: null,
                    parsedQuery: parsed,
                    insights: [`Total ${metricLabel}: ${formatted}`],
                    provider: 'rule-based',
                });
            }
        }

        // Build and execute smart SQL
        const { sql, params, isScalar, isTimeBased, metric } = buildSmartSQL(parsed, filters);
        const data = await cachedQuery(sql, params);

        if (!data || data.length === 0) {
            return res.json({
                answer: 'No matching data found for this query. Try changing filters, timeframe, or category.',
                sql,
                data: [],
                chartType: null,
                parsedQuery: parsed,
                insights: [],
                provider: 'rule-based',
            });
        }

        if (isScalar) {
            const val = data[0]?.total || 0;
            const metricLabel = { sales: 'total sales revenue', profit: 'total profit', orders: 'total orders', quantity: 'total units sold', aov: 'average order value' }[metric] || metric;
            const formatted = metric === 'orders' || metric === 'quantity' ? Number(val).toLocaleString('en-IN') : `₹${Number(val).toLocaleString('en-IN')}`;
            const defaultAnswer = `The ${metricLabel} is ${formatted}.`;
            return res.json({
                answer: defaultAnswer,
                sql, data: [], chartType: null,
                parsedQuery: parsed,
                insights: [`${metricLabel}: ${formatted}`],
                provider: 'rule-based',
            });
        }

        const chartType = autoChartType(parsed, data.length);

        // Auto-generate insights from query results
        const autoInsights = generateAutoInsights(data, parsed);

        // Build natural language answer
        const metricLabel = { sales: 'revenue', profit: 'profit', orders: 'order count', quantity: 'quantity', aov: 'avg order value' }[metric] || 'data';
        const groupLabel = parsed.group_by || 'dimension';
        let answer = `Here is the ${metricLabel} breakdown by ${groupLabel}.`;

        if (data.length > 0) {
            const top = data[0];
            const rankLabel = parsed.sort === 'asc' ? 'Lowest' : 'Top';
            answer += ` ${rankLabel}: ${top.name} with ${formatMetricValue(metric, top.value)}.`;
        }

        res.json({
            answer,
            sql, data, chartType,
            parsedQuery: parsed,
            insights: autoInsights,
            provider: 'rule-based',
        });
    } catch (err) {
        console.error('[CHAT ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

function generateAutoInsights(data, parsed) {
    const insights = [];
    if (!data || data.length === 0) return insights;

    // Trend insight
    if (data.length >= 2) {
        const first = data[0].value;
        const last = data[data.length - 1].value;
        if (parsed.group_by === 'month' && first > 0) {
            const change = ((last - first) / first * 100).toFixed(1);
            insights.push(`Trend: ${Number(change) >= 0 ? 'Growth' : 'Decline'} of ${Math.abs(change)}% over the period.`);
        }
    }

    // Comparison: top vs bottom
    if (data.length >= 2) {
        const sorted = [...data].sort((a, b) => b.value - a.value);
        const top = sorted[0];
        const bottom = sorted[sorted.length - 1];
        if (bottom.value > 0) {
            const ratio = (top.value / bottom.value).toFixed(1);
            insights.push(`Comparison: ${top.name} is ${ratio}x higher than ${bottom.name}.`);
        }
    }

    // Anomaly: stddev check
    if (data.length >= 3) {
        const vals = data.map(d => d.value);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
        if (stdDev > 0) {
            data.forEach(d => {
                const z = Math.abs((d.value - mean) / stdDev);
                if (z > 1.5) {
                    insights.push(`Anomaly: ${d.name} deviates significantly (${z.toFixed(1)}σ) from the average.`);
                }
            });
        }
    }

    // Concentration
    if (data.length >= 3) {
        const total = data.reduce((s, d) => s + d.value, 0);
        const topShare = total > 0 ? ((data[0].value / total) * 100).toFixed(0) : 0;
        if (topShare > 40) {
            insights.push(`Concentration: ${data[0].name} accounts for ${topShare}% of total.`);
        }
    }

    return insights;
}

async function handleFallbackQuery(lowerQuery, filters, res) {
    const defaultAnswer = "I can answer only from your connected database. Try questions like: 'top 5 categories by sales', 'monthly profit trend', or 'state-wise order count'.";
    return res.json({
        answer: defaultAnswer,
        sql: '', data: [], chartType: null, insights: [],
        provider: 'rule-based',
    });
}

function isLikelyDatabaseQuestion(lowerQuery = '') {
    if (!lowerQuery) return false;

    const keywords = [
        'sales', 'revenue', 'profit', 'order', 'orders', 'customer', 'customers',
        'amount', 'qty', 'quantity', 'category', 'sub category', 'state', 'city',
        'month', 'monthly', 'trend', 'payment', 'b2b', 'b2c', 'dashboard',
        'top', 'bottom', 'highest', 'lowest', 'compare', 'growth', 'decline',
        'data', 'database', 'table', 'record', 'sku'
    ];

    return keywords.some((kw) => lowerQuery.includes(kw));
}

// ==========================================
// LEGACY INSIGHTS ENDPOINT (backward compat)
// ==========================================
app.get('/api/insights', async (req, res) => {
    try {
        const filtered = buildWhere(req.query);
        const topCategoryWhere = buildWhere(req.query, ["Category != ''"]);
        const total = await cachedQuery(`SELECT ROUND(COALESCE(SUM(Amount), 0), 2) as val FROM orders ${filtered.whereSql}`, filtered.params);
        const topCat = await cachedQuery(`SELECT Category, ROUND(COALESCE(SUM(Amount), 0), 2) as val FROM orders ${topCategoryWhere.whereSql} GROUP BY Category ORDER BY val DESC LIMIT 1`, topCategoryWhere.params);

        const insights = [
            `Sales in the current filter scope total ₹${Number(total[0]?.val || 0).toLocaleString()}.`,
            `The top performing category is ${topCat[0]?.Category || 'unknown'} contributing significantly to total revenue.`,
            "Consider boosting marketing spend in underperforming regions to maximize overall growth."
        ];

        res.json({ insights });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const server = app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});

// Graceful shutdown
const shutdown = () => {
    console.log('\nShutting down gracefully...');
    server.close(() => {
        db.close((err) => {
            if (err) console.error('Error closing database:', err.message);
            else console.log('Database connection closed.');
            prisma.$disconnect().catch(() => null);
            process.exit(0);
        });
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
