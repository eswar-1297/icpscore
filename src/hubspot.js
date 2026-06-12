const hubspot = require('@hubspot/api-client');
const { CONTACT_PROPERTIES, COMPANY_PROPERTIES, MANDATORY_LEAD_SOURCES, MANDATORY_TEAM_NAMES, getLastQuarterRange } = require('./config');

// Dynamically include SELECT_COUNTRY_FIELD if set
function getContactProperties() {
  const props = [...CONTACT_PROPERTIES];
  const extra = process.env.SELECT_COUNTRY_FIELD;
  if (extra && !props.includes(extra)) props.push(extra);
  return props;
}

let client;

function getClient() {
  if (!client) {
    if (!process.env.HUBSPOT_ACCESS_TOKEN) {
      throw new Error('HUBSPOT_ACCESS_TOKEN is not set in your .env file');
    }
    client = new hubspot.Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  }
  return client;
}

// ─── Fetch all contacts (paginated) ──────────────────────────────────────────
async function getAllContacts({ dateFrom, dateTo } = {}) {
  const hs = getClient();
  const contacts = [];

  // When a date range is given, use the search API (supports filters)
  if (dateFrom || dateTo) {
    const filters = [];
    if (dateFrom) filters.push({ propertyName: 'createdate', operator: 'GTE', value: new Date(dateFrom).getTime().toString() });
    if (dateTo) {
      const d = new Date(dateTo);
      d.setDate(d.getDate() + 1);
      filters.push({ propertyName: 'createdate', operator: 'LT', value: d.getTime().toString() });
    }
    const searchBody = {
      properties: getContactProperties(),
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 100,
      filterGroups: [{ filters }]
    };
    let after;
    do {
      if (after !== undefined) searchBody.after = after;
      const res = await hs.crm.contacts.searchApi.doSearch(searchBody);
      contacts.push(...(res.results || []));
      after = res.paging?.next?.after;
    } while (after);
    return contacts;
  }

  // No date filter — use the basic list API (returns associations inline)
  let after;
  do {
    const response = await hs.crm.contacts.basicApi.getPage(
      100,
      after,
      getContactProperties(),
      undefined,
      ['companies']   // fetch associated company in one call
    );
    contacts.push(...response.results);
    after = response.paging?.next?.after;
  } while (after);

  return contacts;
}

// ─── Fetch a single contact with associations ─────────────────────────────────
async function getContact(contactId) {
  const hs = getClient();
  return hs.crm.contacts.basicApi.getById(
    contactId,
    getContactProperties(),
    undefined,
    ['companies']
  );
}

// ─── Fetch a company by ID ────────────────────────────────────────────────────
async function getCompany(companyId) {
  const hs = getClient();
  const techField = process.env.TECH_STACK_FIELD || 'technologies';
  const props = Array.from(new Set([...COMPANY_PROPERTIES, techField]));
  return hs.crm.companies.basicApi.getById(companyId, props);
}

// ─── Batch-fetch companies by IDs (chunks of 100) ────────────────────────────
// Returns a Map<companyId, properties>
async function batchGetCompanies(companyIds) {
  if (!companyIds.length) return new Map();
  const hs = getClient();
  const techField = process.env.TECH_STACK_FIELD || 'technologies';
  const props = Array.from(new Set([...COMPANY_PROPERTIES, techField]));
  const uniqueIds = [...new Set(companyIds)];
  const map = new Map();

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    try {
      const res = await hs.crm.companies.batchApi.read({
        inputs: chunk.map(id => ({ id })),
        properties: props
      });
      for (const co of res.results) {
        map.set(co.id, co.properties);
      }
    } catch (_) {}
  }
  return map;
}

// ─── Batch-update contacts ────────────────────────────────────────────────────
async function batchUpdateContacts(updates) {
  if (!updates.length) return;
  const hs = getClient();

  const BATCH_SIZE = 100;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    await hs.crm.contacts.batchApi.update({ inputs: chunk });
  }
}

// ─── Update a single contact ──────────────────────────────────────────────────
async function updateContact(contactId, properties) {
  const hs = getClient();
  return hs.crm.contacts.basicApi.update(contactId, { properties });
}

// ─── Create custom HubSpot properties (run once via `npm run setup`) ──────────
async function ensureCustomProperties() {
  const hs = getClient();
  const results = { created: [], skipped: [], errors: [] };

  const propsToCreate = [
    {
      name: 'icp_score',
      label: 'ICP Score',
      groupName: 'contactinformation',
      type: 'number',
      fieldType: 'number',
      description: 'Calculated ICP score (0–100)'
    },
    {
      name: 'icp_category',
      label: 'ICP Category',
      groupName: 'contactinformation',
      type: 'enumeration',
      fieldType: 'select',
      description: 'ICP classification based on score',
      options: [
        { label: 'Core ICP',     value: 'Core ICP',     displayOrder: 0, hidden: false },
        { label: 'Strong ICP',   value: 'Strong ICP',   displayOrder: 1, hidden: false },
        { label: 'Moderate ICP', value: 'Moderate ICP', displayOrder: 2, hidden: false },
        { label: 'Non ICP',      value: 'Non ICP',      displayOrder: 3, hidden: false }
      ]
    },
    {
      name: 'icp_priority',
      label: 'ICP Priority',
      groupName: 'contactinformation',
      type: 'enumeration',
      fieldType: 'select',
      description: 'Sales priority derived from ICP category',
      options: [
        { label: 'Highest Priority', value: 'Highest Priority', displayOrder: 0, hidden: false },
        { label: 'High Priority',    value: 'High Priority',    displayOrder: 1, hidden: false },
        { label: 'Nurture',          value: 'Nurture',          displayOrder: 2, hidden: false },
        { label: 'Low Priority',     value: 'Low Priority',     displayOrder: 3, hidden: false }
      ]
    }
  ];

  for (const prop of propsToCreate) {
    try {
      await hs.crm.properties.coreApi.create('contacts', prop);
      results.created.push(prop.name);
      console.log(`  Created property: ${prop.name}`);
    } catch (err) {
      if (err.code === 409 || err.body?.message?.includes('already exists')) {
        results.skipped.push(prop.name);
        console.log(`  Already exists: ${prop.name}`);
      } else {
        results.errors.push({ name: prop.name, error: err.message });
        console.error(`  Failed: ${prop.name} —`, err.message);
      }
    }
  }

  return results;
}

// ─── Get all contact owners (sales reps in HubSpot) ──────────────────────────
async function getOwners() {
  const hs = getClient();
  const all = [];
  let after;
  do {
    // Signature: getPage(email?, after?, limit?, archived?)
    // Passing undefined for email, use after cursor for pagination
    const res = await hs.crm.owners.ownersApi.getPage(undefined, after, 200, false);
    all.push(...(res.results || []));
    after = res.paging?.next?.after;
  } while (after);

  return all.map(o => ({
    id:     String(o.id),
    name:   `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email,
    email:  o.email,
    teams:  (o.teams || []).map(t => ({ id: String(t.id), name: t.name }))
  }));
}

// ─── Get HubSpot teams ────────────────────────────────────────────────────────
async function getHubspotTeams() {
  const hs = getClient();
  try {
    const res = await hs.settings.users.teamsApi.getAll();
    return (res.results || []).map(t => ({
      id:      String(t.id),
      name:    t.name,
      userIds: (t.userIds || []).map(String)
    }));
  } catch (err) {
    // Fall back to deriving teams from owners
    try {
      const owners = await getOwners();
      const teamMap = {};
      owners.forEach(o => {
        o.teams.forEach(t => {
          if (!teamMap[t.id]) teamMap[t.id] = { id: t.id, name: t.name, userIds: [] };
          teamMap[t.id].userIds.push(o.id);
        });
      });
      return Object.values(teamMap);
    } catch (_) {
      return [];
    }
  }
}

// ─── Get property options (lead source values, MQL type values, etc.) ─────────
async function getPropertyOptions(objectType, propName) {
  const hs = getClient();
  try {
    const prop = await hs.crm.properties.coreApi.getByName(objectType, propName);
    return (prop.options || []).map(o => ({ label: o.label, value: o.value }));
  } catch (_) {
    return [];
  }
}

// ─── Resolve team names → IDs for the hubspot_team_id filter ─────────────────
// hubspot_team_id is a built-in Sales Property that stores numeric team IDs.
// Its values come from HubSpot's Teams settings (not property options), so we
// resolve names via the Teams API / Owners API.
let _teamNameToId = null;

async function resolveTeamNameToIdMap() {
  if (_teamNameToId) return _teamNameToId;
  _teamNameToId = {};

  // 1. Try the Teams API first
  try {
    const teams = await getHubspotTeams();
    for (const t of teams) {
      _teamNameToId[t.name.trim().toLowerCase()] = t.id;
    }
    console.log(`[hubspot] Teams API returned ${teams.length} teams:`);
    teams.forEach(t => console.log(`  - "${t.name}" → id ${t.id}`));
    if (teams.length) return _teamNameToId;
  } catch (_) {}

  // 2. Fallback: derive teams from owners
  try {
    const owners = await getOwners();
    for (const o of owners) {
      for (const t of (o.teams || [])) {
        _teamNameToId[t.name.trim().toLowerCase()] = t.id;
      }
    }
    const entries = Object.entries(_teamNameToId);
    console.log(`[hubspot] Derived ${entries.length} teams from owners:`);
    entries.forEach(([name, id]) => console.log(`  - "${name}" → id ${id}`));
  } catch (err) {
    console.error('[hubspot] Failed to resolve teams:', err.message);
  }

  return _teamNameToId;
}

async function resolveTeamFilterValues(teamNames) {
  const fieldName = process.env.HUBSPOT_TEAM_FIELD || 'hubspot_team_id';
  const nameToId = await resolveTeamNameToIdMap();

  const values = [];
  for (const name of teamNames) {
    const id = nameToId[name.trim().toLowerCase()];
    if (id) {
      values.push(String(id));
    } else {
      console.warn(`[hubspot] Team "${name}" not found in any HubSpot team — skipping`);
    }
  }
  return { fieldName, values };
}

// ─── Advanced contact search (hubspot_team, lead source multi, date range) ────
async function searchContactsAdvanced({
  leadSources      = [],
  hubspotTeams     = [],
  mqlType,
  ownerIds         = [],
  teamId,
  ownerAssignedFrom,
  ownerAssignedTo,
  dateFrom,
  dateTo,
  lifecycleStage
} = {}) {
  const hs = getClient();
  const filters = [];

  // Resolve team → owner IDs if teamId given
  let resolvedOwnerIds = [...ownerIds];
  if (teamId) {
    try {
      const teams = await getHubspotTeams();
      const team  = teams.find(t => t.id === String(teamId));
      if (team) resolvedOwnerIds = [...new Set([...resolvedOwnerIds, ...team.userIds])];
    } catch (_) {}
  }

  // Owner assigned date range (correct property name: hubspot_owner_assigneddate)
  if (ownerAssignedFrom) {
    filters.push({ propertyName: 'hubspot_owner_assigneddate', operator: 'GTE',
      value: new Date(ownerAssignedFrom).getTime().toString() });
  }
  if (ownerAssignedTo) {
    const d = new Date(ownerAssignedTo);
    d.setDate(d.getDate() + 1);
    filters.push({ propertyName: 'hubspot_owner_assigneddate', operator: 'LT',
      value: d.getTime().toString() });
  }

  // Create date range
  if (dateFrom) {
    filters.push({ propertyName: 'createdate', operator: 'GTE',
      value: new Date(dateFrom).getTime().toString() });
  }
  if (dateTo) {
    const d = new Date(dateTo);
    d.setDate(d.getDate() + 1);
    filters.push({ propertyName: 'createdate', operator: 'LT',
      value: d.getTime().toString() });
  }

  // Lead sources (custom CloudFuze property: lead_source)
  if (leadSources.length === 1) {
    filters.push({ propertyName: 'lead_source', operator: 'EQ', value: leadSources[0] });
  } else if (leadSources.length > 1) {
    filters.push({ propertyName: 'lead_source', operator: 'IN', values: leadSources });
  }

  // HubSpot Team (built-in Sales Property — stores team IDs, not names)
  if (hubspotTeams.length) {
    const { fieldName: teamFieldName, values: teamIds } = await resolveTeamFilterValues(hubspotTeams);
    if (teamIds.length === 1) {
      filters.push({ propertyName: teamFieldName, operator: 'EQ', value: teamIds[0] });
    } else if (teamIds.length > 1) {
      filters.push({ propertyName: teamFieldName, operator: 'IN', values: teamIds });
    }
  }

  // Lifecycle stage
  if (lifecycleStage) {
    filters.push({ propertyName: 'lifecyclestage', operator: 'EQ', value: lifecycleStage });
  }

  // MQL type custom property
  if (mqlType) {
    filters.push({ propertyName: 'mql_type', operator: 'EQ', value: mqlType });
  }

  // Owner IDs (direct + from team)
  if (resolvedOwnerIds.length === 1) {
    filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: resolvedOwnerIds[0] });
  } else if (resolvedOwnerIds.length > 1) {
    filters.push({ propertyName: 'hubspot_owner_id', operator: 'IN', values: resolvedOwnerIds });
  }

  const searchBody = {
    properties: getContactProperties(),
    sorts:      [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    limit:      100
  };
  // Only include filterGroups when we actually have filters — empty array causes 400
  if (filters.length) searchBody.filterGroups = [{ filters }];

  const contacts = [];
  let after = undefined;

  do {
    if (after !== undefined) searchBody.after = after;
    const res = await hs.crm.contacts.searchApi.doSearch(searchBody);
    contacts.push(...(res.results || []));
    after = res.paging?.next?.after;
  } while (after);

  return contacts;
}

// ─── Search contacts with filters (create date, lead source, lifecycle) ──────
async function searchContacts({ dateFrom, dateTo, leadSource, lifecycleStage } = {}) {
  return searchContactsAdvanced({
    dateFrom, dateTo,
    leadSources:    leadSource ? [leadSource] : [],
    lifecycleStage
  });
}

// ─── Dashboard aggregation helpers ───────────────────────────────────────────
async function getDashboardData() {
  const contacts = await getAllContacts();
  const scored = contacts.filter(c => c.properties.icp_score != null);

  const categoryCount = {};
  const geographyCount = {};
  const highPriority = [];

  for (const c of scored) {
    const cat = c.properties.icp_category || 'Unknown';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;

    const country = c.properties.country || 'Unknown';
    geographyCount[country] = (geographyCount[country] || 0) + 1;

    if (c.properties.icp_priority === 'Highest Priority' || c.properties.icp_priority === 'High Priority') {
      highPriority.push({
        id: c.id,
        name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim() || c.properties.email,
        email: c.properties.email,
        score: Number(c.properties.icp_score),
        category: cat,
        priority: c.properties.icp_priority
      });
    }
  }

  highPriority.sort((a, b) => b.score - a.score);

  return {
    total: contacts.length,
    scored: scored.length,
    categoryCount,
    geographyCount,
    highPriority: highPriority.slice(0, 50)
  };
}

// ─── Central filtered pull: always applies mandatory lead source + team + last quarter filters
async function pullMandatoryContacts(extraFilters = {}) {
  // Use the caller-supplied From/To date range; fall back to the previous
  // calendar quarter only when neither bound is provided.
  let { dateFrom, dateTo } = extraFilters;
  if (!dateFrom && !dateTo) {
    ({ dateFrom, dateTo } = getLastQuarterRange());
  }
  const { fieldName, values: teamIds } = await resolveTeamFilterValues(MANDATORY_TEAM_NAMES);
  console.log(`[pullMandatoryContacts] lead_source IN [${MANDATORY_LEAD_SOURCES.join(', ')}]`);
  console.log(`[pullMandatoryContacts] ${fieldName} IN [${teamIds.join(', ')}] (teams: ${MANDATORY_TEAM_NAMES.join(', ')})`);
  console.log(`[pullMandatoryContacts] createdate range: ${dateFrom || '(open)'} → ${dateTo || '(open)'}`);

  return searchContactsAdvanced({
    ...extraFilters,
    leadSources:  MANDATORY_LEAD_SOURCES,
    hubspotTeams: MANDATORY_TEAM_NAMES,
    dateFrom,
    dateTo
  });
}

module.exports = {
  getClient,
  getAllContacts,
  getContact,
  getCompany,
  batchGetCompanies,
  batchUpdateContacts,
  updateContact,
  ensureCustomProperties,
  getOwners,
  getHubspotTeams,
  getPropertyOptions,
  searchContacts,
  searchContactsAdvanced,
  getDashboardData,
  resolveTeamFilterValues,
  pullMandatoryContacts,
  MANDATORY_LEAD_SOURCES,
  MANDATORY_TEAM_NAMES
};
