import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarRange,
  ChevronDown,
  ChartColumn,
  CreditCard,
  Filter,
  Globe,
  Search,
  Sparkles,
  UserCircle2,
  LogOut,
  Trash2,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import SearchInterface from './components/SearchInterface';
import PricingV3 from './components/PricingV3';
import ChatbotV2 from './components/ChatbotV2';
import CustomDashboardBuilder from './components/CustomDashboardBuilder';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import PrivacyPolicyPage from './components/PrivacyPolicyPage';
import { apiDelete, apiGet, apiPost, getAuthToken, setAuthToken } from './api';

const mapPlanToUiPlan = (plan) => {
  if (plan === 'plus') return 'Plus';
  if (plan === 'max') return 'Pro';
  if (plan === 'max_plus' || plan === 'pro_max') return 'Premium';
  return 'Free';
};

const formatPlanLabel = (plan) => {
  if (!plan) return 'Trial';
  return String(plan)
    .split('_')
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
};

const PLAN_STORAGE_CONFIG = {
  trial: { enabled: false, retentionDays: 0 },
  plus: { enabled: false, retentionDays: 0 },
  max: { enabled: true, retentionDays: 30 },
  max_plus: { enabled: true, retentionDays: 180 },
  pro_max: { enabled: true, retentionDays: 365 },
};

export default function App() {
  const [publicPath, setPublicPath] = useState(() => window.location.pathname || '/');
  const [hasStarted, setHasStarted] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [user, setUser] = useState(null);
  const [activeScreen, setActiveScreen] = useState('custom-dashboard-builder');
  const [activeNav, setActiveNav] = useState('dashboard');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const [generations, setGenerations] = useState([]);
  const [savedDashboards, setSavedDashboards] = useState([]);
  const [usage, setUsage] = useState(null);
  const [headerSearch, setHeaderSearch] = useState('');
  const [visualMode, setVisualMode] = useState('free');
  const [dateRange, setDateRange] = useState('Last 30 days');
  const [category, setCategory] = useState('All categories');
  const [region, setRegion] = useState('All regions');
  const [databaseStatus, setDatabaseStatus] = useState('Connect your PostgreSQL database to generate charts from SQL.');
  const [databaseInfo, setDatabaseInfo] = useState({ connected: false, schema: { tables: [] } });
  const [importedDataset, setImportedDataset] = useState(null);
  const [importStatus, setImportStatus] = useState('Import a CSV file or dataset link to start analyzing data.');
  const [dashboardKpis, setDashboardKpis] = useState(null);
  const [builderState, setBuilderState] = useState(null);
  const [pendingBuilderConfig, setPendingBuilderConfig] = useState(null);
  const profileMenuRef = useRef(null);
  const plan = mapPlanToUiPlan(user?.plan);
  const currentPlanId = user?.plan || 'trial';
  const isTrialPlan = currentPlanId === 'trial';
  const hasDatasetLink = Boolean(databaseInfo?.connected || importedDataset?.datasetId);

  const loadSavedDashboards = async () => {
    try {
      const result = await apiGet('/api/dashboards/mine');
      setSavedDashboards(result?.dashboards || []);
    } catch (_err) {
      setSavedDashboards([]);
    }
  };

  const loadUsage = async () => {
    try {
      const result = await apiGet('/api/usage/status');
      setUsage(result);
    } catch (_err) {
      setUsage(null);
    }
  };

  useEffect(() => {
    const bootstrapAuth = async () => {
      const token = getAuthToken();
      if (!token) {
        setAuthReady(true);
        return;
      }

      try {
        const me = await apiGet('/api/auth/me');
        setUser(me?.user || null);
      } catch (_err) {
        setAuthToken(null);
        setUser(null);
      } finally {
        setAuthReady(true);
      }
    };

    bootstrapAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    loadSavedDashboards();
    loadUsage();
    apiGet('/api/db/status')
      .then((result) => {
        setDatabaseInfo(result || { connected: false, schema: { tables: [] } });
        setDatabaseStatus(result?.connected ? 'Connected successfully.' : 'Connect your PostgreSQL database to start querying.');
      })
      .catch(() => {
        setDatabaseInfo({ connected: false, schema: { tables: [] } });
      });
  }, [user]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!profileMenuRef.current) return;
      if (profileMenuRef.current.contains(event.target)) return;
      setIsProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const classifyGenerationTier = (queryText) => {
    const premiumKeywords = [
      'forecast',
      'prediction',
      'anomaly',
      'cohort',
      'segment',
      'sankey',
      'heatmap',
      'radar',
      'waterfall',
      'gantt',
      'funnel',
      'whisker',
    ];
    const normalized = (queryText || '').toLowerCase();
    return premiumKeywords.some((keyword) => normalized.includes(keyword)) ? 'premium' : 'core';
  };

  const activeFilters = useMemo(() => ({
    dateRange,
    category,
    region,
    useUserDb: Boolean(databaseInfo?.connected),
    datasetId: importedDataset?.datasetId || '',
  }), [dateRange, category, region, databaseInfo, importedDataset]);

  useEffect(() => {
    if (!hasStarted) return;
    if (!hasDatasetLink) {
      setDashboardKpis(null);
      return;
    }

    const loadDashboardData = async () => {
      try {
        if (importedDataset?.datasetId) {
          const datasetKpis = await apiGet('/api/datasets/kpis', { datasetId: importedDataset.datasetId });
          setDashboardKpis(datasetKpis?.kpis || null);
          setDatabaseStatus(`Imported dataset ready. ${importedDataset.rowCount || 0} rows loaded.`);
          setImportStatus(`CSV/Link imported successfully. ${importedDataset.rowCount || 0} rows available.`);
          return;
        }

        const datasetKpis = await apiGet('/api/db/kpis');
        setDashboardKpis(datasetKpis?.kpis || null);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
        setDashboardKpis(null);
      }
    };

    loadDashboardData();
  }, [hasStarted, activeFilters, hasDatasetLink, importedDataset]);

  useEffect(() => {
    if (plan === 'Free') return;

    setGenerations((prev) =>
      prev.map((gen) => {
        const tier = gen.tier || classifyGenerationTier(gen.query);
        if (tier !== 'premium') return gen;
        return {
          ...gen,
          tier,
          isOpen: true,
        };
      })
    );
  }, [plan]);

  useEffect(() => {
    if (!isTrialPlan) return;
    setIsChatOpen(false);
    if (activeNav === 'chat') {
      setActiveNav('dashboard');
    }
  }, [activeNav, isTrialPlan]);

  const handleQuerySubmit = (query) => {
    apiPost('/api/usage/check-dashboard', {})
      .then(() => {
        setGenerations((prev) => {
          const tier = classifyGenerationTier(query);
          const isLockedByPlan = tier === 'premium' && plan === 'Free';
          return [{ query, id: Date.now(), tier, isOpen: !isLockedByPlan }, ...prev];
        });
        loadUsage();
        setActiveNav('reports');
        setTimeout(() => {
          const reportsSection = document.getElementById('reports');
          reportsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      })
      .catch((err) => {
        alert(err.message || 'Limit reached, upgrade plan.');
        setActiveScreen('pricing');
      });
  };

  const handleDatabaseConnect = async (dbUrl) => {
    if (!dbUrl) {
      setDatabaseInfo({ connected: false, schema: { tables: [] } });
      setDatabaseStatus('Please provide a PostgreSQL connection URL.');
      return;
    }

    setDatabaseStatus('Connecting to database...');
    try {
      const result = await apiPost('/api/db/connect', { dbUrl });
      setImportedDataset(null);
      setImportStatus('Import a CSV file or dataset link to start analyzing data.');
      setDatabaseInfo(result || { connected: false, schema: { tables: [] } });
      const tableCount = result?.schema?.tables?.length || 0;
      setDatabaseStatus(`Connected successfully. ${tableCount} tables discovered.`);
    } catch (err) {
      setDatabaseInfo({ connected: false, schema: { tables: [] } });
      setDatabaseStatus(err.message || 'Failed to connect database.');
    }
  };

  const handleDatabaseDisconnect = async () => {
    setDatabaseStatus('Disconnecting database...');
    try {
      await apiPost('/api/db/disconnect', {});
      setDatabaseInfo({ connected: false, schema: { tables: [] } });
      setDatabaseStatus('Database disconnected. Connect your PostgreSQL database to start querying.');
      setDashboardKpis(null);
    } catch (err) {
      setDatabaseStatus(err.message || 'Failed to disconnect database.');
    }
  };

  const handleDatasetImportFromUrl = async (url) => {
    if (!url) {
      setImportStatus('Please paste a CSV/Google Sheet link first.');
      return;
    }

    setImportStatus('Importing dataset from link...');
    try {
      const result = await apiPost('/api/datasets/from-url', { url });
      setImportedDataset(result || null);
      setDatabaseInfo({ connected: false, schema: { tables: [] } });
      setDashboardKpis(null);
      setImportStatus(`Link imported successfully. ${result?.rowCount || 0} rows loaded.`);
    } catch (err) {
      setImportedDataset(null);
      setImportStatus(err.message || 'Failed to import dataset from link.');
    }
  };

  const handleDatasetImportFromCsv = async (csvText, fileName = 'dataset.csv') => {
    if (!csvText) {
      setImportStatus('Please choose a CSV file first.');
      return;
    }

    setImportStatus(`Uploading ${fileName}...`);
    try {
      const result = await apiPost('/api/datasets/from-csv', { csvText, fileName });
      setImportedDataset(result || null);
      setDatabaseInfo({ connected: false, schema: { tables: [] } });
      setDashboardKpis(null);
      setImportStatus(`CSV uploaded successfully. ${result?.rowCount || 0} rows loaded.`);
    } catch (err) {
      setImportedDataset(null);
      setImportStatus(err.message || 'Failed to import CSV.');
    }
  };

  const handleClearImportedDataset = () => {
    setImportedDataset(null);
    setImportStatus('Import a CSV file or dataset link to start analyzing data.');
    setDashboardKpis(null);
  };

  const handleSaveDashboard = async () => {
    if (!builderState?.widgets?.length) {
      alert('Generate dashboard in builder before saving.');
      return;
    }

    const config = {
      version: 'builder-v1',
      filters: activeFilters,
      builder: {
        kpiPrompt: builderState.kpiPrompt || '',
        selectedIds: builderState.selectedIds || [],
        widgets: builderState.widgets || [],
        generationNote: builderState.generationNote || '',
        step: builderState.step || 'dashboard',
        darkMode: Boolean(builderState.darkMode),
      },
    };

    try {
      await apiPost('/api/dashboards/save', { config });
      await loadSavedDashboards();
      alert('Dashboard saved.');
    } catch (err) {
      alert(err.message || 'Unable to save dashboard.');
    }
  };

  const handleBeforeBuilderGenerate = async () => {
    try {
      await apiPost('/api/usage/check-dashboard', {});
      await loadUsage();
      return true;
    } catch (err) {
      alert(err.message || 'Dashboard generation limit reached. Upgrade plan to continue.');
      return false;
    }
  };

  const handleLoadDashboard = async (dashboard) => {
    try {
      let config = dashboard.config;
      if (typeof config === 'string') {
        try {
          config = JSON.parse(config);
        } catch (_e) {
          // Keep as-is and validate below.
        }
      }

      if (!config || typeof config !== 'object') {
        config = typeof dashboard === 'string' ? JSON.parse(dashboard) : dashboard;
        if (config.config) {
          if (typeof config.config === 'string') {
            config = JSON.parse(config.config);
          } else {
            config = config.config;
          }
        }
      }

      if (!config || typeof config !== 'object') {
        throw new Error('Invalid dashboard configuration format');
      }

      if (!config.builder) {
        alert('This saved dashboard is from old single-chart flow. Use a builder-based saved dashboard.');
        return;
      }

      setPendingBuilderConfig(config.builder);
      setActiveScreen('custom-dashboard-builder');
      setActiveNav('dashboard');
      alert('Builder dashboard loaded.');
    } catch (err) {
      alert(`Failed to load dashboard: ${err.message}`);
    }
  };

  const handleAuthSuccess = async (result) => {
    setAuthToken(result?.token);
    setUser(result?.user || null);
    setHasStarted(true);
    await loadSavedDashboards();
    await loadUsage();
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setUsage(null);
    setSavedDashboards([]);
    setGenerations([]);
    setBuilderState(null);
    setPendingBuilderConfig(null);
    setIsChatOpen(false);
    setIsProfileMenuOpen(false);
    setDatabaseInfo({ connected: false, schema: { tables: [] } });
    setDatabaseStatus('Connect your PostgreSQL database to generate charts from SQL.');
    setImportStatus('Import a CSV file or dataset link to start analyzing data.');
    setImportedDataset(null);
    setDashboardKpis(null);
    setAuthMode('login');
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await apiDelete('/api/auth/account');
      alert('Your account has been deleted successfully.');
      handleLogout();
      setHasStarted(true);
    } catch (err) {
      alert(err.message || 'Unable to delete account right now.');
    }
  };

  const visibleGenerations = generations
    .map((gen) => {
      const tier = gen.tier || classifyGenerationTier(gen.query);
      const baseOpen = typeof gen.isOpen === 'boolean' ? gen.isOpen : true;
      const isLockedByPlan = tier === 'premium' && plan === 'Free';
      return {
        ...gen,
        tier,
        isLockedByPlan,
        isOpen: isLockedByPlan ? false : baseOpen,
      };
    })
    .filter((gen) => gen.query.toLowerCase().includes(headerSearch.toLowerCase()));

  const toggleGenerationOpen = (id) => {
    setGenerations((prev) =>
      prev.map((gen) =>
        gen.id === id
          ? {
              ...gen,
              isOpen: !gen.isOpen,
            }
          : gen
      )
    );
  };

  const kpiCards = useMemo(() => {
    const totalSales = Number(dashboardKpis?.totalRevenue || 0);
    const totalProfit = Number(dashboardKpis?.totalProfit || 0);
    const totalOrders = Number(dashboardKpis?.totalOrders || 0);
    const avgOrder = Number(dashboardKpis?.averageOrderValue || 0);
    const uniqueProducts = Number(dashboardKpis?.uniqueProducts || 0);

    return [
      { label: 'Total Sales', value: `₹${totalSales.toLocaleString()}` },
      { label: 'Profit', value: `₹${totalProfit.toLocaleString()}` },
      { label: 'Orders', value: totalOrders.toLocaleString() },
      {
        label: 'Avg Order Value',
        value: `₹${avgOrder.toLocaleString()} (${uniqueProducts} products)`,
      },
    ];
  }, [dashboardKpis]);

  const handleNavChange = (next) => {
    if (next === 'chat' && isTrialPlan) {
      setIsChatOpen(false);
      setActiveNav('dashboard');
      return;
    }

    setActiveNav(next);
    setActiveScreen('dashboard');

    if (next === 'chat') {
      setIsChatOpen(true);
      return;
    }
  };

  useEffect(() => {
    const syncPath = () => setPublicPath(window.location.pathname || '/');
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  const navigatePublicPath = (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setPublicPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (publicPath === '/privacy-policy') {
    return <PrivacyPolicyPage onBack={() => navigatePublicPath('/')} />;
  }

  if (!hasStarted) {
    return <LandingPage onStart={() => setHasStarted(true)} />;
  }

  if (!authReady) {
    return <div className="auth-loading">Checking your session...</div>;
  }

  if (!user) {
    return authMode === 'login' ? (
      <LoginPage
        onSuccess={handleAuthSuccess}
        onSwitch={() => setAuthMode('signup')}
      />
    ) : (
      <SignupPage
        onSuccess={handleAuthSuccess}
        onSwitch={() => setAuthMode('login')}
        onOpenPrivacyPolicy={() => navigatePublicPath('/privacy-policy')}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeNav}
        setActiveTab={handleNavChange}
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        isChatOpen={isChatOpen}
        plan={plan}
        isTrialPlan={isTrialPlan}
      />

      <div className="app-main-column">
        <header className="top-navbar">
          <div>
            <h1 className="page-title">{activeScreen === 'pricing' ? 'Subscription Plans' : activeScreen === 'custom-dashboard-builder' ? 'Dashboard Builder' : 'Dashboard'}</h1>
            <p className="page-subtitle">Talking BI enterprise workspace</p>
          </div>

          <div className="top-navbar-actions">
            <label className="top-search" aria-label="Search">
              <Search size={16} />
              <input
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                placeholder="Search dashboards, metrics, or reports"
              />
            </label>

            {usage?.dashboard?.limit !== null && (
              <div className="quota-chip">
                <Sparkles size={14} />
                {Math.max(0, usage?.dashboard?.remaining || 0)} dashboards left
              </div>
            )}

            {usage?.chat?.limit !== null && (
              <div className="quota-chip">
                <Sparkles size={14} />
                {Math.max(0, usage?.chat?.remaining || 0)} chats left
              </div>
            )}

            <div className="plan-chip current">Current Plan: {formatPlanLabel(currentPlanId)}</div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setActiveScreen('pricing')}
            >
              <CreditCard size={16} />
              Upgrade Plan
            </button>

            <div className="profile-menu-wrapper" ref={profileMenuRef}>
              <button
                type="button"
                className="profile-btn"
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
              >
                <UserCircle2 size={22} />
                <span>{user?.email}</span>
                <ChevronDown size={16} />
              </button>

              {isProfileMenuOpen ? (
                <div className="profile-dropdown" role="menu" aria-label="Account menu">
                  <button
                    type="button"
                    className="profile-dropdown-item"
                    onClick={handleLogout}
                  >
                    <LogOut size={14} />
                    Logout
                  </button>
                  <button
                    type="button"
                    className="profile-dropdown-item danger"
                    onClick={handleDeleteAccount}
                  >
                    <Trash2 size={14} />
                    Delete Account
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="main-content-area">
          <AnimatePresence mode="wait">
            {activeScreen === 'pricing' ? (
              <motion.div
                key="pricing"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <PricingV3
                  currentPlan={currentPlanId}
                  onSelectPlan={async (targetPlan) => {
                    try {
                      const result = await apiPost('/api/subscription/plan', { plan: targetPlan });
                      setUser(result?.user || user);
                      await loadUsage();
                      setActiveScreen('custom-dashboard-builder');
                    } catch (err) {
                      alert(err.message || 'Unable to update plan.');
                    }
                  }}
                />
              </motion.div>
            ) : activeScreen === 'custom-dashboard-builder' ? (
              <motion.div
                key="custom-dashboard-builder"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <section className="filters-row">
                  <div className="filter-title">
                    <Filter size={16} />
                    Filters
                  </div>

                  <label className="filter-control">
                    <CalendarRange size={14} />
                    <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
                      <option>Last 7 days</option>
                      <option>Last 30 days</option>
                      <option>This quarter</option>
                      <option>This year</option>
                    </select>
                  </label>

                  <label className="filter-control">
                    <ChartColumn size={14} />
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option>All categories</option>
                      <option>Electronics</option>
                      <option>Clothing</option>
                      <option>Furniture</option>
                    </select>
                  </label>

                  <label className="filter-control">
                    <Globe size={14} />
                    <select value={region} onChange={(e) => setRegion(e.target.value)}>
                      <option>All regions</option>
                      <option>Maharashtra</option>
                      <option>Madhya Pradesh</option>
                      <option>Uttar Pradesh</option>
                      <option>Delhi</option>
                      <option>Rajasthan</option>
                    </select>
                  </label>
                </section>

                <section className="query-card" style={{ marginBottom: '14px' }}>
                  <SearchInterface
                    showQuery={false}
                    onQuerySubmit={() => {}}
                    onDatabaseConnect={handleDatabaseConnect}
                    onDatabaseDisconnect={handleDatabaseDisconnect}
                    onDatasetImportFromUrl={handleDatasetImportFromUrl}
                    onDatasetImportFromCsv={handleDatasetImportFromCsv}
                    onClearImportedDataset={handleClearImportedDataset}
                    isDatabaseConnected={Boolean(databaseInfo?.connected)}
                    databaseStatus={databaseStatus}
                    importedDataset={importedDataset}
                    importStatus={importStatus}
                  />
                </section>

                <section className="query-card" style={{ marginBottom: '14px' }}>
                  <div className="dashboard-action-row">
                    {PLAN_STORAGE_CONFIG[currentPlanId]?.enabled ? (
                      <button type="button" className="btn-primary" onClick={handleSaveDashboard}>
                        Save Dashboard
                      </button>
                    ) : (
                      <span className="dataset-pill">
                        {currentPlanId === 'trial' ? 'Upgrade to enable dashboard save' : 'Storage not available with this plan'}
                      </span>
                    )}
                    {databaseInfo?.connected ? <span className="dataset-pill">Database connected</span> : null}
                    {importedDataset?.datasetId ? <span className="dataset-pill">Dataset imported</span> : null}
                  </div>
                </section>

                <div className="content-split-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
                  <CustomDashboardBuilder
                    filters={activeFilters}
                    initialConfig={pendingBuilderConfig}
                    onStateChange={setBuilderState}
                    onBeforeGenerate={handleBeforeBuilderGenerate}
                    currentPlanId={currentPlanId}
                  />

                  <aside>
                    <section className="saved-dashboards-panel">
                      <h3>Saved Dashboards</h3>
                      {savedDashboards.length ? (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {savedDashboards.map((item) => {
                            const saved = new Date(item.createdAt);
                            const expires = item.expiresAt ? new Date(item.expiresAt) : null;
                            const now = new Date();
                            const daysLeft = expires ? Math.ceil((expires - now) / (1000 * 60 * 60 * 24)) : null;
                            const isExpiringSoon = daysLeft !== null && daysLeft <= 7 && daysLeft > 0;
                            const isExpired = daysLeft !== null && daysLeft <= 0;
                            return (
                              <li
                                key={item.id}
                                onClick={() => !isExpired && handleLoadDashboard(item)}
                                style={{
                                  padding: '10px 12px',
                                  margin: '6px 0',
                                  backgroundColor: isExpired ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                  border: `1px solid ${isExpired ? 'rgba(239, 68, 68, 0.3)' : isExpiringSoon ? 'rgba(245, 158, 11, 0.35)' : 'rgba(59, 130, 246, 0.3)'}`,
                                  borderRadius: '6px',
                                  cursor: isExpired ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.2s ease',
                                  fontSize: '12px',
                                  color: isExpired ? '#fca5a5' : '#e5e7eb',
                                  opacity: isExpired ? 0.7 : 1,
                                }}
                                onMouseEnter={(e) => {
                                  if (isExpired) return;
                                  e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
                                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                                  e.currentTarget.style.transform = 'translateX(4px)';
                                }}
                                onMouseLeave={(e) => {
                                  if (isExpired) return;
                                  e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
                                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)';
                                  e.currentTarget.style.transform = 'translateX(0)';
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>📊 {saved.toLocaleDateString()}</span>
                                  <span style={{ fontSize: '11px', opacity: 0.8 }}>
                                    {daysLeft === null ? 'Forever' : daysLeft > 0 ? `${daysLeft}d left` : 'Expired'}
                                  </span>
                                </div>
                                {expires ? (
                                  <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.75 }}>
                                    Expires: {expires.toLocaleDateString()}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p>No saved dashboards yet.</p>
                      )}
                    </section>
                  </aside>
                </div>
              </motion.div>
            ) : (
              <motion.div key="default-builder-fallback" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <CustomDashboardBuilder
                  filters={activeFilters}
                  initialConfig={pendingBuilderConfig}
                  onStateChange={setBuilderState}
                  onBeforeGenerate={handleBeforeBuilderGenerate}
                  currentPlanId={currentPlanId}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <ChatbotV2
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        plan={plan}
        filters={activeFilters}
        onUsageRefresh={loadUsage}
      />
    </div>
  );
}
