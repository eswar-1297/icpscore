'use strict';
const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const router  = express.Router();

const hs              = require('./hubspot');
const { scoreContact, scoreExtractedLead, parseEmployeeCount } = require('./scoring');
const { parseLeadsFile }   = require('./fileParser');
const { enrichLeads }      = require('./apollo');
const { loadConfig, saveConfig, getDefaultConfig } = require('./configManager');
const rep = require('./repStore');
const db  = require('./db');

// Multer — CSV / XLS / XLSX, in-memory, 20 MB max
const ALLOWED_MIMES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'   // some browsers send this for .csv / .xls
]);
const ALLOWED_EXTS = /\.(csv|xls|xlsx)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype) || ALLOWED_EXTS.test(file.originalname)) {
      return cb(null, true);
    }
    cb(new Error('Only CSV, XLS, and XLSX files are accepted'));
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  UTILITY
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/status
router.get('/status', async (req, res) => {
  try {
    await hs.getClient().crm.contacts.basicApi.getPage(1);
    res.json({ ok: true, message: 'HubSpot connection successful' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/setup
router.post('/setup', async (req, res) => {
  try {
    const result = await hs.ensureCustomProperties();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  DASHBOARD / CONTACTS
// ═════════════════════════════════════════════════════════════════════════════

router.get('/dashboard', async (req, res) => {
  try {
    // Read from local SQLite — instant!
    const stats = db.getDashboardStats();
    const segmentStats = db.getSegmentStats();
    const lastSync = db.getLastSync('contacts');
    res.json({ ok: true, ...stats, segmentStats, lastSync: lastSync?.ended_at || null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/contacts', async (req, res) => {
  try {
    // Read from local SQLite — instant!
    const rows = db.getContactsList();
    res.json({ ok: true, total: rows.length, contacts: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  HUBSPOT META — owners, teams, property options
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/hubspot/owners  — reads from local cache (instant)
router.get('/hubspot/owners', async (req, res) => {
  try {
    const owners = db.getOwners();
    // If cache is empty, try a live fetch
    if (!owners.length) {
      try {
        const liveOwners = await hs.getOwners();
        const now = new Date().toISOString();
        db.upsertOwners(liveOwners.map(o => ({
          id: o.id, name: o.name, email: o.email,
          teams_json: JSON.stringify(o.teams), synced_at: now
        })));
        return res.json({ ok: true, owners: liveOwners });
      } catch (_) {}
    }
    res.json({ ok: true, owners });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/hubspot/hs-teams  — reads from local cache
router.get('/hubspot/hs-teams', async (req, res) => {
  try {
    // Derive teams from cached owners
    const owners = db.getOwners();
    const teamMap = {};
    owners.forEach(o => {
      (o.teams || []).forEach(t => {
        if (!teamMap[t.id]) teamMap[t.id] = { id: t.id, name: t.name, userIds: [] };
        teamMap[t.id].userIds.push(o.id);
      });
    });
    let teams = Object.values(teamMap);
    if (!teams.length) {
      try { teams = await hs.getHubspotTeams(); } catch (_) {}
    }
    res.json({ ok: true, teams });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/hubspot/property-options/:propName  — reads from local cache
router.get('/hubspot/property-options/:propName', async (req, res) => {
  try {
    const { propName } = req.params;
    let options = db.getPropertyOptions(propName);

    // If cache is empty, try a live fetch
    if (!options.length) {
      try {
        const objectType = req.query.objectType || 'contacts';
        const liveOptions = await hs.getPropertyOptions(objectType, propName);
        if (liveOptions.length) {
          db.upsertPropertyOptions(propName, liveOptions);
          options = liveOptions;
        }
      } catch (_) {}
    }

    // Fallback for hs_analytics_source
    if (!options.length && propName === 'hs_analytics_source') {
      options = [
        { label: 'Organic Search',  value: 'ORGANIC_SEARCH' },
        { label: 'Paid Search',     value: 'PAID_SEARCH' },
        { label: 'Email Marketing', value: 'EMAIL_MARKETING' },
        { label: 'Social Media',    value: 'SOCIAL_MEDIA' },
        { label: 'Referrals',       value: 'REFERRALS' },
        { label: 'Direct Traffic',  value: 'DIRECT_TRAFFIC' },
        { label: 'Other Campaigns', value: 'OTHER_CAMPAIGNS' },
        { label: 'Paid Social',     value: 'PAID_SOCIAL' }
      ];
    }

    res.json({ ok: true, options });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  HUBSPOT CONTACTS PULL (filtered by owner, team, date, lead source, MQL type)
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/hubspot/pull-and-score  — pull filtered contacts, enrich via Apollo, score, and optionally save back
router.post('/hubspot/pull-and-score', async (req, res) => {
  try {
    const {
      leadSources, mqlType, ownerIds, teamId,
      ownerAssignedFrom, ownerAssignedTo,
      dateFrom, dateTo, lifecycleStage,
      enrich, repId,
      // legacy compat
      leadSource, lifecycle
    } = req.body;

    // Normalise legacy params
    const stage = lifecycleStage || lifecycle;

    // 1. Pull contacts from HubSpot — mandatory lead source + team + last-quarter
    //    date filters are enforced centrally by pullMandatoryContacts
    const contacts = await hs.pullMandatoryContacts({
      mqlType,
      ownerAssignedFrom, ownerAssignedTo,
      lifecycleStage: stage
    });
    console.log(`[pull] HubSpot returned ${contacts.length} contacts (mandatory filters applied)`);

    if (!contacts.length) {
      return res.json({ ok: true, total: 0, leads: [], message: 'No contacts match your filters.' });
    }

    // 2. Build owner lookup map (id → name)
    let ownerMap = {};
    try {
      const ownerList = await hs.getOwners();
      ownerList.forEach(o => { ownerMap[o.id] = o; });
    } catch (_) {}

    // 3. Convert to lead objects for scoring
    let leads = contacts.map(c => {
      const p     = c.properties;
      const owner = ownerMap[p.hubspot_owner_id] || null;
      return {
        _hubspotId:        c.id,
        name:              `${p.firstname || ''} ${p.lastname || ''}`.trim() || p.email,
        email:             p.email,
        phone:             p.phone || null,
        jobTitle:          p.jobtitle || null,
        companyName:       null,
        numberOfEmployees: parseEmployeeCount(p.numberofemployees),
        country:           p[process.env.SELECT_COUNTRY_FIELD || 'select_country'] || p.country || null,
        industry:          p.industry || null,
        techStack:         p.type_of_destination || p.destination_cloud || null,
        leadSource:        p.lead_source || p.hs_analytics_source || null,
        leadSourceDetail:  p.hs_analytics_source_data_1 || null,
        mqlType:           p.mql_type || null,
        sourceCloud:       p.source__cloud || p.source_destination || null,
        destinationCloud:  p.destination_cloud || p.type_of_destination || null,
        typeOfDestination: p.type_of_destination || null,
        lifecycleStage:    p.lifecyclestage || null,
        createdDate:       p.createdate ? new Date(p.createdate).toISOString().split('T')[0] : null,
        ownerAssignedDate: p.hubspot_owner_assigneddate ? new Date(p.hubspot_owner_assigneddate).toISOString().split('T')[0] : null,
        mqlDate:           p.hs_lifecyclestage_marketingqualifiedlead_date
                             ? new Date(p.hs_lifecyclestage_marketingqualifiedlead_date).toISOString().split('T')[0]
                             : null,
        ownerId:           p.hubspot_owner_id || null,
        ownerName:         owner ? owner.name : null,
        ownerEmail:        owner ? owner.email : null,
        ownerTeams:        owner ? owner.teams.map(t => t.name).join(', ') : null
      };
    });

    // 4. Fetch associated company data (batch — one request per 100 companies)
    const pullCompanyIds = contacts
      .map(c => c.associations?.companies?.results?.[0]?.id || c.properties?.associatedcompanyid)
      .filter(Boolean);
    const pullCompanyMap = await hs.batchGetCompanies(pullCompanyIds);
    const pullTechField = process.env.TECH_STACK_FIELD || 'technologies';

    for (const lead of leads) {
      const contact = contacts.find(c => c.id === lead._hubspotId);
      const companyId = contact?.associations?.companies?.results?.[0]?.id
                     || contact?.properties?.associatedcompanyid;
      if (companyId) {
        const cp = pullCompanyMap.get(companyId);
        if (cp) {
          if (!lead.companyName)       lead.companyName = cp.name || null;
          if (!lead.numberOfEmployees) lead.numberOfEmployees = parseEmployeeCount(cp.numberofemployees);
          if (!lead.country)           lead.country = cp.country || null;
          if (!lead.industry)          lead.industry = cp.industry || null;
          if (!lead.techStack)         lead.techStack = cp[pullTechField] || null;
        }
      }
    }

    // 5. Enrich via Apollo if requested
    let enrichStats = { total: leads.length, enriched: 0, failed: 0 };
    if (enrich !== false && process.env.APOLLO_API_KEY) {
      try {
        leads = await enrichLeads(leads);
        enrichStats.enriched = leads.filter(l => l._enriched).length;
        enrichStats.failed   = leads.filter(l => !l._enriched).length;
      } catch (enrichErr) {
        console.error('Apollo enrichment error:', enrichErr.message);
        enrichStats.error = enrichErr.message;
      }
    }

    // 6. Score
    const config = loadConfig();
    const scoredLeads = leads.map(lead => {
      const scored = scoreExtractedLead(lead, config);
      delete scored._enriched;
      return scored;
    });

    // 7. Save to rep store if repId provided
    const categoryStats = scoredLeads.reduce((acc, l) => {
      acc[l.category] = (acc[l.category] || 0) + 1;
      return acc;
    }, {});

    let uploadRecord = null;
    if (repId) {
      try {
        uploadRecord = rep.saveUpload({
          repId,
          filename: `HubSpot Pull (${ownerAssignedFrom || dateFrom || 'start'}→${ownerAssignedTo || dateTo || 'now'}, source=${(leadSources||[]).join(',')||'all'})`,
          leads: scoredLeads,
          enrichStats,
          categoryStats
        });
      } catch (saveErr) {
        console.error('Failed to save upload record:', saveErr.message);
      }
    }

    // Clean internal IDs
    scoredLeads.forEach(l => delete l._hubspotId);

    res.json({
      ok: true,
      total: scoredLeads.length,
      stats: categoryStats,
      enrichStats,
      leads: scoredLeads,
      uploadId: uploadRecord?.id || null
    });
  } catch (err) {
    console.error('hubspot/pull-and-score error:', err);
    // Extract the real HubSpot API message from the SDK error body
    const hsMsg = err.body?.message || err.response?.body?.message;
    const msg = hsMsg
      ? `HubSpot API error: ${hsMsg}`
      : err.message;
    res.status(500).json({ ok: false, message: msg });
  }
});

// GET /api/hubspot/lead-sources — get distinct lead sources (only from mandatory-filtered contacts)
router.get('/hubspot/lead-sources', async (req, res) => {
  try {
    const contacts = await hs.pullMandatoryContacts();
    const sources = new Set();
    contacts.forEach(c => {
      if (c.properties.lead_source) sources.add(c.properties.lead_source);
      else if (c.properties.hs_analytics_source) sources.add(c.properties.hs_analytics_source);
    });
    res.json({ ok: true, sources: Array.from(sources).sort() });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  FILE UPLOAD ANALYSIS  (CSV / XLS / XLSX)
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/file/analyze   (multipart/form-data, field name = "file")
// Query params:
//   ?enrich=true  — enrich leads via Apollo before scoring (default: true)
//   ?enrich=false — skip enrichment, just parse & score
//   ?repId=xxx    — associate this upload with a rep
router.post('/file/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: 'No file provided. Use field name "file".' });
    }

    const rawLeads    = parseLeadsFile(req.file.buffer, req.file.originalname);
    const doEnrich    = req.query.enrich !== 'false';
    const repId       = req.query.repId || null;

    let enrichedLeads = rawLeads;
    let enrichStats   = { total: rawLeads.length, enriched: 0, failed: 0 };

    // Enrich via Apollo if enabled and API key is set
    if (doEnrich && process.env.APOLLO_API_KEY) {
      try {
        enrichedLeads = await enrichLeads(rawLeads);
        enrichStats.enriched = enrichedLeads.filter(l => l._enriched).length;
        enrichStats.failed   = enrichedLeads.filter(l => !l._enriched).length;
      } catch (enrichErr) {
        console.error('Apollo enrichment error:', enrichErr.message);
        enrichStats.error = enrichErr.message;
      }
    } else if (doEnrich && !process.env.APOLLO_API_KEY) {
      enrichStats.skipped = true;
      enrichStats.reason  = 'APOLLO_API_KEY not configured';
    }

    // Score all leads
    const config      = loadConfig();
    const scoredLeads = enrichedLeads.map(lead => {
      const scored = scoreExtractedLead(lead, config);
      delete scored._enriched;
      return scored;
    });

    const categoryStats = scoredLeads.reduce((acc, l) => {
      acc[l.category] = (acc[l.category] || 0) + 1;
      return acc;
    }, {});

    // Save upload to rep store if repId provided
    let uploadRecord = null;
    if (repId) {
      try {
        uploadRecord = rep.saveUpload({
          repId,
          filename: req.file.originalname,
          leads: scoredLeads,
          enrichStats,
          categoryStats
        });
      } catch (saveErr) {
        console.error('Failed to save upload record:', saveErr.message);
      }
    }

    res.json({
      ok: true,
      total: scoredLeads.length,
      stats: categoryStats,
      enrichStats,
      leads: scoredLeads,
      uploadId: uploadRecord?.id || null
    });
  } catch (err) {
    console.error('file/analyze error:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/file/download-excel   body: { leads, filename }
router.post('/file/download-excel', (req, res) => {
  try {
    const { leads, filename } = req.body;
    if (!leads || !leads.length) {
      return res.status(400).json({ ok: false, message: 'No leads to export' });
    }

    const wb = XLSX.utils.book_new();

    const outputCols = [
      'name', 'email', 'companyName', 'jobTitle', 'numberOfEmployees',
      'country', 'industry', 'sourceCloud', 'destinationCloud', 'sizeOfBusiness',
      'phone', 'createdDate',
      'score', 'category', 'priority',
      'companySizeScore', 'companySizeReason',
      'geographyScore', 'geographyReason',
      'industryScore', 'industryReason',
      'migrationScore', 'migrationReason',
      'buyerFitScore', 'buyerFitReason'
    ];
    const outputHeaders = [
      'Name', 'Email', 'Company', 'Job Title', 'Employees',
      'Country', 'Industry', 'Source Platform', 'Destination Platform', 'Size of Business',
      'Phone', 'Created Date',
      'ICP Total Score', 'ICP Category', 'ICP Priority',
      'Company Size Score', 'Company Size Reason',
      'Geography Score', 'Geography Reason',
      'Industry Score', 'Industry Reason',
      'Migration Score', 'Migration Reason',
      'Buyer Fit Score', 'Buyer Fit Reason'
    ];

    function leadToRow(l) {
      return [
        l.name || '', l.email || '', l.companyName || '', l.jobTitle || '',
        l.numberOfEmployees || '',
        l.country || '', l.industry || '',
        l.sourceCloud || '', l.destinationCloud || l.typeOfDestination || l.techStack || '',
        l.sizeOfBusiness || '',
        l.phone || '', l.createdDate || '',
        l.score ?? '', l.category || '', l.priority || '',
        l.breakdown?.companySize ?? '', l.reasons?.companySize || '',
        l.breakdown?.geography ?? '', l.reasons?.geography || '',
        l.breakdown?.industry ?? '', l.reasons?.industry || '',
        l.breakdown?.technology ?? '', l.reasons?.technology || '',
        l.breakdown?.buyerFit ?? '', l.reasons?.buyerFit || ''
      ];
    }

    // Sheet 1: All Scored Leads (sorted by score desc)
    const sorted = [...leads].sort((a, b) => (b.score || 0) - (a.score || 0));
    const allData = [outputHeaders, ...sorted.map(leadToRow)];
    const wsAll = XLSX.utils.aoa_to_sheet(allData);
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Scored Leads');

    // Sheet 2: Summary
    const cats = ['Core ICP', 'Strong ICP', 'Moderate ICP', 'Non ICP'];
    const catCounts = {};
    cats.forEach(c => { catCounts[c] = leads.filter(l => l.category === c).length; });

    const sobGroups = {};
    leads.forEach(l => {
      const sob = (l.sizeOfBusiness && l.sizeOfBusiness.trim()) || 'Unassigned';
      if (!sobGroups[sob]) sobGroups[sob] = [];
      sobGroups[sob].push(l);
    });

    const summaryRows = [
      ['CloudFuze ICP Lead Scoring — Summary'],
      [],
      ['Total Leads', leads.length],
      [],
      ['ICP Category', 'Count', 'Percentage'],
      ...cats.map(c => [c, catCounts[c], leads.length ? ((catCounts[c] / leads.length) * 100).toFixed(1) + '%' : '0%']),
      [],
      ['Size of Business Breakdown'],
      ['SOB', 'Total', ...cats],
      ...Object.entries(sobGroups).map(([sob, sobLeads]) => [
        sob, sobLeads.length,
        ...cats.map(c => sobLeads.filter(l => l.category === c).length)
      ]),
      [],
      ['Scoring Rules'],
      ['Attribute', 'Max Score'],
      ['Company Size (Employee Count)', '35'],
      ['Geography (Country/Region)', '35'],
      ['Industry / Sector', '10'],
      ['Migration Platform (Source → Destination)', '10'],
      ['Buyer Fit (Job Title / Role)', '10'],
      ['Total', '100']
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // SOB Sheets
    const SOB_ORDER = ['SMB', 'Large MSP', 'MSP', 'Enterprise', 'Unassigned'];
    const allSobKeys = [...new Set([...SOB_ORDER, ...Object.keys(sobGroups)])];
    for (const sob of allSobKeys) {
      const sobLeads = sobGroups[sob];
      if (!sobLeads || !sobLeads.length) continue;
      const sheetName = `SOB - ${sob}`.slice(0, 31);
      const sobSorted = [...sobLeads].sort((a, b) => (b.score || 0) - (a.score || 0));
      const sobData = [outputHeaders, ...sobSorted.map(leadToRow)];
      const wsSob = XLSX.utils.aoa_to_sheet(sobData);
      XLSX.utils.book_append_sheet(wb, wsSob, sheetName);
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const dlName = (filename || 'icp_scored_leads').replace(/\.[^.]+$/, '') + '_scored.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('file/download-excel error:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/enrich/single   body: { email, companyName }
router.post('/enrich/single', async (req, res) => {
  try {
    const { email, companyName } = req.body;
    if (!email && !companyName) {
      return res.status(400).json({ ok: false, message: 'Provide "email" or "companyName"' });
    }
    const leads = await enrichLeads([{ email, companyName }]);
    const config = loadConfig();
    const scored = scoreExtractedLead(leads[0], config);
    delete scored._enriched;
    res.json({ ok: true, lead: scored });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  REP & TEAM MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

// ── Teams ───────────────────────────────────────────────────────────────────
router.get('/teams', (req, res) => {
  try { res.json({ ok: true, teams: rep.getTeams() }); }
  catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.post('/teams', (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, message: 'Team name is required' });
    res.json({ ok: true, team: rep.createTeam(name) });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.delete('/teams/:id', (req, res) => {
  try { rep.deleteTeam(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Reps ────────────────────────────────────────────────────────────────────
router.get('/reps', (req, res) => {
  try { res.json({ ok: true, reps: rep.getReps() }); }
  catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.post('/reps', (req, res) => {
  try {
    const { name, email, teamId } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, message: 'Rep name is required' });
    res.json({ ok: true, rep: rep.createRep({ name, email, teamId }) });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.put('/reps/:id', (req, res) => {
  try {
    res.json({ ok: true, rep: rep.updateRep(req.params.id, req.body) });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.delete('/reps/:id', (req, res) => {
  try { rep.deleteRep(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Upload history ──────────────────────────────────────────────────────────
router.get('/uploads', (req, res) => {
  try {
    const { repId, teamId, from, to } = req.query;
    res.json({ ok: true, uploads: rep.getUploads({ repId, teamId, from, to }).map(u => ({
      ...u, leads: undefined, leadCount: u.leadCount  // Don't send all leads in listing
    }))});
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.get('/uploads/:id', (req, res) => {
  try {
    const upload = rep.getUpload(req.params.id);
    if (!upload) return res.status(404).json({ ok: false, message: 'Upload not found' });
    res.json({ ok: true, upload });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.delete('/uploads/:id', (req, res) => {
  try { rep.deleteUpload(req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Rep Analytics Dashboard ─────────────────────────────────────────────────
router.get('/rep-analytics', (req, res) => {
  try {
    const { repId, teamId, period, from, to } = req.query;
    const analytics = rep.getRepAnalytics({ repId, teamId, period, from, to });
    res.json({ ok: true, ...analytics });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN — Scoring Configuration
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/admin/config
router.get('/admin/config', (req, res) => {
  try {
    res.json({ ok: true, config: loadConfig() });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// PUT /api/admin/config
router.put('/admin/config', (req, res) => {
  try {
    const cfg = req.body;
    const required = ['companySize', 'geography', 'industry', 'technology', 'buyerFit', 'categories'];
    if (!cfg || required.some(k => !cfg[k])) {
      return res.status(400).json({ ok: false, message: 'Invalid config — missing required sections' });
    }
    saveConfig(cfg);

    // Auto-rescore all stored HubSpot leads with the new config
    let rescored = 0;
    try {
      const allLeads = rep.getAllHubspotLeads();
      if (allLeads.length) {
        const rescoredLeads = allLeads.map(lead => {
          const result = scoreExtractedLead(lead, cfg);
          return { ...lead, score: result.score, category: result.category,
            priority: result.priority, breakdown: result.breakdown,
            lastScoredAt: new Date().toISOString() };
        });
        const r = rep.updateAllHubspotLeadScores(rescoredLeads);
        rescored = r.rescored;
      }
    } catch (_) {}

    res.json({ ok: true, message: 'Scoring config saved', rescored });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/admin/reset
router.post('/admin/reset', (req, res) => {
  try {
    const defaults = getDefaultConfig();
    saveConfig(defaults);

    // Auto-rescore stored HubSpot leads with default config
    let rescored = 0;
    try {
      const allLeads = rep.getAllHubspotLeads();
      if (allLeads.length) {
        const rescoredLeads = allLeads.map(lead => {
          const result = scoreExtractedLead(lead, defaults);
          return { ...lead, score: result.score, category: result.category,
            priority: result.priority, breakdown: result.breakdown,
            lastScoredAt: new Date().toISOString() };
        });
        rep.updateAllHubspotLeadScores(rescoredLeads);
      }
    } catch (_) {}

    res.json({ ok: true, config: defaults, rescored });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  REP TRACKER — HubSpot live data (sync, rescore, analytics)
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/rep-tracker/sync  — pull HubSpot contacts by date range, score, store per-rep
router.post('/rep-tracker/sync', async (req, res) => {
  try {
    const { mqlType, lifecycleStage, dateFrom, dateTo } = req.body;

    // Mandatory lead source + team filters enforced centrally; date range from request
    const contacts = await hs.pullMandatoryContacts({
      mqlType, lifecycleStage, dateFrom, dateTo
    });

    if (!contacts.length) {
      return res.json({ ok: true, added: 0, updated: 0, total: 0, contacts: 0,
        message: 'No contacts match the selected filters.' });
    }

    // Build owner lookup map
    let ownerMap = {};
    try {
      const ownerList = await hs.getOwners();
      ownerList.forEach(o => { ownerMap[o.id] = o; });
    } catch (_) {}

    // Map contacts → lead objects
    let leads = contacts.map(c => {
      const p     = c.properties;
      const owner = ownerMap[p.hubspot_owner_id] || null;
      return {
        hubspotId:         c.id,
        ownerId:           p.hubspot_owner_id || null,
        ownerName:         owner?.name  || null,
        ownerEmail:        owner?.email || null,
        ownerTeams:        owner?.teams?.map(t => t.name).join(', ') || null,
        name:              `${p.firstname || ''} ${p.lastname || ''}`.trim() || p.email,
        email:             p.email  || null,
        jobTitle:          p.jobtitle || null,
        companyName:       null,
        numberOfEmployees: parseEmployeeCount(p.numberofemployees),
        country:           p[process.env.SELECT_COUNTRY_FIELD || 'select_country'] || p.country || null,
        industry:          p.industry || null,
        techStack:         p.type_of_destination || p.destination_cloud || null,
        sourceCloud:       p.source__cloud || p.source_destination || null,
        destinationCloud:  p.destination_cloud || p.type_of_destination || null,
        typeOfDestination: p.type_of_destination || null,
        leadSource:        p.lead_source         || null,
        mqlType:           p.mql_type            || null,
        lifecycleStage:    p.lifecyclestage       || null,
        createdate:        p.createdate ? new Date(p.createdate).toISOString().split('T')[0] : null,
        ownerAssignedDate: p.hubspot_owner_assigneddate
                             ? new Date(p.hubspot_owner_assigneddate).toISOString().split('T')[0] : null,
        mqlDate:           p.hs_lifecyclestage_marketingqualifiedlead_date
                             ? new Date(p.hs_lifecyclestage_marketingqualifiedlead_date).toISOString().split('T')[0]
                             : null
      };
    });

    // Enrich with company data (batch fetch instead of one call per contact)
    const repCompanyIds = contacts
      .map(c => c.associations?.companies?.results?.[0]?.id || c.properties?.associatedcompanyid)
      .filter(Boolean);
    const repCompanyMap = await hs.batchGetCompanies(repCompanyIds);
    const repTechField = process.env.TECH_STACK_FIELD || 'technologies';

    for (const lead of leads) {
      const contact = contacts.find(c => c.id === lead.hubspotId);
      const companyId = contact?.associations?.companies?.results?.[0]?.id
                     || contact?.properties?.associatedcompanyid;
      if (companyId) {
        const cp = repCompanyMap.get(companyId);
        if (cp) {
          if (!lead.companyName)       lead.companyName       = cp.name || null;
          if (!lead.numberOfEmployees) lead.numberOfEmployees = parseEmployeeCount(cp.numberofemployees);
          if (!lead.country)           lead.country           = cp.country  || null;
          if (!lead.industry)          lead.industry          = cp.industry || null;
          if (!lead.techStack)         lead.techStack         = cp[repTechField] || null;
        }
      }
    }

    // Score each lead
    const config = loadConfig();
    for (const lead of leads) {
      const result    = scoreExtractedLead(lead, config);
      lead.score      = result.score;
      lead.category   = result.category;
      lead.priority   = result.priority;
      lead.breakdown  = result.breakdown;
      lead.lastScoredAt = new Date().toISOString();
    }

    // Upsert into SQLite DB (and legacy JSON store)
    const now = new Date().toISOString();
    const dbRows = leads.map(l => ({
      hubspot_id:          l.hubspotId,
      email:               l.email || null,
      firstname:           null,
      lastname:            null,
      name:                l.name || null,
      jobtitle:            l.jobTitle || null,
      phone:               null,
      country:             l.country || null,
      industry:            l.industry || null,
      numberofemployees:   l.numberOfEmployees || null,
      company_name:        l.companyName || null,
      lifecyclestage:      l.lifecycleStage || null,
      lead_source:         l.leadSource || null,
      mql_type:            l.mqlType || null,
      source_cloud:        l.sourceCloud || null,
      destination_cloud:   l.destinationCloud || null,
      type_of_destination: l.typeOfDestination || null,
      tech_stack:          l.techStack || null,
      hubspot_owner_id:    l.ownerId || null,
      owner_assigned_date: l.ownerAssignedDate || null,
      create_date:         l.createdate || null,
      mql_date:            l.mqlDate || null,
      hs_analytics_source: null,
      icp_score:           l.score ?? null,
      icp_category:        l.category || null,
      icp_priority:        l.priority || null,
      breakdown_json:      l.breakdown ? JSON.stringify(l.breakdown) : null,
      last_scored_at:      l.lastScoredAt || now,
      synced_at:           now,
      raw_properties:      null
    }));
    if (dbRows.length) db.upsertContactsBatch(dbRows);

    // Legacy JSON store (kept for backward compat)
    try { rep.upsertHubspotLeads(leads); } catch (_) {}

    // Per-owner summary for response
    const ownerSummary = {};
    leads.forEach(l => {
      const key = l.ownerName || l.ownerId || 'Unknown';
      ownerSummary[key] = (ownerSummary[key] || 0) + 1;
    });

    res.json({ ok: true, added: dbRows.length, updated: 0, total: dbRows.length, contacts: leads.length, ownerSummary });
  } catch (err) {
    console.error('rep-tracker/sync error:', err);
    const hsMsg = err.body?.message || err.response?.body?.message;
    res.status(500).json({ ok: false, message: hsMsg ? `HubSpot API error: ${hsMsg}` : err.message });
  }
});

// POST /api/rep-tracker/rescore  — re-score all stored HubSpot leads with current config
router.post('/rep-tracker/rescore', (req, res) => {
  try {
    const config   = loadConfig();
    const allLeads = rep.getAllHubspotLeads();

    if (!allLeads.length) {
      return res.json({ ok: true, rescored: 0, message: 'No HubSpot leads stored yet. Sync first.' });
    }

    const rescored = allLeads.map(lead => {
      const result = scoreExtractedLead(lead, config);
      return {
        ...lead,
        score:        result.score,
        category:     result.category,
        priority:     result.priority,
        breakdown:    result.breakdown,
        lastScoredAt: new Date().toISOString()
      };
    });

    const result = rep.updateAllHubspotLeadScores(rescored);
    res.json({ ok: true, rescored: result.rescored });
  } catch (err) {
    console.error('rep-tracker/rescore error:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/rep-tracker/hs-stats  — aggregated analytics from local DB (instant!)
router.get('/rep-tracker/hs-stats', (req, res) => {
  try {
    const { ownerId, teamId, dateFrom, dateTo } = req.query;

    // If teamId is provided, resolve to owner IDs
    let ownerIds;
    if (teamId) {
      const owners = db.getOwners();
      ownerIds = owners
        .filter(o => (o.teams || []).some(t => String(t.id) === String(teamId)))
        .map(o => o.id);
    }
    if (ownerId) {
      ownerIds = [ownerId];
    }

    const result = db.getRepStats({ ownerId: ownerIds?.length === 1 ? ownerIds[0] : undefined, ownerIds, dateFrom, dateTo });

    // Also include the full leads list for chart click-through
    const leads = db.getAllContacts({
      ownerIds,
      ownerId: ownerIds?.length === 1 ? ownerIds[0] : undefined,
      dateFrom, dateTo
    });
    const ownerMap = {};
    db.getOwners().forEach(o => { ownerMap[o.id] = o.name; });

    result.allLeads = leads.map(l => ({
      name: l.name, email: l.email, jobTitle: l.jobtitle,
      companyName: l.company_name, country: l.country,
      score: l.icp_score, category: l.icp_category, priority: l.icp_priority,
      leadSource: l.lead_source, destinationCloud: l.type_of_destination || l.destination_cloud,
      ownerName: ownerMap[l.hubspot_owner_id] || null, createDate: l.create_date
    }));

    // Top 20 leads by ICP score for the Top Scored Leads table
    result.topLeads = [...result.allLeads]
      .filter(l => l.score != null)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 20);

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  COMBINATIONS — Source → Destination cloud combinations
// ═════════════════════════════════════════════════════════════════════════════

// Map a raw contacts-table row to the lead shape the UI expects (incl. breakdown).
function mapContactRowToLead(r, ownerMap = {}) {
  let breakdown = null;
  try { breakdown = r.breakdown_json ? JSON.parse(r.breakdown_json) : null; } catch (_) {}
  return {
    name:              r.name,
    email:             r.email,
    jobTitle:          r.jobtitle,
    companyName:       r.company_name,
    country:           r.country,
    industry:          r.industry,
    numberOfEmployees: r.numberofemployees,
    sourceCloud:       r.source_cloud,
    destinationCloud:  r.type_of_destination || r.destination_cloud,
    typeOfDestination: r.type_of_destination,
    leadSource:        r.lead_source,
    mqlType:           r.mql_type,
    ownerName:         ownerMap[r.hubspot_owner_id] || null,
    createDate:        r.create_date,
    ownerAssignedDate: r.owner_assigned_date,
    score:             r.icp_score,
    category:          r.icp_category,
    priority:          r.icp_priority,
    breakdown
  };
}

// GET /api/combinations — aggregated source→destination combos (+ country/date filters)
router.get('/combinations', (req, res) => {
  try {
    const { country, dateFrom, dateTo } = req.query;
    const rows = db.getCombinations({ country, dateFrom, dateTo });
    const combinations = rows
      // drop rows where we know neither side of the migration
      .filter(r => !(r.source === 'Unknown' && r.destination === 'Unknown'))
      .map(r => ({
        source:      r.source,
        destination: r.destination,
        total:       r.total,
        avgScore:    r.avgScore || 0,
        categories: {
          'Core ICP':     r.core,
          'Strong ICP':   r.strong,
          'Moderate ICP': r.moderate,
          'Non ICP':      r.non
        }
      }));
    res.json({ ok: true, combinations, countries: db.getDistinctCountries() });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/combinations/contacts — customers for a chosen combination
router.get('/combinations/contacts', (req, res) => {
  try {
    const { source, destination, country, dateFrom, dateTo } = req.query;
    const ownerMap = {};
    db.getOwners().forEach(o => { ownerMap[o.id] = o.name; });
    const rows = db.getCombinationContacts({ source, destination, country, dateFrom, dateTo });
    const contacts = rows.map(r => mapContactRowToLead(r, ownerMap));
    res.json({ ok: true, total: contacts.length, contacts });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  SYNC — Pull from HubSpot, store in local SQLite DB
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/sync/full  — Full sync: pull ALL contacts from HubSpot into local DB
router.post('/sync/full', async (req, res) => {
  const syncId = db.startSync('contacts');
  try {
    // 1. Sync owners
    const owners = await hs.getOwners();
    const now = new Date().toISOString();
    db.upsertOwners(owners.map(o => ({
      id: o.id, name: o.name, email: o.email,
      teams_json: JSON.stringify(o.teams), synced_at: now
    })));

    // 2. Sync property options
    for (const prop of ['lead_source', 'mql_type', 'type_of_destination', 'lifecyclestage']) {
      try {
        const opts = await hs.getPropertyOptions('contacts', prop);
        if (opts.length) db.upsertPropertyOptions(prop, opts);
      } catch (_) {}
    }

    // 3. Clear old contacts so the DB reflects only the filtered range
    db.clearContacts();

    // 4. Pull contacts — mandatory lead source + team filters enforced centrally;
    //    date range comes from the request (falls back to previous quarter if omitted)
    const { dateFrom, dateTo } = req.body || {};
    const contacts = await hs.pullMandatoryContacts({ dateFrom, dateTo });
    const dates = contacts.map(c => c.properties?.createdate).filter(Boolean).sort();
    console.log(`[sync] HubSpot returned ${contacts.length} contacts`);
    if (dates.length) console.log(`[sync] Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

    // 5. Build owner map for name lookups
    const ownerMap = {};
    owners.forEach(o => { ownerMap[o.id] = o; });

    // 4b. Batch-fetch all company data (one request per 100 companies instead of one per contact)
    const companyIds = contacts
      .map(c => c.associations?.companies?.results?.[0]?.id || c.properties?.associatedcompanyid)
      .filter(Boolean);
    const companyMap = await hs.batchGetCompanies(companyIds);

    // 5. Map to DB rows
    const config = loadConfig();
    const rows = [];
    const techField = process.env.TECH_STACK_FIELD || 'technologies';

    for (const c of contacts) {
      const p = c.properties;
      const owner = ownerMap[p.hubspot_owner_id];

      // Look up company data from pre-fetched map
      const companyId = c.associations?.companies?.results?.[0]?.id || p.associatedcompanyid;
      const cp = companyId ? (companyMap.get(companyId) || null) : null;
      const companyName = cp?.name || null;
      const companyEmployees = parseEmployeeCount(cp?.numberofemployees);
      const companyCountry = cp?.country || null;
      const companyIndustry = cp?.industry || null;
      const companyTech = cp ? (cp[techField] || null) : null;

      const name = `${p.firstname || ''} ${p.lastname || ''}`.trim() || p.email;
      const techStack = p.type_of_destination || p.destination_cloud || companyTech || null;

      // Score
      const lead = {
        name, email: p.email, jobTitle: p.jobtitle,
        numberOfEmployees: parseEmployeeCount(p.numberofemployees) || companyEmployees,
        country: p[process.env.SELECT_COUNTRY_FIELD || 'select_country'] || p.country || companyCountry,
        industry: p.industry || companyIndustry,
        sourceCloud: p.source__cloud || p.source_destination || null,
        destinationCloud: p.destination_cloud || p.type_of_destination || null,
        techStack,
        companyName
      };
      const result = scoreExtractedLead(lead, config);

      rows.push({
        hubspot_id:          c.id,
        email:               p.email || null,
        firstname:           p.firstname || null,
        lastname:            p.lastname || null,
        name,
        jobtitle:            p.jobtitle || null,
        phone:               p.phone || null,
        country:             p[process.env.SELECT_COUNTRY_FIELD || 'select_country'] || p.country || companyCountry || null,
        industry:            p.industry || companyIndustry || null,
        numberofemployees:   parseEmployeeCount(p.numberofemployees) || companyEmployees,
        company_name:        companyName,
        lifecyclestage:      p.lifecyclestage || null,
        lead_source:         p.lead_source || null,
        mql_type:            p.mql_type || null,
        source_cloud:        p.source__cloud || p.source_destination || null,
        destination_cloud:   p.destination_cloud || null,
        type_of_destination: p.type_of_destination || null,
        tech_stack:          techStack,
        hubspot_owner_id:    p.hubspot_owner_id || null,
        owner_assigned_date: p.hubspot_owner_assigneddate
          ? new Date(p.hubspot_owner_assigneddate).toISOString().split('T')[0] : null,
        create_date:         p.createdate
          ? new Date(p.createdate).toISOString().split('T')[0] : null,
        mql_date:            p.hs_lifecyclestage_marketingqualifiedlead_date
          ? new Date(p.hs_lifecyclestage_marketingqualifiedlead_date).toISOString().split('T')[0] : null,
        hs_analytics_source: p.hs_analytics_source || null,
        size_of_business:    p.size_of_business || null,
        icp_score:           result.score,
        icp_category:        result.category,
        icp_priority:        result.priority,
        breakdown_json:      JSON.stringify(result.breakdown),
        last_scored_at:      now,
        synced_at:           now,
        raw_properties:      null
      });
    }

    // 6. Batch insert into SQLite
    if (rows.length) db.upsertContactsBatch(rows);

    db.endSync(syncId, { status: 'success', contactsSynced: rows.length });

    res.json({
      ok: true,
      contacts: rows.length,
      owners: owners.length,
      lastSync: now,
      message: `Synced ${rows.length} contacts, ${owners.length} owners`
    });
  } catch (err) {
    console.error('sync/full error:', err);
    db.endSync(syncId, { status: 'error', message: err.message });
    const hsMsg = err.body?.message || err.response?.body?.message;
    res.status(500).json({ ok: false, message: hsMsg ? `HubSpot: ${hsMsg}` : err.message });
  }
});

// GET /api/sync/status  — Get sync status + last sync time
router.get('/sync/status', (req, res) => {
  try {
    const lastSync = db.getLastSync('contacts');
    const contactCount = db.getContactCount();
    const history = db.getSyncHistory(5);
    res.json({
      ok: true,
      lastSync: lastSync?.ended_at || null,
      contactCount,
      history
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/sync/rescore  — Re-score all cached contacts with current config
router.post('/sync/rescore', (req, res) => {
  try {
    const config = loadConfig();
    const contacts = db.getAllContacts();
    if (!contacts.length) {
      return res.json({ ok: true, rescored: 0, message: 'No contacts cached. Sync first.' });
    }

    const now = new Date().toISOString();
    const scores = contacts.map(c => {
      const lead = {
        name: c.name, email: c.email, jobTitle: c.jobtitle,
        numberOfEmployees: c.numberofemployees,
        country: c.country, industry: c.industry,
        sourceCloud: c.source_cloud || null,
        destinationCloud: c.destination_cloud || c.type_of_destination || null,
        techStack: c.tech_stack, companyName: c.company_name
      };
      const result = scoreExtractedLead(lead, config);
      return {
        hubspot_id:     c.hubspot_id,
        icp_score:      result.score,
        icp_category:   result.category,
        icp_priority:   result.priority,
        breakdown_json: JSON.stringify(result.breakdown),
        last_scored_at: now
      };
    });

    const updated = db.updateContactScores(scores);
    res.json({ ok: true, rescored: updated });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
