const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { parse: parseCsv } = require('csv-parse/sync');

const prisma = new PrismaClient();
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'replace-with-secure-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const DATASET_CACHE_TTL_MS = 60 * 60 * 1000;
const DASHBOARD_GENERATION_TTL_MS = 15 * 60 * 1000;
const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const MAX_DATASET_ROWS = 20000;

const datasetCache = new Map();
const dashboardGenerationCharges = new Map();
const userDbConnections = new Map();
const PLATFORM_SCHEMAS = new Set([
  'auth',
  'storage',
  'realtime',
  'vault',
  'extensions',
  'graphql',
  'graphql_public',
  'pgbouncer',
]);

const PLAN_RULES = {
  trial: {
    dashboardLimit: { count: 2, windowDays: null },
    storage: { enabled: false, retentionDays: 0 },
    chatLimit: { count: 100, windowDays: 30 },
  },
  plus: {
    dashboardLimit: { count: 3, windowDays: 7 },
    storage: { enabled: false, retentionDays: 0 },
    chatLimit: { count: 10, windowDays: 30 },
  },
  max: {
    dashboardLimit: { count: 10, windowDays: 30 },
    storage: { enabled: true, retentionDays: 30 },
    chatLimit: { count: 20, windowDays: 30 },
  },
  max_plus: {
    dashboardLimit: { count: 30, windowDays: 30 },
    storage: { enabled: true, retentionDays: 180 },
    chatLimit: null,
  },
  pro_max: {
    dashboardLimit: null,
    storage: { enabled: true, retentionDays: 365 },
    chatLimit: null,
  },
};

function planLabel(plan) {
  return String(plan || 'trial').replace('_', ' ');
}

function buildJwt(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    hasDbUrl: Boolean(user.dbUrl),
    createdAt: user.createdAt,
  };
}

function getRuleForPlan(plan) {
  return PLAN_RULES[plan] || PLAN_RULES.trial;
}

function getWindowStart(windowDays) {
  if (!windowDays) return null;
  const d = new Date();
  d.setDate(d.getDate() - windowDays);
  return d;
}

function makeLimitError(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function getUsageTypeEnum(usageType) {
  if (usageType === 'dashboard_generation') return 'dashboard_generation';
  return 'chat';
}

function getDashboardGenerationKey(userId, generationId) {
  const safeGenerationId = String(generationId || '').trim();
  if (!safeGenerationId) return null;
  return `${userId}:${safeGenerationId}`;
}

function pruneDashboardGenerationCharges() {
  const now = Date.now();
  for (const [key, ts] of dashboardGenerationCharges.entries()) {
    if (now - ts > DASHBOARD_GENERATION_TTL_MS) {
      dashboardGenerationCharges.delete(key);
    }
  }
}

async function countUsage(userId, usageType, windowDays) {
  const createdAt = getWindowStart(windowDays);
  return prisma.usageEvent.count({
    where: {
      userId,
      type: getUsageTypeEnum(usageType),
      ...(createdAt ? { createdAt: { gte: createdAt } } : {}),
    },
  });
}

async function enforceDashboardGenerationLimit(user) {
  const rule = getRuleForPlan(user.plan);
  if (!rule.dashboardLimit) return { allowed: true, remaining: null };

  const used = await countUsage(user.id, 'dashboard_generation', rule.dashboardLimit.windowDays);
  if (used >= rule.dashboardLimit.count) {
    const period = rule.dashboardLimit.windowDays === 7 ? 'this week' : (rule.dashboardLimit.windowDays === 30 ? 'this month' : 'your plan period');
    throw makeLimitError(`Dashboard generation limit reached for ${planLabel(user.plan)} plan (${rule.dashboardLimit.count} ${period}). Please upgrade plan.`);
  }

  return {
    allowed: true,
    remaining: rule.dashboardLimit.count - used,
    limit: rule.dashboardLimit.count,
  };
}

async function enforceChatLimit(user) {
  const rule = getRuleForPlan(user.plan);
  if (!rule.chatLimit) return { allowed: true, remaining: null };

  const used = await countUsage(user.id, 'chat', rule.chatLimit.windowDays);
  if (used >= rule.chatLimit.count) {
    throw makeLimitError(`Chat limit reached for ${planLabel(user.plan)} plan. Please upgrade plan.`);
  }

  return {
    allowed: true,
    remaining: rule.chatLimit.count - used,
    limit: rule.chatLimit.count,
  };
}

async function recordUsage(userId, usageType) {
  await prisma.usageEvent.create({
    data: {
      userId,
      type: getUsageTypeEnum(usageType),
    },
  });
}

async function cleanupExpiredDashboardsForUser(userId) {
  await prisma.dashboard.deleteMany({
    where: {
      userId,
      expiresAt: { lte: new Date() },
    },
  });
}

async function cleanupExpiredDashboardsGlobal() {
  await prisma.dashboard.deleteMany({
    where: {
      expiresAt: { lte: new Date() },
    },
  });
}

async function checkStorageAllowed(user) {
  const rule = getRuleForPlan(user.plan);
  if (!rule.storage.enabled) {
    throw makeLimitError(`Storage is not available on ${planLabel(user.plan)} plan. Upgrade to Max, Max Plus or Pro Max.`);
  }
  return rule.storage;
}

function getTokenFromHeader(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

async function optionalAuth(req, _res, next) {
  try {
    const token = getTokenFromHeader(req);
    if (!token) {
      req.user = null;
      return next();
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    req.user = user || null;
    return next();
  } catch (_err) {
    req.user = null;
    return next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
  return next();
}

function validateHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

function normalizeDatasetSourceUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input || !validateHttpUrl(input)) {
    return { url: input, source: 'generic' };
  }

  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();

    if (host === 'drive.google.com' || host === 'www.drive.google.com') {
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
      const fileId = fileMatch?.[1] || parsed.searchParams.get('id');
      if (fileId) {
        return {
          url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
          source: 'google-drive-file',
        };
      }
    }

    if (host === 'docs.google.com' || host === 'www.docs.google.com') {
      const sheetMatch = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/i);
      const sheetId = sheetMatch?.[1];
      if (sheetId) {
        const gid = parsed.searchParams.get('gid') || '0';
        return {
          url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`,
          source: 'google-sheet',
        };
      }
    }
  } catch (_err) {
    return { url: input, source: 'generic' };
  }

  return { url: input, source: 'generic' };
}

function parseDatasetText(text, contentType = '') {
  const normalized = String(contentType || '').toLowerCase();

  if (normalized.includes('application/json') || String(text || '').trim().startsWith('[') || String(text || '').trim().startsWith('{')) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : []);
    if (!Array.isArray(rows)) return [];
    return rows;
  }

  const csvRows = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  return Array.isArray(csvRows) ? csvRows : [];
}

function inferColumns(rows) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  return columns;
}

function isLikelyDate(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.valueOf());
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  let multiplier = 1;
  if (/\bcr\b|\bcrore\b/i.test(lower)) multiplier = 10000000;
  else if (/\blakh\b|\blac\b/i.test(lower)) multiplier = 100000;
  else if (/\bthousand\b|\bk\b/i.test(lower)) multiplier = 1000;
  else if (/\bmillion\b|\bmn\b/i.test(lower)) multiplier = 1000000;
  else if (/\bbillion\b|\bbn\b/i.test(lower)) multiplier = 1000000000;

  const normalized = lower.replace(/[,\s]/g, '');
  const numberMatch = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!numberMatch) return null;

  const n = Number(numberMatch[0]) * multiplier;
  return Number.isFinite(n) ? n : null;
}

function isValidPostgresUrl(dbUrl) {
  try {
    const parsed = new URL(String(dbUrl || ''));
    return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  } catch (_err) {
    return false;
  }
}

function forceNoVerifySslMode(dbUrl) {
  try {
    const parsed = new URL(String(dbUrl || ''));
    parsed.searchParams.set('sslmode', 'no-verify');
    return parsed.toString();
  } catch (_err) {
    return dbUrl;
  }
}

function quoteIdent(name) {
  return `"${String(name || '').replace(/"/g, '""')}"`;
}

function quoteTableRef(table) {
  if (!table) return '""';
  const schema = String(table.schema || '').trim();
  const name = String(table.name || '').trim();
  return schema ? `${quoteIdent(schema)}.${quoteIdent(name)}` : quoteIdent(name);
}

function isPlatformSchema(schemaName) {
  const schema = String(schemaName || '').toLowerCase();
  if (!schema) return true;
  if (schema.startsWith('pg_')) return true;
  return PLATFORM_SCHEMAS.has(schema);
}

function selectPreferredTables(tables = []) {
  const businessTables = tables.filter((t) => !isPlatformSchema(t.schema));
  const publicTables = businessTables.filter((t) => String(t.schema || '').toLowerCase() === 'public');

  if (publicTables.length) return publicTables;
  if (businessTables.length) return businessTables;
  return tables;
}

async function fetchDbSchema(pool) {
  const [columnsResult, pkResult, fkResult, rowCountResult] = await Promise.all([
    pool.query(`
      SELECT table_schema, table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `),
    pool.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND tc.constraint_type = 'PRIMARY KEY'
    `),
    pool.query(`
      SELECT
        tc.table_schema AS source_schema,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_schema AS target_schema,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND tc.constraint_type = 'FOREIGN KEY'
    `),
    pool.query(`
      SELECT
        n.nspname AS table_schema,
        relname AS table_name,
        GREATEST(reltuples::bigint, 0) AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    `),
  ]);

  const tableKey = (schema, table, column = '') => `${schema}.${table}${column ? `.${column}` : ''}`;
  const pkSet = new Set(pkResult.rows.map((row) => tableKey(row.table_schema, row.table_name, row.column_name)));
  const rowCountMap = new Map(
    rowCountResult.rows.map((row) => [tableKey(row.table_schema, row.table_name), Number(row.estimated_rows || 0)]),
  );

  const schemaMap = new Map();
  columnsResult.rows.forEach((row) => {
    const key = tableKey(row.table_schema, row.table_name);
    if (!schemaMap.has(key)) {
      schemaMap.set(key, {
        schema: row.table_schema,
        name: row.table_name,
        columns: [],
      });
    }
    schemaMap.get(key).columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      isPrimaryKey: pkSet.has(tableKey(row.table_schema, row.table_name, row.column_name)),
    });
  });

  const relationships = fkResult.rows.map((row) => ({
    fromSchema: row.source_schema,
    fromTable: row.source_table,
    fromColumn: row.source_column,
    toSchema: row.target_schema,
    toTable: row.target_table,
    toColumn: row.target_column,
  }));

  const discoveredTables = [...schemaMap.values()].map((table) => ({
      schema: table.schema,
      name: table.name,
      columns: table.columns,
      estimatedRows: rowCountMap.get(tableKey(table.schema, table.name)) || 0,
  }));

  const tables = selectPreferredTables(discoveredTables);
  const selectedKeys = new Set(tables.map((t) => tableKey(t.schema, t.name)));
  const filteredRelationships = relationships.filter(
    (r) => selectedKeys.has(tableKey(r.fromSchema, r.fromTable)) && selectedKeys.has(tableKey(r.toSchema, r.toTable)),
  );

  return {
    tables,
    relationships: filteredRelationships,
  };
}

function getSchemaPrompt(schema) {
  if (!schema?.tables?.length) return 'No schema available.';
  const tableBlock = schema.tables
    .slice(0, 30)
    .map((t) => {
      const cols = t.columns
        .map((c) => `${c.name}(${c.dataType}${c.isPrimaryKey ? ',pk' : ''}${c.nullable ? '' : ',not-null'})`)
        .join(', ');
      const qualifiedName = t.schema ? `${t.schema}.${t.name}` : t.name;
      return `${qualifiedName} [rows~${t.estimatedRows || 0}]: ${cols}`;
    })
    .join('\n');

  const relationshipBlock = Array.isArray(schema.relationships) && schema.relationships.length
    ? schema.relationships
      .slice(0, 40)
      .map((r) => `${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}`)
      .join('\n')
    : 'No foreign key relationships detected.';

  return `TABLES:\n${tableBlock}\n\nRELATIONSHIPS:\n${relationshipBlock}`;
}

function suggestKpisFromSchema(schema) {
  const tableHints = [];
  const base = schema?.tables || [];

  base.forEach((table) => {
    const cols = table.columns.map((c) => c.name.toLowerCase());
    const hasRevenue = cols.some((c) => /sales|revenue|amount|price|value|gmv|total/.test(c));
    const hasProfit = cols.some((c) => /profit|margin/.test(c));
    const hasOrder = cols.some((c) => /order.?id|invoice|transaction|txn/.test(c));
    const hasCustomer = cols.some((c) => /customer|client|account/.test(c));
    const hasRegion = cols.some((c) => /region|state|city|country|territory/.test(c));
    const hasCategory = cols.some((c) => /category|segment|product|item|sku/.test(c));

    if (hasRevenue) tableHints.push(`Total revenue from ${table.name}`);
    if (hasProfit) tableHints.push(`Total profit from ${table.name}`);
    if (hasOrder) tableHints.push(`Distinct order count from ${table.name}`);
    if (hasCustomer) tableHints.push(`Distinct customer count from ${table.name}`);
    if (hasRegion && hasRevenue) tableHints.push(`Revenue by region/state from ${table.name}`);
    if (hasCategory && hasRevenue) tableHints.push(`Top categories/products by revenue from ${table.name}`);
  });

  return [...new Set(tableHints)].slice(0, 12);
}

function parseTopLimit(query) {
  const q = String(query || '').toLowerCase();
  const digitMatch = q.match(/\btop\s*(\d+)\b/);
  if (digitMatch) return Math.max(1, Number(digitMatch[1]));

  const bottomDigit = q.match(/\b(least|lowest|bottom)\s*(\d+)\b/);
  if (bottomDigit) return Math.max(1, Number(bottomDigit[2]));

  const wordMap = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const wordMatch = q.match(/\b(top|least|lowest|bottom)\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (wordMatch) return wordMap[wordMatch[2]];
  if (/\btop\b/.test(q)) return 10;
  if (/\bleast\b|\blowest\b|\bbottom\b/.test(q)) return 10;
  return null;
}

function parseSortDirection(query) {
  const q = String(query || '').toLowerCase();
  if (/\bleast\b|\blowest\b|\bbottom\b|\bminimum\b|\bworst\b/.test(q)) return 'ASC';
  return 'DESC';
}

function isNumericDataType(dataType = '') {
  return /smallint|integer|bigint|decimal|numeric|real|double|money/i.test(String(dataType || ''));
}

function quoteColumnRef(alias, columnName) {
  return `${alias}.${quoteIdent(columnName)}`;
}

function numericValueExprByRef(valueRef, dataType = '') {
  if (isNumericDataType(dataType)) return valueRef;

  const baseNumber = `NULLIF(regexp_replace(${valueRef}::text, '[^0-9.\\-]', '', 'g'), '')::numeric`;
  return `COALESCE((CASE
    WHEN lower(${valueRef}::text) ~ '(^|[^a-z])(cr|crore)([^a-z]|$)' THEN ${baseNumber} * 10000000
    WHEN lower(${valueRef}::text) ~ '(^|[^a-z])(lakh|lac)([^a-z]|$)' THEN ${baseNumber} * 100000
    WHEN lower(${valueRef}::text) ~ '(^|[^a-z])(thousand|k)([^a-z]|$)' THEN ${baseNumber} * 1000
    WHEN lower(${valueRef}::text) ~ '(^|[^a-z])(million|mn)([^a-z]|$)' THEN ${baseNumber} * 1000000
    WHEN lower(${valueRef}::text) ~ '(^|[^a-z])(billion|bn)([^a-z]|$)' THEN ${baseNumber} * 1000000000
    ELSE ${baseNumber}
  END), 0)`;
}

function numericValueExpr(column) {
  const name = quoteIdent(column?.name || '');
  return numericValueExprByRef(name, column?.dataType);
}

function pickMetricSpec(columns, query) {
  const q = String(query || '').toLowerCase();
  const findCol = (regex) => columns.find((c) => regex.test(String(c?.name || '')));

  const profitCol = findCol(/profit|margin|gross.?profit|net.?profit/i);
  const amountCol = findCol(/sales|revenue|amount|price|value|gmv|total/i);
  const qtyCol = findCol(/qty|quantity|units|count/i);
  const orderCol = findCol(/order.?id|invoice|transaction|txn/i);

  if (/\bprofit\b|\bmargin\b/.test(q) && profitCol) {
    return { kind: 'sum', column: profitCol };
  }
  if (/\border\b|\borders\b/.test(q)) {
    if (orderCol) return { kind: 'count_distinct', column: orderCol };
    return { kind: 'count' };
  }
  if (/\bqty\b|\bquantity\b|\bunits\b/.test(q) && qtyCol) {
    return { kind: 'sum', column: qtyCol };
  }
  if (amountCol) {
    return { kind: 'sum', column: amountCol };
  }
  if (profitCol) {
    return { kind: 'sum', column: profitCol };
  }
  return { kind: 'count' };
}

function buildMetricExprForAlias(metricSpec, alias) {
  if (!metricSpec || metricSpec.kind === 'count') return 'COUNT(*)';
  if (metricSpec.kind === 'count_distinct' && metricSpec.column) {
    return `COUNT(DISTINCT ${quoteColumnRef(alias, metricSpec.column.name)})`;
  }
  if (metricSpec.kind === 'sum' && metricSpec.column) {
    return `SUM(${numericValueExprByRef(quoteColumnRef(alias, metricSpec.column.name), metricSpec.column.dataType)})`;
  }
  return 'COUNT(*)';
}

function findDirectRelationship(relationships = [], leftTable, rightTable) {
  const leftSchema = String(leftTable?.schema || '');
  const leftName = String(leftTable?.name || '');
  const rightSchema = String(rightTable?.schema || '');
  const rightName = String(rightTable?.name || '');

  return relationships.find((r) => (
    (r.fromSchema === leftSchema && r.fromTable === leftName && r.toSchema === rightSchema && r.toTable === rightName)
    || (r.fromSchema === rightSchema && r.fromTable === rightName && r.toSchema === leftSchema && r.toTable === leftName)
  )) || null;
}

function pickMetricExpression(columns, query) {
  const q = String(query || '').toLowerCase();
  const findCol = (regex) => columns.find((c) => regex.test(String(c?.name || '')));

  const profitCol = findCol(/profit|margin|gross.?profit|net.?profit/i);
  const amountCol = findCol(/sales|revenue|amount|price|value|gmv|total/i);
  const qtyCol = findCol(/qty|quantity|units|count/i);
  const orderCol = findCol(/order.?id|invoice|transaction|txn/i);

  if (/\bprofit\b|\bmargin\b/.test(q) && profitCol) {
    return { expr: `SUM(${numericValueExpr(profitCol)})`, label: 'value' };
  }
  if (/\border\b|\borders\b/.test(q)) {
    if (orderCol) return { expr: `COUNT(DISTINCT ${quoteIdent(orderCol.name)})`, label: 'value' };
    return { expr: 'COUNT(*)', label: 'value' };
  }
  if (/\bqty\b|\bquantity\b|\bunits\b/.test(q) && qtyCol) {
    return { expr: `SUM(${numericValueExpr(qtyCol)})`, label: 'value' };
  }
  if (amountCol) {
    return { expr: `SUM(${numericValueExpr(amountCol)})`, label: 'value' };
  }
  if (profitCol) {
    return { expr: `SUM(${numericValueExpr(profitCol)})`, label: 'value' };
  }
  return { expr: 'COUNT(*)', label: 'value' };
}

function pickDimensionColumn(columns, query) {
  const q = String(query || '').toLowerCase();
  const names = columns.map((c) => c.name);
  const findName = (regex) => names.find((n) => regex.test(String(n || '')));

  if (/\bregion\b|\bregions\b|\bregional\b|\bstate\b|\bstates\b/.test(q)) {
    return findName(/region|state|province|territory/i) || findName(/city/i);
  }
  if (/\bproduct\b|\bitem\b|\bsku\b|\bsub.?category\b/.test(q)) {
    return findName(/sub.?category|product|item|sku|name/i) || findName(/category/i);
  }
  if (/\bcategory\b/.test(q)) {
    return findName(/category|segment|type/i);
  }
  if (/\bcity\b/.test(q)) {
    return findName(/city/i);
  }
  if (/\bcustomer\b/.test(q)) {
    return findName(/customer|client|account/i);
  }
  return findName(/category|sub.?category|region|state|city|name|product/i);
}

function pickDateColumn(columns) {
  const byType = columns.find((c) => /date|time/i.test(String(c.dataType || '')));
  if (byType) return byType.name;
  return columns.map((c) => c.name).find((n) => /date|created|month|time|timestamp/i.test(String(n || '')));
}

function fallbackSqlFromSchema(query, schema) {
  const q = String(query || '').toLowerCase();
  const tables = schema?.tables || [];
  const relationships = schema?.relationships || [];
  if (!tables.length) return null;

  const scored = tables.map((t) => {
    const cols = t.columns;
    const names = cols.map((c) => c.name);
    const metricExpr = pickMetricExpression(cols, q);
    const dimCol = pickDimensionColumn(cols, q);
    const dateCol = pickDateColumn(cols);
    const score = names.reduce((acc, n) => {
      if (/sales|revenue|amount|price|gmv|value/i.test(n)) return acc + 4;
      if (/date|created|month|time/i.test(n)) return acc + 2;
      if (/category|region|state|city|name|location/i.test(n)) return acc + 1;
      return acc;
    }, 0)
      + (metricExpr?.expr ? 3 : 0)
      + (dimCol ? 2 : 0)
      + (dateCol ? 1 : 0)
      + (String(t.schema || '').toLowerCase() === 'public' ? 6 : 0)
      + (/^auth$|^storage$|^realtime$|^vault$|^extensions$|^graphql$|^graphql_public$|^pgbouncer$/i.test(String(t.schema || '')) ? -4 : 0);
    return { table: t, score };
  }).sort((a, b) => b.score - a.score);

  const target = scored[0]?.table || tables[0];
  const columns = target.columns;
  const metricExpr = pickMetricExpression(columns, q);
  const metricSpec = pickMetricSpec(columns, q);
  const dateCol = pickDateColumn(columns);
  const dimCol = pickDimensionColumn(columns, q);
  const topLimit = parseTopLimit(q) || 10;
  const sortDirection = parseSortDirection(q);

  const tableSql = quoteTableRef(target);

  if (dateCol && /last\s*1\s*year|1\s*year|year|monthly|month\s*wise|trend|over\s*time/i.test(q)) {
    return `SELECT date_trunc('month', ${quoteIdent(dateCol)}::timestamp) AS name, ${metricExpr.expr} AS value FROM ${tableSql} WHERE ${quoteIdent(dateCol)} IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 500`;
  }

  if (dimCol) {
    return `SELECT ${quoteIdent(dimCol)} AS name, ${metricExpr.expr} AS value FROM ${tableSql} WHERE ${quoteIdent(dimCol)} IS NOT NULL AND CAST(${quoteIdent(dimCol)} AS text) <> '' GROUP BY 1 ORDER BY 2 ${sortDirection} LIMIT ${topLimit}`;
  }

  // Try direct FK join when metric table doesn't have the asked dimension.
  const joinCandidates = tables
    .filter((t) => !(t.schema === target.schema && t.name === target.name))
    .map((t) => ({
      table: t,
      dimCol: pickDimensionColumn(t.columns, q),
      rel: findDirectRelationship(relationships, target, t),
      score: t.columns.reduce((acc, c) => {
        const name = String(c.name || '');
        if (/category|sub.?category|region|state|city|name|product|customer|client|account|location/i.test(name)) return acc + 2;
        return acc;
      }, 0) + (String(t.schema || '').toLowerCase() === 'public' ? 3 : 0),
    }))
    .filter((entry) => entry.dimCol && entry.rel)
    .sort((a, b) => b.score - a.score);

  if (joinCandidates.length) {
    const best = joinCandidates[0];
    const rel = best.rel;
    const metricAlias = 'm';
    const dimAlias = 'd';
    const metricTableSql = `${quoteTableRef(target)} ${metricAlias}`;
    const dimTableSql = `${quoteTableRef(best.table)} ${dimAlias}`;
    const metricExprJoin = buildMetricExprForAlias(metricSpec, metricAlias);

    let joinCondition;
    if (rel.fromSchema === target.schema && rel.fromTable === target.name) {
      joinCondition = `${quoteColumnRef(metricAlias, rel.fromColumn)} = ${quoteColumnRef(dimAlias, rel.toColumn)}`;
    } else {
      joinCondition = `${quoteColumnRef(metricAlias, rel.toColumn)} = ${quoteColumnRef(dimAlias, rel.fromColumn)}`;
    }

    return `SELECT ${quoteColumnRef(dimAlias, best.dimCol)} AS name, ${metricExprJoin} AS value FROM ${metricTableSql} JOIN ${dimTableSql} ON ${joinCondition} WHERE ${quoteColumnRef(dimAlias, best.dimCol)} IS NOT NULL AND CAST(${quoteColumnRef(dimAlias, best.dimCol)} AS text) <> '' GROUP BY 1 ORDER BY 2 ${sortDirection} LIMIT ${topLimit}`;
  }

  if (metricExpr?.expr && metricExpr.expr !== 'COUNT(*)') {
    return `SELECT ${metricExpr.expr} AS value FROM ${tableSql}`;
  }

  if (dimCol) {
    return `SELECT ${quoteIdent(dimCol)} AS name, COUNT(*) AS value FROM ${tableSql} WHERE ${quoteIdent(dimCol)} IS NOT NULL GROUP BY 1 ORDER BY 2 ${sortDirection} LIMIT ${topLimit}`;
  }

  if (typeof dimCol === 'string' && /^[a-z_][a-z0-9_]*$/i.test(dimCol)) {
    return `SELECT ${quoteIdent(dimCol)} AS name, COUNT(*) AS value FROM ${tableSql} GROUP BY 1 ORDER BY 2 DESC LIMIT ${topLimit}`;
  }

  const firstStringCol = columns.find((c) => /text|varchar|char/i.test(String(c.dataType || '')));
  if (firstStringCol) {
    return `SELECT CAST(${quoteIdent(firstStringCol.name)} AS text) AS name, COUNT(*) AS value FROM ${tableSql} WHERE ${quoteIdent(firstStringCol.name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT ${topLimit}`;
  }

  return `SELECT * FROM ${tableSql} LIMIT 100`;
}

async function generateSqlFromNl({ query, schema }) {
  const fallbackSql = fallbackSqlFromSchema(query, schema);
  if (!GROQ_API_KEY || typeof fetch !== 'function') {
    return fallbackSql;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: [
              'Convert analytics questions into safe PostgreSQL SELECT SQL only.',
              'Return raw SQL only, no markdown, no explanation.',
              'Use only tables and columns provided in schema.',
              'When multiple tables are needed, JOIN them using known FK relationships from schema.',
              'Prefer COUNT(DISTINCT ...) for customer/order counts when query asks for counts.',
              'Alias dimension as name and metric as value where possible for chart compatibility.',
              'Never output INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE.',
            ].join(' '),
          },
          {
            role: 'user',
            content: `Schema:\n${getSchemaPrompt(schema)}\n\nQuestion: ${query}`,
          },
        ],
      }),
    });

    clearTimeout(timeout);
    if (!response.ok) return fallbackSql;

    const result = await response.json();
    const sql = String(result?.choices?.[0]?.message?.content || '').trim();
    if (!sql) return fallbackSql;
    return sql;
  } catch (_err) {
    return fallbackSql;
  }
}

function sanitizeSql(sql) {
  const cleaned = String(sql || '').replace(/```sql|```/gi, '').trim();
  if (!cleaned) return null;
  const normalized = cleaned.toLowerCase();
  if (!normalized.startsWith('select')) return null;
  if (normalized.includes(';') && normalized.indexOf(';') !== normalized.length - 1) return null;
  if (/(insert|update|delete|drop|alter|truncate|create)\s+/i.test(normalized)) return null;
  if (/\blimit\b/i.test(normalized)) return cleaned;
  return `${cleaned} LIMIT 500`;
}

function normalizeRowsToSeries(rows = []) {
  if (!rows.length) return [];
  
  const first = rows[0];
  const keys = Object.keys(first);

  if (!keys.length) return [];

  const valueKey = keys.find((k) => /^value$/i.test(k)) 
    || keys.find((k) => /value|total|sum|revenue|sales|profit|amount|count|cnt/i.test(k)) 
    || keys.find((k) => typeof first[k] === 'number') 
    || keys[keys.length - 1];

  const nameKey = keys.find((k) => /^name$/i.test(k)) 
    || keys.find((k) => /name|month|date|category|region|state|city|label|location|title/i.test(k)) 
    || (valueKey !== keys[0] ? keys[0] : keys[1]);

  if (!nameKey || !valueKey) return [];

  const normalizeName = (raw) => {
    if (raw === null || raw === undefined) return 'Unknown';
    if (raw instanceof Date) {
      const day = String(raw.getDate()).padStart(2, '0');
      const month = raw.toLocaleString('en-IN', { month: 'short' });
      const year = raw.getFullYear();
      return `${day} ${month} ${year}`;
    }
    const asString = String(raw).trim();
    if (!asString) return 'Unknown';
    const parsedDate = new Date(asString);
    if (!Number.isNaN(parsedDate.valueOf()) && /gmt|utc|\d{4}-\d{2}-\d{2}|t\d{2}:\d{2}/i.test(asString)) {
      const day = String(parsedDate.getDate()).padStart(2, '0');
      const month = parsedDate.toLocaleString('en-IN', { month: 'short' });
      const year = parsedDate.getFullYear();
      return `${day} ${month} ${year}`;
    }
    return asString.substring(0, 100);
  };

  return rows
    .map((row, idx) => {
      const numVal = toNumber(row[valueKey]);
      return {
        name: normalizeName(row[nameKey]) || `Row ${idx + 1}`,
        value: typeof numVal === 'number' ? numVal : 0,
      };
    })
    .filter((row) => Number.isFinite(row.value))
    .slice(0, 100);
}

function buildDbAnswerFromSeries(series, query, rowCount) {
  const q = String(query || '').toLowerCase();
  const top = series[0];
  const second = series[1];
  const bottom = series[series.length - 1];

  const formatValue = (value) => Number(value || 0).toLocaleString();

  if (/how many|count|number of|total rows|total records|records?\b/.test(q)) {
    return `Connected DB: ${rowCount} matching row${rowCount === 1 ? '' : 's'} returned.`;
  }

  if (/least|lowest|bottom|min(imum)?|smallest/.test(q) && bottom) {
    return `Connected DB: Lowest is ${bottom.name} with value ${formatValue(bottom.value)}.`;
  }

  if (/compare|vs|between|difference|top and bottom/.test(q) && top && bottom) {
    const gap = Math.abs(Number(top.value || 0) - Number(bottom.value || 0));
    return `Connected DB: Top is ${top.name} with value ${formatValue(top.value)} and bottom is ${bottom.name} with value ${formatValue(bottom.value)}. Gap: ${formatValue(gap)}.`;
  }

  if (/trend|over time|monthly|month|year|timeline|growth/.test(q) && top && second) {
    return `Connected DB: ${series.length} points returned. First is ${top.name} with value ${formatValue(top.value)}, next is ${second.name} with value ${formatValue(second.value)}.`;
  }

  if (top) {
    const extra = second ? ` Next is ${second.name} with value ${formatValue(second.value)}.` : '';
    return `Connected DB: ${rowCount} row${rowCount === 1 ? '' : 's'} returned. Top is ${top.name} with value ${formatValue(top.value)}.${extra}`;
  }

  return 'Connected DB query executed successfully.';
}

function chooseChartTypeFromRows(rows = []) {
  if (!rows.length) return 'bar';
  const keys = Object.keys(rows[0]);
  const likelyTime = keys.some((k) => /date|month|year|time/i.test(k));
  if (likelyTime) return 'line';
  if (rows.length <= 5) return 'pie';
  return 'bar';
}

function isComplexUserDbQuery(query = '') {
  const q = String(query || '').toLowerCase();
  return /join|compare|correlation|cohort|retention|funnel|forecast|prediction|anomaly|segment overlap/.test(q);
}

async function connectUserDatabase(userId, dbUrl) {
  if (!isValidPostgresUrl(dbUrl)) {
    throw new Error('Invalid PostgreSQL connection URL.');
  }

  const existing = userDbConnections.get(userId);
  if (existing?.url === dbUrl && existing?.pool) {
    try {
      await existing.pool.query('SELECT 1');
      return existing;
    } catch (_err) {
      await existing.pool.end().catch(() => null);
      userDbConnections.delete(userId);
    }
  }

  if (existing?.pool) {
    existing.pool.end().catch(() => null);
  }

  const normalizedDbUrl = String(dbUrl || '').toLowerCase();
  const shouldUseTls =
    normalizedDbUrl.includes('sslmode=require')
    || normalizedDbUrl.includes('ssl=true')
    || normalizedDbUrl.includes('neon.tech')
    || normalizedDbUrl.includes('supabase.co');

  let connectionString = dbUrl;
  let pool = new Pool({
    connectionString,
    // Managed providers and some networks return non-standard cert chains.
    ssl: shouldUseTls ? { rejectUnauthorized: false } : false,
    max: 4,
    idleTimeoutMillis: 30000,
  });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    const certIssue = /self-signed certificate|unable to verify|certificate chain/i.test(String(err?.message || ''));
    if (!shouldUseTls || !certIssue) {
      throw err;
    }

    await pool.end().catch(() => null);
    connectionString = forceNoVerifySslMode(dbUrl);
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30000,
    });
    await pool.query('SELECT 1');
  }
  const schema = await fetchDbSchema(pool);

  const record = {
    url: dbUrl,
    pool,
    schema,
    connectedAt: Date.now(),
  };
  userDbConnections.set(userId, record);
  return record;
}

async function getUserDbConnection(user) {
  if (!user?.id || !user?.dbUrl) return null;

  const existing = userDbConnections.get(user.id);
  if (existing?.pool) {
    try {
      await existing.pool.query('SELECT 1');
      return existing;
    } catch (_err) {
      await existing.pool.end().catch(() => null);
      userDbConnections.delete(user.id);
    }
  }

  try {
    return await connectUserDatabase(user.id, user.dbUrl);
  } catch (_err) {
    return null;
  }
}

function getDatasetResult(rows, query) {
  const normalizedQuery = String(query || '').toLowerCase();
  if (!rows.length) {
    return {
      answer: 'Dataset has no rows.',
      data: [],
      chartType: 'bar',
      insights: [],
    };
  }

  const columns = inferColumns(rows);
  const numericCols = columns.filter((c) => {
    const sample = rows.slice(0, Math.min(rows.length, 100));
    const valid = sample.filter((r) => toNumber(r[c]) !== null).length;
    return sample.length > 0 && valid / sample.length > 0.6;
  });
  const stringCols = columns.filter((c) => !numericCols.includes(c));
  const dateCols = stringCols.filter((c) => rows.slice(0, Math.min(rows.length, 100)).some((r) => isLikelyDate(r[c])));

  const metricCol = numericCols.find((c) => /sales|revenue|amount|price|value|profit|qty|quantity/i.test(c)) || numericCols[0];
  const wantsTrend = /trend|month|time|over\s+time|daily|date/i.test(normalizedQuery);

  if (!metricCol) {
    return {
      answer: 'I could not find numeric columns in this dataset for chart generation.',
      data: [],
      chartType: 'bar',
      insights: [],
    };
  }

  if (wantsTrend && dateCols.length > 0) {
    const dateCol = dateCols[0];
    const bucket = new Map();
    rows.forEach((row) => {
      const d = new Date(row[dateCol]);
      if (Number.isNaN(d.valueOf())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const val = toNumber(row[metricCol]);
      if (val === null) return;
      bucket.set(key, (bucket.get(key) || 0) + val);
    });

    const data = [...bucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }));

    return {
      answer: `Generated monthly trend from dataset using ${metricCol}.`,
      data,
      chartType: 'line',
      insights: data.length
        ? [`Latest period: ${data[data.length - 1].name} value ${data[data.length - 1].value.toLocaleString()}`]
        : [],
    };
  }

  const dimensionCol = stringCols.find((c) => /category|type|segment|region|state|city|name|product/i.test(c)) || stringCols[0];

  if (!dimensionCol) {
    const total = rows.reduce((sum, row) => sum + (toNumber(row[metricCol]) || 0), 0);
    return {
      answer: `Total ${metricCol}: ${total.toLocaleString()}`,
      data: [],
      chartType: null,
      insights: [`Total ${metricCol}: ${total.toLocaleString()}`],
    };
  }

  const grouped = new Map();
  rows.forEach((row) => {
    const key = String(row[dimensionCol] || 'Unknown');
    const val = toNumber(row[metricCol]);
    if (val === null) return;
    grouped.set(key, (grouped.get(key) || 0) + val);
  });

  const data = [...grouped.entries()]
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  const top = data[0];
  return {
    answer: top
      ? `Top ${dimensionCol}: ${top.name} with ${top.value.toLocaleString()} (${metricCol}).`
      : `Generated dataset chart using ${metricCol} by ${dimensionCol}.`,
    data,
    chartType: data.length <= 5 ? 'pie' : 'bar',
    insights: top ? [`Top segment ${top.name}: ${top.value.toLocaleString()}`] : [],
  };
}

router.post('/auth/signup', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const plan = String(req.body.plan || 'trial');
    const consent = req.body.consent === true;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (!PLAN_RULES[plan]) {
      return res.status(400).json({ error: 'Invalid plan selected.' });
    }
    if (!consent) {
      return res.status(400).json({ error: 'Consent required to create account' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        plan,
        consent: true,
      },
    });

    const token = buildJwt(user);
    return res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = buildJwt(user);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/auth/me', requireAuth, async (req, res) => {
  return res.json({ user: safeUser(req.user) });
});

router.delete('/auth/account', requireAuth, async (req, res) => {
  try {
    userDbConnections.delete(req.user.id);

    await prisma.user.delete({
      where: { id: req.user.id },
    });

    return res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/subscription/plan', requireAuth, async (req, res) => {
  try {
    const plan = String(req.body.plan || '').trim();
    if (!PLAN_RULES[plan]) {
      return res.status(400).json({ error: 'Invalid plan.' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { plan },
    });

    return res.json({ user: safeUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/usage/status', requireAuth, async (req, res) => {
  try {
    const rule = getRuleForPlan(req.user.plan);

    let dashboard = { limit: null, used: null, remaining: null };
    if (rule.dashboardLimit) {
      const used = await countUsage(req.user.id, 'dashboard_generation', rule.dashboardLimit.windowDays);
      dashboard = {
        limit: rule.dashboardLimit.count,
        used,
        remaining: Math.max(0, rule.dashboardLimit.count - used),
        windowDays: rule.dashboardLimit.windowDays,
      };
    }

    let chat = { limit: null, used: null, remaining: null };
    if (rule.chatLimit) {
      const used = await countUsage(req.user.id, 'chat', rule.chatLimit.windowDays);
      chat = {
        limit: rule.chatLimit.count,
        used,
        remaining: Math.max(0, rule.chatLimit.count - used),
        windowDays: rule.chatLimit.windowDays,
      };
    }

    return res.json({
      plan: req.user.plan,
      dashboard,
      chat,
      storage: rule.storage,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/usage/check-dashboard', requireAuth, async (req, res) => {
  try {
    const result = await enforceDashboardGenerationLimit(req.user);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/dashboards/save', requireAuth, async (req, res) => {
  try {
    const config = req.body.config;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'config JSON is required.' });
    }

    const storage = await checkStorageAllowed(req.user);
    await cleanupExpiredDashboardsForUser(req.user.id);

    const expiresAt = storage.retentionDays > 0
      ? new Date(Date.now() + storage.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    const dashboard = await prisma.dashboard.create({
      data: {
        userId: req.user.id,
        config,
        expiresAt,
      },
    });

    return res.status(201).json({ dashboard });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/dashboards/mine', requireAuth, async (req, res) => {
  try {
    await cleanupExpiredDashboardsForUser(req.user.id);
    const dashboards = await prisma.dashboard.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        config: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ dashboards });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/db/connect', requireAuth, async (req, res) => {
  try {
    const dbUrl = String(req.body.dbUrl || '').trim();
    if (!isValidPostgresUrl(dbUrl)) {
      return res.status(400).json({ error: 'Please provide a valid PostgreSQL connection URL.' });
    }

    const connection = await connectUserDatabase(req.user.id, dbUrl);
    await prisma.user.update({ where: { id: req.user.id }, data: { dbUrl } });

    return res.json({
      connected: true,
      message: 'Connected successfully.',
      schema: {
        tables: connection.schema.tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          columns: t.columns.map((c) => c.name),
        })),
      },
    });
  } catch (err) {
    return res.status(400).json({ error: `Connection failed: ${err.message}` });
  }
});

router.post('/db/disconnect', requireAuth, async (req, res) => {
  try {
    const existing = userDbConnections.get(req.user.id);
    if (existing?.pool) {
      await existing.pool.end().catch(() => null);
    }
    userDbConnections.delete(req.user.id);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { dbUrl: null },
    });

    return res.json({ connected: false, message: 'Database disconnected successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/db/status', requireAuth, async (req, res) => {
  try {
    const conn = await getUserDbConnection(req.user);
    if (!conn) {
      return res.json({ connected: false, schema: { tables: [] } });
    }

    return res.json({
      connected: true,
      schema: {
        tables: conn.schema.tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          columns: t.columns.map((c) => c.name),
        })),
      },
    });
  } catch (_err) {
    return res.json({ connected: false, schema: { tables: [] } });
  }
});

router.get('/db/schema', requireAuth, async (req, res) => {
  try {
    const conn = await getUserDbConnection(req.user);
    if (!conn) {
      return res.status(404).json({ error: 'No database connection found for this user.' });
    }

    return res.json({
      tables: conn.schema.tables.map((t) => ({
        schema: t.schema,
        name: t.name,
        columns: t.columns,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/db/intelligence', requireAuth, async (req, res) => {
  try {
    const conn = await getUserDbConnection(req.user);
    if (!conn) {
      return res.status(404).json({ error: 'No database connection found for this user.' });
    }

    const kpiHints = suggestKpisFromSchema(conn.schema);
    const queryHints = [
      'Top 10 customers by revenue',
      'Revenue by month for last 12 months',
      'Region-wise customer count',
      'Top categories by profit',
      'Lowest 5 products by sales',
    ];

    return res.json({
      source: 'user_db',
      schema: {
        tables: conn.schema.tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          estimatedRows: t.estimatedRows || 0,
          columns: t.columns,
        })),
        relationships: conn.schema.relationships || [],
      },
      kpiHints,
      queryHints,
      note: 'Use /api/chat with useUserDb=true to generate SQL and chart data from this schema.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/db/kpis', requireAuth, async (req, res) => {
  try {
    const conn = await getUserDbConnection(req.user);
    if (!conn) {
      return res.status(404).json({ error: 'No database connection found.' });
    }

    const tables = conn.schema.tables || [];
    const candidates = tables
      .map((t) => {
        const cols = t.columns.map((c) => c.name);
        const score = cols.reduce((acc, c) => {
          if (/sales|revenue|amount|value|price/i.test(c)) return acc + 4;
          if (/profit|margin/i.test(c)) return acc + 3;
          if (/order.?id|order|invoice|txn|transaction/i.test(c)) return acc + 2;
          if (/product|sku|item|category/i.test(c)) return acc + 1;
          return acc;
        }, 0);
        return { table: t, score };
      })
      .sort((a, b) => b.score - a.score);

    const target = candidates[0]?.table;
    if (!target) {
      return res.json({
        source: 'user_db',
        kpis: {
          totalRevenue: 0,
          totalProfit: 0,
          totalOrders: 0,
          averageOrderValue: 0,
          uniqueProducts: 0,
        },
      });
    }

    const cols = target.columns.map((c) => c.name);
    const colMap = new Map(target.columns.map((c) => [c.name, c]));
    const revenueCol = cols.find((c) => /sales|revenue|amount|value|price/i.test(c));
    const profitCol = cols.find((c) => /profit|margin/i.test(c));
    const orderCol = cols.find((c) => /order.?id|order|invoice|txn|transaction/i.test(c));
    const productCol = cols.find((c) => /product|sku|item|category/i.test(c));

    const selects = [];
    selects.push(revenueCol ? `COALESCE(SUM(${numericValueExpr(colMap.get(revenueCol))}), 0) AS total_revenue` : '0 AS total_revenue');
    selects.push(profitCol ? `COALESCE(SUM(${numericValueExpr(colMap.get(profitCol))}), 0) AS total_profit` : '0 AS total_profit');
    selects.push(orderCol ? `COUNT(DISTINCT ${quoteIdent(orderCol)}) AS total_orders` : 'COUNT(*) AS total_orders');
    selects.push(productCol ? `COUNT(DISTINCT ${quoteIdent(productCol)}) AS unique_products` : '0 AS unique_products');

    const sql = `SELECT ${selects.join(', ')} FROM ${quoteTableRef(target)}`;
    const result = await conn.pool.query(sql);
    const row = result.rows[0] || {};

    const totalRevenue = Number(row.total_revenue || 0);
    const totalOrders = Number(row.total_orders || 0);

    return res.json({
      source: 'user_db',
      kpis: {
        totalRevenue,
        totalProfit: Number(row.total_profit || 0),
        totalOrders,
        averageOrderValue: totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0,
        uniqueProducts: Number(row.unique_products || 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/datasets/from-url', requireAuth, async (req, res) => {
  try {
    const url = String(req.body.url || '').trim();
    if (!url || !validateHttpUrl(url)) {
      return res.status(400).json({ error: 'Please provide a valid http/https dataset URL.' });
    }

    const normalized = normalizeDatasetSourceUrl(url);
    const response = await fetch(normalized.url, {
      redirect: 'follow',
      headers: {
        Accept: 'text/csv,application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 TalkingBI-DatasetFetcher',
      },
    });
    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch dataset URL (${response.status}).` });
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_FETCH_BYTES) {
      return res.status(413).json({ error: 'Dataset is too large. Max size is 25 MB.' });
    }

    const text = await response.text();
    if (text.length > MAX_FETCH_BYTES) {
      return res.status(413).json({ error: 'Dataset is too large. Max size is 25 MB.' });
    }

    const contentType = response.headers.get('content-type') || '';
    const isHtml = /text\/html/i.test(contentType) || String(text || '').trim().toLowerCase().startsWith('<!doctype html');
    if (isHtml) {
      return res.status(400).json({
        error: normalized.source.startsWith('google-')
          ? 'Google Drive/Sheets link is not publicly downloadable as CSV. Set file access to "Anyone with the link" and try again.'
          : 'Provided URL returned HTML instead of CSV/JSON data.',
      });
    }

    const parsedRows = parseDatasetText(text, contentType).slice(0, MAX_DATASET_ROWS);
    if (!parsedRows.length) {
      return res.status(400).json({ error: 'No rows found in dataset URL.' });
    }

    const columns = inferColumns(parsedRows);
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    datasetCache.set(datasetId, {
      userId: req.user.id,
      rows: parsedRows,
      columns,
      createdAt: Date.now(),
      sourceUrl: normalized.url,
    });

    return res.status(201).json({
      datasetId,
      rowCount: parsedRows.length,
      columns,
      sample: parsedRows.slice(0, 5),
      sourceType: normalized.source,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/datasets/from-csv', requireAuth, async (req, res) => {
  try {
    const csvText = String(req.body.csvText || '').trim();
    if (!csvText) {
      return res.status(400).json({ error: 'Please provide CSV data.' });
    }

    if (csvText.length > MAX_FETCH_BYTES) {
      return res.status(413).json({ error: 'CSV is too large. Max size is 25 MB.' });
    }

    const parsedRows = parseDatasetText(csvText, 'text/csv').slice(0, MAX_DATASET_ROWS);
    if (!parsedRows.length) {
      return res.status(400).json({ error: 'No rows found in CSV data.' });
    }

    const columns = inferColumns(parsedRows);
    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    datasetCache.set(datasetId, {
      userId: req.user.id,
      rows: parsedRows,
      columns,
      createdAt: Date.now(),
      sourceUrl: null,
    });

    return res.status(201).json({
      datasetId,
      rowCount: parsedRows.length,
      columns,
      sample: parsedRows.slice(0, 5),
      sourceType: 'csv-upload',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function getDatasetForUser(datasetId, userId) {
  const entry = datasetCache.get(datasetId);
  if (!entry) return null;
  if (entry.userId !== userId) return null;
  if (Date.now() - entry.createdAt > DATASET_CACHE_TTL_MS) {
    datasetCache.delete(datasetId);
    return null;
  }
  return entry;
}

function detectNumericColumns(rows = [], columns = []) {
  const sample = rows.slice(0, Math.min(rows.length, 120));
  return columns.filter((col) => {
    const valid = sample.filter((row) => toNumber(row[col]) !== null).length;
    return sample.length > 0 && valid / sample.length >= 0.6;
  });
}

function chooseColumn(columns = [], regex, fallbackList = []) {
  const byRegex = columns.find((c) => regex.test(String(c || '')));
  if (byRegex) return byRegex;
  return fallbackList.find((c) => columns.includes(c)) || null;
}

function computeDatasetKpis(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      totalRevenue: 0,
      totalProfit: 0,
      totalOrders: 0,
      averageOrderValue: 0,
      uniqueProducts: 0,
    };
  }

  const columns = inferColumns(rows);
  const numericCols = detectNumericColumns(rows, columns);
  const revenueCol = chooseColumn(numericCols, /(sales|revenue|amount|value|price|gmv|income)/i, [numericCols[0]]);
  const profitCol = chooseColumn(numericCols, /(profit|margin)/i, []);
  const orderIdCol = chooseColumn(columns, /(order.?id|orderid|invoice|transaction|txn)/i, []);
  const productCol = chooseColumn(columns, /(product|item|sku|sub.?category|category)/i, []);

  const totalRevenue = revenueCol
    ? rows.reduce((sum, row) => sum + (toNumber(row[revenueCol]) || 0), 0)
    : 0;

  const totalProfit = profitCol
    ? rows.reduce((sum, row) => sum + (toNumber(row[profitCol]) || 0), 0)
    : 0;

  const totalOrders = orderIdCol
    ? new Set(rows.map((row) => String(row[orderIdCol] || '').trim()).filter(Boolean)).size
    : rows.length;

  const uniqueProducts = productCol
    ? new Set(rows.map((row) => String(row[productCol] || '').trim()).filter(Boolean)).size
    : 0;

  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalOrders,
    averageOrderValue: Number(averageOrderValue.toFixed(2)),
    uniqueProducts,
  };
}

router.get('/datasets/kpis', requireAuth, async (req, res) => {
  try {
    const datasetId = String(req.query.datasetId || '').trim();
    if (!datasetId) {
      return res.status(400).json({ error: 'datasetId is required.' });
    }

    const dataset = getDatasetForUser(datasetId, req.user.id);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found or expired.' });
    }

    const kpis = computeDatasetKpis(dataset.rows || []);
    return res.json({
      datasetId,
      source: 'dataset_url',
      kpis,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of datasetCache.entries()) {
    if (now - value.createdAt > DATASET_CACHE_TTL_MS) {
      datasetCache.delete(key);
    }
  }
  pruneDashboardGenerationCharges();
}, 10 * 60 * 1000);

setInterval(() => {
  cleanupExpiredDashboardsGlobal().catch((err) => {
    console.error('[SCHEDULED CLEANUP ERROR]', err.message);
  });
}, 60 * 60 * 1000);

async function applyUsagePolicy(user, usageType, options = {}) {
  if (!user) {
    throw makeLimitError('Please login to use this feature.');
  }

  if (usageType === 'dashboard_generation') {
    const generationKey = getDashboardGenerationKey(user.id, options.generationId);
    if (generationKey && dashboardGenerationCharges.has(generationKey)) {
      return { allowed: true, remaining: null, deduped: true };
    }

    if (generationKey) {
      dashboardGenerationCharges.set(generationKey, Date.now());
    }

    try {
      await enforceDashboardGenerationLimit(user);
      await recordUsage(user.id, 'dashboard_generation');

      if (generationKey) {
        dashboardGenerationCharges.set(generationKey, Date.now());
      }

      return { allowed: true, remaining: null, deduped: false };
    } catch (err) {
      if (generationKey) {
        dashboardGenerationCharges.delete(generationKey);
      }
      throw err;
    }
  }

  await enforceChatLimit(user);
  await recordUsage(user.id, 'chat');
}

function getDatasetAnalytics(datasetId, user, query) {
  if (!datasetId || !user) return null;
  const dataset = getDatasetForUser(datasetId, user.id);
  if (!dataset) return null;
  return getDatasetResult(dataset.rows, query);
}

async function getUserDbAnalytics(user, query, filters = {}) {
  if (!user || !filters?.useUserDb) return null;

  const conn = await getUserDbConnection(user);
  if (!conn) {
    return {
      answer: 'No connected database found. Please connect your PostgreSQL database first.',
      sql: '',
      data: [],
      chartType: null,
      insights: [],
      provider: 'user-db-engine',
    };
  }

  let rawSql, sql, result, finalSql, rows, series;

  const debugLog = (phase, msg) => {
    console.log(`[DB-ANALYTICS] ${phase}: ${msg}`);
  };

  try {
    debugLog('SQL_GEN', `query="${query.substring(0, 50)}..."`);
    if (isComplexUserDbQuery(query)) {
      rawSql = await generateSqlFromNl({ query, schema: conn.schema });
    }
    if (!rawSql) {
      rawSql = fallbackSqlFromSchema(query, conn.schema);
    }
    sql = sanitizeSql(rawSql);

    if (!sql) {
      throw new Error('SQL generation failed: no valid SQL output');
    }

    debugLog('SQL_VALID', `sql="${sql.substring(0, 80)}..."`);
    result = await conn.pool.query(sql);
    finalSql = sql;
    debugLog('SQL_EXEC', `rows=${result.rows.length}`);
  } catch (sqlErr) {
    debugLog('SQL_FAIL', sqlErr.message);
    try {
      const candidates = [
        sanitizeSql(await generateSqlFromNl({ query, schema: conn.schema })),
        sanitizeSql(fallbackSqlFromSchema(query, conn.schema)),
      ].filter(Boolean);

      if (!candidates.length) throw new Error('Fallback SQL generation also failed');

      let recovered = false;
      for (const candidate of candidates) {
        try {
          debugLog('FALLBACK_TRY', `sql="${candidate.substring(0, 80)}..."`);
          result = await conn.pool.query(candidate);
          finalSql = candidate;
          debugLog('FALLBACK_OK', `rows=${result.rows.length}`);
          recovered = true;
          break;
        } catch (candidateErr) {
          debugLog('FALLBACK_SQL_FAIL', candidateErr.message);
        }
      }

      if (!recovered) {
        throw new Error('All fallback SQL attempts failed');
      }
    } catch (fallbackErr) {
      debugLog('FALLBACK_FAIL', fallbackErr.message);
      throw fallbackErr;
    }
  }

  rows = Array.isArray(result.rows) ? result.rows : [];
  if (!rows.length) {
    debugLog('EMPTY_RESULT', 'Query returned no rows');
    return {
      answer: 'Query executed but returned no rows matching your criteria. Try adjusting filters or asking a different question.',
      sql: '',
      data: [],
      chartType: null,
      insights: [],
      provider: 'user-db-engine',
    };
  }

  try {
    series = normalizeRowsToSeries(rows);
    debugLog('SERIES_NORM', `normalized=${series.length}/${rows.length}`);

    if (!series.length) {
      debugLog('SERIES_EMPTY', 'Normalization produced no series data');
      return {
        answer: `Query returned ${rows.length} row(s) but no valid numeric insights could be extracted.`,
        sql: finalSql,
        data: [],
        chartType: null,
        insights: [`Query found ${rows.length} rows with columns: ${Object.keys(rows[0]).join(', ')}`],
        provider: 'user-db-engine',
      };
    }

    const chartType = chooseChartTypeFromRows(series);
    const top = series[0];
    debugLog('SUCCESS', `chart=${chartType}, top=${top.name} (${top.value})`);

    return {
      answer: buildDbAnswerFromSeries(series, query, rows.length),
      sql: finalSql,
      data: series,
      chartType,
      insights: top ? [
        `Top: ${top.name} (${Number(top.value).toLocaleString()})`,
        ...(series[1] ? [`Runner-up: ${series[1].name} (${Number(series[1].value).toLocaleString()})`] : []),
      ] : [],
      provider: 'user-db-engine',
    };
  } catch (serieErr) {
    debugLog('SERIES_ERR', serieErr.message);
    return {
      answer: `Query executed but encountered an error during result processing: ${serieErr.message}`,
      sql: finalSql,
      data: [],
      chartType: null,
      insights: [],
      provider: 'user-db-engine',
    };
  }
}

module.exports = {
  prisma,
  saasRouter: router,
  optionalAuth,
  requireAuth,
  applyUsagePolicy,
  getDatasetAnalytics,
  getUserDbAnalytics,
};
