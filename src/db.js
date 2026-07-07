'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { canonicalCountry } = require('./geography');
const { canonicalCloud }   = require('../public/clouds');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'icp-cache.db');

let _db;

function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  // Canonical cloud-name normaliser, usable inside SQL (combinations grouping).
  _db.function('canon_cloud', { deterministic: true }, v => canonicalCloud(v));
  migrate(_db);
  return _db;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

function migrate(db) {
  db.exec(`
    -- HubSpot contacts cache
    CREATE TABLE IF NOT EXISTS contacts (
      hubspot_id        TEXT PRIMARY KEY,
      email             TEXT,
      firstname         TEXT,
      lastname          TEXT,
      name              TEXT,
      jobtitle          TEXT,
      phone             TEXT,
      country           TEXT,
      industry          TEXT,
      numberofemployees INTEGER,
      company_name      TEXT,
      lifecyclestage    TEXT,
      lead_source       TEXT,
      mql_type          TEXT,
      source_cloud      TEXT,
      destination_cloud TEXT,
      type_of_destination TEXT,
      tech_stack        TEXT,
      hubspot_owner_id  TEXT,
      owner_assigned_date TEXT,
      create_date       TEXT,
      mql_date          TEXT,
      hs_analytics_source TEXT,
      size_of_business    TEXT,
      -- ICP scoring
      icp_score         INTEGER,
      icp_category      TEXT,
      icp_priority      TEXT,
      breakdown_json    TEXT,
      last_scored_at    TEXT,
      -- Sync meta
      synced_at         TEXT,
      raw_properties    TEXT
    );

    -- HubSpot owners cache
    CREATE TABLE IF NOT EXISTS owners (
      id     TEXT PRIMARY KEY,
      name   TEXT,
      email  TEXT,
      teams_json TEXT,
      synced_at  TEXT
    );

    -- Property options cache (lead_source values, mql_type values, etc.)
    CREATE TABLE IF NOT EXISTS property_options (
      prop_name TEXT,
      value     TEXT,
      label     TEXT,
      synced_at TEXT,
      PRIMARY KEY (prop_name, value)
    );

    -- Sync log
    CREATE TABLE IF NOT EXISTS sync_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type  TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at   TEXT,
      status     TEXT DEFAULT 'running',
      contacts_synced INTEGER DEFAULT 0,
      message    TEXT
    );

    -- Local reps (for rep tracker)
    CREATE TABLE IF NOT EXISTS local_reps (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT,
      team_id    TEXT,
      created_at TEXT
    );

    -- Local teams
    CREATE TABLE IF NOT EXISTS local_teams (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT
    );

    -- Upload history
    CREATE TABLE IF NOT EXISTS uploads (
      id            TEXT PRIMARY KEY,
      rep_id        TEXT,
      rep_name      TEXT,
      team_id       TEXT,
      team_name     TEXT,
      filename      TEXT,
      uploaded_at   TEXT,
      lead_count    INTEGER DEFAULT 0,
      enriched_count INTEGER DEFAULT 0,
      stats_json    TEXT,
      leads_json    TEXT
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_contacts_owner    ON contacts(hubspot_owner_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_created  ON contacts(create_date);
    CREATE INDEX IF NOT EXISTS idx_contacts_category ON contacts(icp_category);
    CREATE INDEX IF NOT EXISTS idx_contacts_source   ON contacts(lead_source);
    CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle ON contacts(lifecyclestage);
    CREATE INDEX IF NOT EXISTS idx_contacts_synced   ON contacts(synced_at);
  `);
  // Add size_of_business column to existing DBs (safe to re-run)
  try { db.exec(`ALTER TABLE contacts ADD COLUMN size_of_business TEXT`); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTACTS
// ═══════════════════════════════════════════════════════════════════════════════

function upsertContact(c) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO contacts (
      hubspot_id, email, firstname, lastname, name, jobtitle, phone,
      country, industry, numberofemployees, company_name,
      lifecyclestage, lead_source, mql_type,
      source_cloud, destination_cloud, type_of_destination, tech_stack,
      hubspot_owner_id, owner_assigned_date, create_date, mql_date,
      hs_analytics_source, size_of_business,
      icp_score, icp_category, icp_priority, breakdown_json, last_scored_at,
      synced_at, raw_properties
    ) VALUES (
      @hubspot_id, @email, @firstname, @lastname, @name, @jobtitle, @phone,
      @country, @industry, @numberofemployees, @company_name,
      @lifecyclestage, @lead_source, @mql_type,
      @source_cloud, @destination_cloud, @type_of_destination, @tech_stack,
      @hubspot_owner_id, @owner_assigned_date, @create_date, @mql_date,
      @hs_analytics_source, @size_of_business,
      @icp_score, @icp_category, @icp_priority, @breakdown_json, @last_scored_at,
      @synced_at, @raw_properties
    )
  `);
  stmt.run(c);
}

const clearContacts = () => {
  getDb().prepare('DELETE FROM contacts').run();
};

const upsertContactsBatch = (contacts) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO contacts (
      hubspot_id, email, firstname, lastname, name, jobtitle, phone,
      country, industry, numberofemployees, company_name,
      lifecyclestage, lead_source, mql_type,
      source_cloud, destination_cloud, type_of_destination, tech_stack,
      hubspot_owner_id, owner_assigned_date, create_date, mql_date,
      hs_analytics_source, size_of_business,
      icp_score, icp_category, icp_priority, breakdown_json, last_scored_at,
      synced_at, raw_properties
    ) VALUES (
      @hubspot_id, @email, @firstname, @lastname, @name, @jobtitle, @phone,
      @country, @industry, @numberofemployees, @company_name,
      @lifecyclestage, @lead_source, @mql_type,
      @source_cloud, @destination_cloud, @type_of_destination, @tech_stack,
      @hubspot_owner_id, @owner_assigned_date, @create_date, @mql_date,
      @hs_analytics_source, @size_of_business,
      @icp_score, @icp_category, @icp_priority, @breakdown_json, @last_scored_at,
      @synced_at, @raw_properties
    )
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(contacts);
};

function getAllContacts(filters = {}) {
  const db = getDb();
  let where = [];
  let params = {};

  if (filters.ownerId) {
    where.push('hubspot_owner_id = @ownerId');
    params.ownerId = filters.ownerId;
  }
  if (filters.ownerIds && filters.ownerIds.length) {
    const placeholders = filters.ownerIds.map((_, i) => `@oid${i}`).join(',');
    where.push(`hubspot_owner_id IN (${placeholders})`);
    filters.ownerIds.forEach((id, i) => { params[`oid${i}`] = id; });
  }
  if (filters.dateFrom) {
    where.push('create_date >= @dateFrom');
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    where.push('create_date <= @dateTo');
    params.dateTo = filters.dateTo;
  }
  if (filters.ownerAssignedFrom) {
    where.push('owner_assigned_date >= @oaFrom');
    params.oaFrom = filters.ownerAssignedFrom;
  }
  if (filters.ownerAssignedTo) {
    where.push('owner_assigned_date <= @oaTo');
    params.oaTo = filters.ownerAssignedTo;
  }
  if (filters.leadSources && filters.leadSources.length) {
    const placeholders = filters.leadSources.map((_, i) => `@ls${i}`).join(',');
    where.push(`lead_source IN (${placeholders})`);
    filters.leadSources.forEach((v, i) => { params[`ls${i}`] = v; });
  }
  if (filters.lifecycleStage) {
    where.push('lifecyclestage = @lifecycle');
    params.lifecycle = filters.lifecycleStage;
  }
  if (filters.mqlType) {
    where.push('mql_type = @mqlType');
    params.mqlType = filters.mqlType;
  }
  if (filters.category) {
    where.push('icp_category = @category');
    params.category = filters.category;
  }
  if (filters.segment) {
    where.push('TRIM(size_of_business) = @segment');
    params.segment = filters.segment;
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `SELECT * FROM contacts ${whereClause} ORDER BY create_date DESC`;
  return db.prepare(sql).all(params);
}

function getContactCount() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as cnt FROM contacts').get().cnt;
}

function updateContactScores(scores) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE contacts SET
      icp_score = @icp_score,
      icp_category = @icp_category,
      icp_priority = @icp_priority,
      breakdown_json = @breakdown_json,
      last_scored_at = @last_scored_at
    WHERE hubspot_id = @hubspot_id
  `);
  const updateMany = db.transaction((rows) => {
    let updated = 0;
    for (const row of rows) {
      const r = stmt.run(row);
      updated += r.changes;
    }
    return updated;
  });
  return updateMany(scores);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OWNERS
// ═══════════════════════════════════════════════════════════════════════════════

function upsertOwners(owners) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO owners (id, name, email, teams_json, synced_at)
    VALUES (@id, @name, @email, @teams_json, @synced_at)
  `);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(owners);
}

function getOwners() {
  const db = getDb();
  return db.prepare('SELECT * FROM owners ORDER BY name').all().map(o => ({
    id:    o.id,
    name:  o.name,
    email: o.email,
    teams: o.teams_json ? JSON.parse(o.teams_json) : []
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROPERTY OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function upsertPropertyOptions(propName, options) {
  const db = getDb();
  const now = new Date().toISOString();
  // Clear old ones for this property
  db.prepare('DELETE FROM property_options WHERE prop_name = ?').run(propName);
  const stmt = db.prepare(`
    INSERT INTO property_options (prop_name, value, label, synced_at)
    VALUES (@prop_name, @value, @label, @synced_at)
  `);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(options.map(o => ({
    prop_name: propName,
    value:     o.value,
    label:     o.label,
    synced_at: now
  })));
}

function getPropertyOptions(propName) {
  const db = getDb();
  return db.prepare('SELECT value, label FROM property_options WHERE prop_name = ? ORDER BY label')
    .all(propName);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYNC LOG
// ═══════════════════════════════════════════════════════════════════════════════

function startSync(syncType) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sync_log (sync_type, started_at, status)
    VALUES (@sync_type, @started_at, 'running')
  `).run({
    sync_type: syncType,
    started_at: new Date().toISOString()
  });
  return result.lastInsertRowid;
}

function endSync(syncId, { status = 'success', contactsSynced = 0, message = '' } = {}) {
  const db = getDb();
  db.prepare(`
    UPDATE sync_log SET
      ended_at = @ended_at,
      status = @status,
      contacts_synced = @contacts_synced,
      message = @message
    WHERE id = @id
  `).run({
    id: syncId,
    ended_at: new Date().toISOString(),
    status,
    contacts_synced: contactsSynced,
    message
  });
}

function getLastSync(syncType) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM sync_log
    WHERE sync_type = ? AND status = 'success'
    ORDER BY ended_at DESC LIMIT 1
  `).get(syncType);
  return row || null;
}

function getSyncHistory(limit = 10) {
  const db = getDb();
  return db.prepare('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?').all(limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOCAL REPS & TEAMS  (migrated from JSON store)
// ═══════════════════════════════════════════════════════════════════════════════

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Teams
function getLocalTeams() {
  return getDb().prepare('SELECT * FROM local_teams ORDER BY name').all();
}
function createLocalTeam(name) {
  const id = genId();
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO local_teams (id, name, created_at) VALUES (?, ?, ?)').run(id, name.trim(), now);
  return { id, name: name.trim(), created_at: now };
}
function deleteLocalTeam(teamId) {
  const db = getDb();
  db.prepare('UPDATE local_reps SET team_id = NULL WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM local_teams WHERE id = ?').run(teamId);
}

// Reps
function getLocalReps() {
  return getDb().prepare(`
    SELECT r.*, t.name as team_name
    FROM local_reps r LEFT JOIN local_teams t ON r.team_id = t.id
    ORDER BY r.name
  `).all();
}
function createLocalRep({ name, email, teamId }) {
  const id = genId();
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO local_reps (id, name, email, team_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, (name||'').trim(), (email||'').trim(), teamId || null, now);
  return { id, name: (name||'').trim(), email: (email||'').trim(), team_id: teamId, created_at: now };
}
function updateLocalRep(repId, updates) {
  const db = getDb();
  const rep = db.prepare('SELECT * FROM local_reps WHERE id = ?').get(repId);
  if (!rep) throw new Error('Rep not found');
  if (updates.name !== undefined) rep.name = updates.name.trim();
  if (updates.email !== undefined) rep.email = updates.email.trim();
  if (updates.teamId !== undefined) rep.team_id = updates.teamId || null;
  db.prepare('UPDATE local_reps SET name=?, email=?, team_id=? WHERE id=?')
    .run(rep.name, rep.email, rep.team_id, repId);
  return rep;
}
function deleteLocalRep(repId) {
  getDb().prepare('DELETE FROM local_reps WHERE id = ?').run(repId);
}

// Uploads
function saveUpload({ repId, repName, teamId, teamName, filename, leads, enrichStats, categoryStats }) {
  const id = genId();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO uploads (id, rep_id, rep_name, team_id, team_name, filename, uploaded_at,
      lead_count, enriched_count, stats_json, leads_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, repId, repName, teamId, teamName, filename, now,
    leads.length, enrichStats?.enriched || 0,
    JSON.stringify(categoryStats || {}),
    JSON.stringify(leads.map(l => ({
      name: l.name, email: l.email, companyName: l.companyName,
      jobTitle: l.jobTitle, numberOfEmployees: l.numberOfEmployees,
      country: l.country, industry: l.industry, techStack: l.techStack,
      phone: l.phone, score: l.score, category: l.category,
      priority: l.priority, createdDate: l.createdDate
    })))
  );
  return { id, repId, filename, uploadedAt: now, leadCount: leads.length };
}

function getUploads(filters = {}) {
  let where = [];
  let params = {};
  if (filters.repId) { where.push('rep_id = @repId'); params.repId = filters.repId; }
  if (filters.teamId) { where.push('team_id = @teamId'); params.teamId = filters.teamId; }
  if (filters.from) { where.push('uploaded_at >= @from'); params.from = filters.from; }
  if (filters.to) { where.push('uploaded_at <= @to'); params.to = filters.to; }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return getDb().prepare(`SELECT id, rep_id, rep_name, team_id, team_name, filename,
    uploaded_at, lead_count, enriched_count, stats_json FROM uploads ${whereClause} ORDER BY uploaded_at DESC`)
    .all(params)
    .map(u => ({ ...u, stats: JSON.parse(u.stats_json || '{}') }));
}

function getUpload(uploadId) {
  const row = getDb().prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
  if (!row) return null;
  return { ...row, stats: JSON.parse(row.stats_json || '{}'), leads: JSON.parse(row.leads_json || '[]') };
}

function deleteUpload(uploadId) {
  getDb().prepare('DELETE FROM uploads WHERE id = ?').run(uploadId);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD ANALYTICS  (from local DB — instant!)
// ═══════════════════════════════════════════════════════════════════════════════

function getDashboardStats() {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as cnt FROM contacts').get().cnt;
  const scored = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE icp_score IS NOT NULL').get().cnt;

  const categories = db.prepare(`
    SELECT icp_category, COUNT(*) as cnt FROM contacts
    WHERE icp_category IS NOT NULL
    GROUP BY icp_category
  `).all();
  const categoryCount = {};
  categories.forEach(r => { categoryCount[r.icp_category] = r.cnt; });

  const geoRows = db.prepare(`
    SELECT
      CASE
        WHEN LOWER(TRIM(country)) IN ('united states','us','usa','u.s.','u.s.a.','united states of america') THEN 'USA'
        WHEN LOWER(TRIM(country)) IN ('united kingdom','uk','gb','great britain','england','scotland','wales','northern ireland') THEN 'UK'
        WHEN LOWER(TRIM(country)) IN ('canada','ca') THEN 'Canada'
        WHEN LOWER(TRIM(country)) IN ('australia','au') THEN 'Australia'
        WHEN LOWER(TRIM(country)) IN ('india','in') THEN 'India'
        WHEN LOWER(TRIM(country)) IN (
          'germany','de','france','fr','spain','es','italy','it','netherlands','nl',
          'belgium','be','sweden','se','norway','no','denmark','dk','finland','fi',
          'poland','pl','czech republic','cz','austria','at','switzerland','ch',
          'portugal','pt','greece','gr','hungary','hu','romania','ro','bulgaria','bg',
          'croatia','hr','slovakia','sk','slovenia','si','estonia','ee','latvia','lv',
          'lithuania','lt','luxembourg','lu','malta','mt','cyprus','cy','ireland','ie',
          'iceland','is','liechtenstein'
        ) THEN 'Europe'
        ELSE NULL
      END AS region,
      COUNT(*) as cnt
    FROM contacts
    WHERE region IS NOT NULL
    GROUP BY region
  `).all();
  const geographyCount = {};
  geoRows.forEach(r => { geographyCount[r.region] = r.cnt; });

  const highPriority = db.prepare(`
    SELECT hubspot_id, name, email, jobtitle, country, industry, numberofemployees,
           company_name, source_cloud, destination_cloud, type_of_destination,
           icp_score, icp_category, icp_priority, breakdown_json, size_of_business
    FROM contacts
    WHERE icp_priority IN ('Highest Priority', 'High Priority')
    ORDER BY icp_score DESC LIMIT 1000
  `).all().map(r => {
    let segment = r.size_of_business && r.size_of_business.trim()
      ? r.size_of_business.trim()
      : 'Others';
    let breakdown = null;
    try { breakdown = r.breakdown_json ? JSON.parse(r.breakdown_json) : null; } catch (_) {}
    return {
      id: r.hubspot_id, name: r.name, email: r.email,
      jobTitle: r.jobtitle, country: r.country, countryCanon: canonicalCountry(r.country),
      industry: r.industry,
      numberOfEmployees: r.numberofemployees, companyName: r.company_name,
      sourceCloud: r.source_cloud,
      destinationCloud: r.destination_cloud || r.type_of_destination,
      typeOfDestination: r.type_of_destination,
      score: r.icp_score, category: r.icp_category, priority: r.icp_priority,
      breakdown, segment
    };
  });

  return { total, scored, categoryCount, geographyCount, highPriority };
}

function getSegmentStats() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN size_of_business IS NOT NULL AND TRIM(size_of_business) != '' THEN TRIM(size_of_business)
        ELSE 'Others'
      END AS segment,
      COALESCE(icp_category, 'Unscored') AS icp_category,
      COUNT(*) AS cnt
    FROM contacts
    GROUP BY segment, icp_category
  `).all();

  const CATS = ['Core ICP', 'Strong ICP', 'Moderate ICP', 'Non ICP'];
  const result = {};

  for (const r of rows) {
    if (!result[r.segment]) {
      result[r.segment] = { total: 0 };
      CATS.forEach(c => { result[r.segment][c] = 0; });
    }
    result[r.segment].total += r.cnt;
    if (CATS.includes(r.icp_category)) result[r.segment][r.icp_category] += r.cnt;
  }

  return result;
}

function getContactsList() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT hubspot_id as id, name, email, jobtitle as title, country, industry,
      numberofemployees, company_name, source_cloud, destination_cloud, type_of_destination,
      icp_score as score, icp_category as category, icp_priority as priority, breakdown_json,
      size_of_business, create_date
    FROM contacts ORDER BY create_date DESC
  `).all();
  return rows.map(r => {
    let breakdown = null;
    try { breakdown = r.breakdown_json ? JSON.parse(r.breakdown_json) : null; } catch (_) {}
    return { ...r, breakdown, countryCanon: canonicalCountry(r.country) };
  });
}

function getRepStats(filters = {}) {
  const db = getDb();
  let where = [];
  let params = {};

  if (filters.ownerIds && filters.ownerIds.length) {
    const placeholders = filters.ownerIds.map((_, i) => `@oid${i}`).join(',');
    where.push(`hubspot_owner_id IN (${placeholders})`);
    filters.ownerIds.forEach((id, i) => { params[`oid${i}`] = id; });
  } else if (filters.ownerId) {
    where.push('hubspot_owner_id = @ownerId');
    params.ownerId = filters.ownerId;
  }
  if (filters.dateFrom) {
    where.push('create_date >= @dateFrom');
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    where.push('create_date <= @dateTo');
    params.dateTo = filters.dateTo;
  }
  if (filters.segment) {
    where.push('TRIM(size_of_business) = @segment');
    params.segment = filters.segment;
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const leads = db.prepare(`SELECT * FROM contacts ${whereClause}`).all(params);

  const total = leads.length;
  const mqls = leads.filter(l => l.mql_date || l.lifecyclestage === 'marketingqualifiedlead').length;
  const scored = leads.filter(l => l.icp_score != null);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((s, l) => s + (l.icp_score || 0), 0) / scored.length)
    : 0;

  const categoryCount = {};
  leads.forEach(l => {
    const cat = l.icp_category || 'Unscored';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });

  const scoreRanges = { s80_100: 0, s65_79: 0, s50_64: 0, s0_49: 0, unscored: 0 };
  leads.forEach(l => {
    if (l.icp_score == null) scoreRanges.unscored++;
    else if (l.icp_score >= 80) scoreRanges.s80_100++;
    else if (l.icp_score >= 65) scoreRanges.s65_79++;
    else if (l.icp_score >= 50) scoreRanges.s50_64++;
    else scoreRanges.s0_49++;
  });

  // Per-owner breakdown
  const ownerMap = {};
  leads.forEach(l => {
    const key = l.hubspot_owner_id || '_unknown';
    if (!ownerMap[key]) {
      const owner = db.prepare('SELECT * FROM owners WHERE id = ?').get(l.hubspot_owner_id);
      ownerMap[key] = {
        ownerId: l.hubspot_owner_id,
        ownerName: owner?.name || 'Unknown',
        ownerEmail: owner?.email || '',
        ownerTeams: owner?.teams_json ? JSON.parse(owner.teams_json).map(t => t.name).join(', ') : '',
        totalLeads: 0, mqls: 0, categories: {},
        scoreRanges: { s80_100: 0, s65_79: 0, s50_64: 0, s0_49: 0 },
        _totalScore: 0, _scoredCnt: 0, avgScore: 0
      };
    }
    const o = ownerMap[key];
    o.totalLeads++;
    if (l.mql_date || l.lifecyclestage === 'marketingqualifiedlead') o.mqls++;
    const cat = l.icp_category || 'Unscored';
    o.categories[cat] = (o.categories[cat] || 0) + 1;
    if (l.icp_score != null) {
      if (l.icp_score >= 80) o.scoreRanges.s80_100++;
      else if (l.icp_score >= 65) o.scoreRanges.s65_79++;
      else if (l.icp_score >= 50) o.scoreRanges.s50_64++;
      else o.scoreRanges.s0_49++;
      o._totalScore += l.icp_score;
      o._scoredCnt++;
    }
  });
  Object.values(ownerMap).forEach(o => {
    o.avgScore = o._scoredCnt > 0 ? Math.round(o._totalScore / o._scoredCnt) : 0;
    delete o._totalScore; delete o._scoredCnt;
  });

  // Weekly trend (last 8 weeks)
  const now = new Date();
  const weeklyTrend = [];
  for (let w = 7; w >= 0; w--) {
    const wStart = new Date(now);
    wStart.setDate(wStart.getDate() - w * 7);
    wStart.setHours(0, 0, 0, 0);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 7);
    const ws = wStart.toISOString().split('T')[0];
    const we = wEnd.toISOString().split('T')[0];
    const wk = leads.filter(l => l.create_date && l.create_date >= ws && l.create_date < we);
    weeklyTrend.push({
      weekStart: ws,
      leads: wk.length,
      coreICP: wk.filter(l => l.icp_category === 'Core ICP').length,
      strongICP: wk.filter(l => l.icp_category === 'Strong ICP').length,
      mqls: wk.filter(l => l.mql_date || l.lifecyclestage === 'marketingqualifiedlead').length
    });
  }

  const topLeads = leads
    .filter(l => l.icp_category === 'Core ICP' || l.icp_category === 'Strong ICP')
    .sort((a, b) => (b.icp_score || 0) - (a.icp_score || 0))
    .slice(0, 20);

  const lastSync = getLastSync('contacts');

  return {
    total, mqls, avgScore, categoryCount, scoreRanges,
    lastSync: lastSync?.ended_at || null,
    ownerBreakdown: Object.values(ownerMap).sort((a, b) => b.totalLeads - a.totalLeads),
    weeklyTrend,
    topLeads
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MIGRATION FROM JSON STORE
// ═══════════════════════════════════════════════════════════════════════════════

function migrateFromJsonStore() {
  const jsonPath = path.join(DATA_DIR, 'rep-store.json');
  if (!fs.existsSync(jsonPath)) return;

  try {
    const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const db = getDb();

    // Migrate teams
    if (store.teams?.length) {
      for (const t of store.teams) {
        db.prepare('INSERT OR IGNORE INTO local_teams (id, name, created_at) VALUES (?, ?, ?)')
          .run(t.id, t.name, t.createdAt);
      }
    }

    // Migrate reps
    if (store.reps?.length) {
      for (const r of store.reps) {
        db.prepare('INSERT OR IGNORE INTO local_reps (id, name, email, team_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(r.id, r.name, r.email, r.teamId, r.createdAt);
      }
    }

    // Migrate HubSpot leads
    if (store.hubspotLeads?.length) {
      const now = new Date().toISOString();
      const rows = store.hubspotLeads.map(l => ({
        hubspot_id: l.hubspotId,
        email: l.email || null,
        firstname: null,
        lastname: null,
        name: l.name || null,
        jobtitle: l.jobTitle || null,
        phone: null,
        country: l.country || null,
        industry: l.industry || null,
        numberofemployees: l.numberOfEmployees || null,
        company_name: l.companyName || null,
        lifecyclestage: l.lifecycleStage || null,
        lead_source: l.leadSource || null,
        mql_type: l.mqlType || null,
        source_cloud: l.sourceCloud || null,
        destination_cloud: l.destinationCloud || null,
        type_of_destination: l.typeOfDestination || null,
        tech_stack: l.techStack || null,
        hubspot_owner_id: l.ownerId || null,
        owner_assigned_date: l.ownerAssignedDate || null,
        create_date: l.createdate || null,
        mql_date: l.mqlDate || null,
        hs_analytics_source: null,
        icp_score: l.score ?? null,
        icp_category: l.category || null,
        icp_priority: l.priority || null,
        breakdown_json: l.breakdown ? JSON.stringify(l.breakdown) : null,
        last_scored_at: l.lastScoredAt || null,
        synced_at: l.syncedAt || now,
        raw_properties: null
      }));
      if (rows.length) upsertContactsBatch(rows);
      console.log(`  Migrated ${rows.length} HubSpot leads from JSON to SQLite`);
    }

    // Migrate uploads
    if (store.uploads?.length) {
      for (const u of store.uploads) {
        db.prepare(`INSERT OR IGNORE INTO uploads
          (id, rep_id, rep_name, team_id, team_name, filename, uploaded_at,
           lead_count, enriched_count, stats_json, leads_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(u.id, u.repId, u.repName, u.teamId, u.teamName, u.filename, u.uploadedAt,
            u.leadCount, u.enrichedCount, JSON.stringify(u.stats || {}), JSON.stringify(u.leads || []));
      }
    }

    // Rename old file so we don't re-migrate
    fs.renameSync(jsonPath, jsonPath + '.migrated');
    console.log('  Migrated rep-store.json → SQLite (old file renamed to .migrated)');
  } catch (err) {
    console.error('Migration from JSON failed:', err.message);
  }
}

// ─── Source → Destination combinations ──────────────────────────────────────
// SQL expressions that normalise the source / destination cloud values.
const SRC_EXPR  = `COALESCE(NULLIF(TRIM(source_cloud), ''), 'Unknown')`;
const DEST_EXPR = `COALESCE(NULLIF(TRIM(type_of_destination), ''), NULLIF(TRIM(destination_cloud), ''), 'Unknown')`;

// All raw DB country values that canonicalise to the given country name.
function rawCountriesFor(canonical) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT DISTINCT country FROM contacts WHERE country IS NOT NULL AND TRIM(country) <> ''`
  ).all();
  return rows.map(r => r.country).filter(c => canonicalCountry(c) === canonical);
}

function buildCombinationWhere(filters = {}, params = {}) {
  const where = [];
  if (filters.country) {
    // Expand the canonical country (e.g. "United States") to every raw value
    // in the data that maps to it (US, USA, California, Texas, …).
    const raws = rawCountriesFor(filters.country);
    if (raws.length) {
      const ph = raws.map((_, i) => `@cc${i}`).join(',');
      where.push(`country IN (${ph})`);
      raws.forEach((v, i) => { params[`cc${i}`] = v; });
    } else {
      where.push('1 = 0');  // unknown country → no rows
    }
  }
  if (filters.dateFrom) {
    where.push('create_date >= @dateFrom');
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    // inclusive: match the whole "to" day even when create_date carries a time
    where.push("substr(create_date,1,10) <= @dateTo");
    params.dateTo = filters.dateTo;
  }
  return where;
}

/** Aggregated source→destination combinations with ICP category counts. */
function getCombinations(filters = {}) {
  const db = getDb();
  const params = {};
  const where = buildCombinationWhere(filters, params);
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // Group by CANONICAL cloud names, so all the messy variants collapse
  // ("Dropbox"/"Drop box"/"Dropbox Business" → one row, "Slack"/"slack "/… → one).
  // LOWER() folds any remaining casing differences in unrecognised values;
  // MIN() picks a single representative label for display.
  const sql = `
    SELECT
      MIN(canon_cloud(${SRC_EXPR}))  AS source,
      MIN(canon_cloud(${DEST_EXPR})) AS destination,
      COUNT(*)                                                       AS total,
      ROUND(AVG(icp_score))                                          AS avgScore,
      SUM(CASE WHEN icp_category='Core ICP'     THEN 1 ELSE 0 END)   AS core,
      SUM(CASE WHEN icp_category='Strong ICP'   THEN 1 ELSE 0 END)   AS strong,
      SUM(CASE WHEN icp_category='Moderate ICP' THEN 1 ELSE 0 END)   AS moderate,
      SUM(CASE WHEN icp_category='Non ICP'      THEN 1 ELSE 0 END)   AS non
    FROM contacts
    ${whereClause}
    GROUP BY LOWER(canon_cloud(${SRC_EXPR})), LOWER(canon_cloud(${DEST_EXPR}))
    ORDER BY total DESC
  `;
  return db.prepare(sql).all(params);
}

/** All contacts for a specific source→destination combination (+ country/date filters). */
function getCombinationContacts(filters = {}) {
  const db = getDb();
  const params = {};
  const where = buildCombinationWhere(filters, params);
  // Match on the CANONICAL cloud name so the representative label from the grid
  // (e.g. "Dropbox") catches every raw variant in the data ("Drop box", …).
  if (filters.source) {
    where.push(`LOWER(canon_cloud(${SRC_EXPR})) = LOWER(@source)`);
    params.source = filters.source;
  }
  if (filters.destination) {
    where.push(`LOWER(canon_cloud(${DEST_EXPR})) = LOWER(@destination)`);
    params.destination = filters.destination;
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `SELECT * FROM contacts ${whereClause} ORDER BY icp_score DESC`;
  return db.prepare(sql).all(params);
}

/** Distinct, canonicalised country names for the filter dropdown
 *  (US / USA / United States / state names all collapse to one entry). */
function getDistinctCountries() {
  const db = getDb();
  const raws = db.prepare(
    `SELECT DISTINCT TRIM(country) AS country FROM contacts
     WHERE country IS NOT NULL AND TRIM(country) <> ''`
  ).all().map(r => r.country);
  const set = new Set();
  raws.forEach(c => { const canon = canonicalCountry(c); if (canon) set.add(canon); });
  return [...set].sort((a, b) => a.localeCompare(b));
}

module.exports = {
  getDb,
  // Contacts
  upsertContact, upsertContactsBatch, clearContacts, getAllContacts, getContactCount,
  updateContactScores,
  // Combinations
  getCombinations, getCombinationContacts, getDistinctCountries,
  // Owners
  upsertOwners, getOwners,
  // Property options
  upsertPropertyOptions, getPropertyOptions,
  // Sync log
  startSync, endSync, getLastSync, getSyncHistory,
  // Local reps/teams
  getLocalTeams, createLocalTeam, deleteLocalTeam,
  getLocalReps, createLocalRep, updateLocalRep, deleteLocalRep,
  // Uploads
  saveUpload, getUploads, getUpload, deleteUpload,
  // Analytics
  getDashboardStats, getSegmentStats, getContactsList, getRepStats,
  // Migration
  migrateFromJsonStore,
  genId
};
