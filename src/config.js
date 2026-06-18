// ─── Mandatory HubSpot pull filters (business requirement) ───────────────────
// Only contacts matching ALL conditions are pulled from HubSpot:
//   Lead Source IN MANDATORY_LEAD_SOURCES
//   AND Owner's team IN MANDATORY_TEAM_NAMES
//   AND MQL Type IN MANDATORY_MQL_TYPES
//   AND Create date within the selected From/To range
const MANDATORY_LEAD_SOURCES = [
  'Manage', 'Manage and Migrate', 'Web_Pricing', 'Chat', 'Email',
  'Web Contact Form', 'Webapp_Pricing', 'Multi channel', 'Migrate',
  'Personal Web_Pricing', 'Contact', 'Free Consultation'
];

const MANDATORY_TEAM_NAMES = [
  'Account Management Team', 'Large MSP/Enterprise', 'SMB Team'
];

const MANDATORY_MQL_TYPES = [
  'Business MQL'
];

// ─── Outbound Leads filters (separate view) ──────────────────────────────────
//   Outbound Marketing lead = Yes  AND  Outbound marketing contact owner IN [...]
// NOTE: verify these internal property names/values in HubSpot
// (Settings → Properties). Adjust here if the pull returns 0 / errors.
const OUTBOUND_LEAD_PROP   = 'outbound_marketing_lead';
const OUTBOUND_LEAD_VALUE  = 'Yes';
const OUTBOUND_OWNER_PROP  = 'outbound_marketing_contact_owner';
const OUTBOUND_OWNERS      = ['Abhigna', 'Raj'];

// Returns { dateFrom, dateTo } for the previous calendar quarter.
// e.g. if today is Apr 1 2026 (Q2) → Q1 2026: { dateFrom: '2026-01-01', dateTo: '2026-03-31' }
function getLastQuarterRange(now = new Date()) {
  const curQ  = Math.floor(now.getMonth() / 3);     // 0-based quarter (0=Q1 … 3=Q4)
  const year  = curQ === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevQ = curQ === 0 ? 3 : curQ - 1;          // previous quarter (0-based)
  const startMonth = prevQ * 3;                      // 0=Jan, 3=Apr, 6=Jul, 9=Oct
  const endMonth   = startMonth + 2;

  const pad = n => String(n).padStart(2, '0');
  const lastDay = new Date(year, endMonth + 1, 0).getDate();

  return {
    dateFrom: `${year}-${pad(startMonth + 1)}-01`,
    dateTo:   `${year}-${pad(endMonth + 1)}-${pad(lastDay)}`
  };
}

// ─── HubSpot field names ──────────────────────────────────────────────────────
const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'jobtitle', 'phone',
  'country',
  'hs_lead_status',
  'hs_analytics_source',       // lead source (ORGANIC, PAID, REFERRAL, etc.)
  'hs_analytics_source_data_1',// sub-source detail
  'hs_analytics_source_data_2',// sub-source detail 2
  'hs_lifecyclestage_marketingqualifiedlead_date', // MQL date
  'lifecyclestage',            // subscriber, lead, mql, sql, etc.
  'createdate',                // contact create date
  'numberofemployees',         // contact-level employee count
  'industry',                  // contact-level industry
  'associatedcompanyid',
  'icp_score', 'icp_category', 'icp_priority',
  'hubspot_owner_id',          // contact owner (sales rep)
  'hubspot_owner_assigneddate', // date owner was assigned
  'mql_type',                  // MQL type (Business MQL, etc.)
  'hs_email_domain',           // company domain from email
  'lead_source',               // CloudFuze custom lead source (Web_Pricing, Chat, Email, etc.)
  'source__cloud',             // Source cloud (Box, Dropbox, Slack, etc.)
  'destination_cloud',         // Destination cloud (free text)
  'type_of_destination',       // Destination cloud enum (Office 365, Google Workspace, Teams)
  'source_destination',        // Source_Cloud alias
  'size_of_business',          // Company size segment (SMB, MSP, Large MSP, Enterprise)
  'hubspot_team_id'            // Built-in Sales Property: HubSpot Team (stores team ID)
  // select_country added dynamically via SELECT_COUNTRY_FIELD env var
];

const COMPANY_PROPERTIES = [
  'name', 'domain', 'numberofemployees',
  'country', 'industry',
  'technologies',          // default tech-stack field (customisable via .env)
  'hubspot_owner_id', 'hs_lead_status'
];

// ─── Geography ────────────────────────────────────────────────────────────────
const GEO_TIER1 = new Set([
  'united states', 'us', 'usa', 'u.s.', 'u.s.a.',
  'canada', 'ca',
  'united kingdom', 'uk', 'gb', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'
]);

const GEO_TIER2 = new Set([
  // Europe
  'germany', 'de', 'france', 'fr', 'spain', 'es', 'italy', 'it',
  'netherlands', 'nl', 'belgium', 'be', 'sweden', 'se', 'norway', 'no',
  'denmark', 'dk', 'finland', 'fi', 'poland', 'pl', 'czech republic', 'cz',
  'austria', 'at', 'switzerland', 'ch', 'portugal', 'pt', 'greece', 'gr',
  'hungary', 'hu', 'romania', 'ro', 'bulgaria', 'bg', 'croatia', 'hr',
  'slovakia', 'sk', 'slovenia', 'si', 'estonia', 'ee', 'latvia', 'lv',
  'lithuania', 'lt', 'luxembourg', 'lu', 'malta', 'mt', 'cyprus', 'cy',
  'ireland', 'ie', 'iceland', 'is', 'liechtenstein',
  // Australia & India
  'australia', 'au', 'india', 'in'
]);

// ─── Industry tiers ───────────────────────────────────────────────────────────
// Values cover both HubSpot enum keys and human-readable labels
const INDUSTRY_TIER1_KEYWORDS = [
  'computer software', 'software', 'information technology', 'it services',
  'it consulting', 'technology', 'saas', 'tech'
];

const INDUSTRY_TIER2_KEYWORDS = [
  'financial services', 'finance', 'banking', 'insurance',
  'marketing', 'advertising', 'digital marketing',
  'hospital', 'health care', 'healthcare', 'medical', 'pharma', 'biotech'
];

const INDUSTRY_TIER3_KEYWORDS = [
  'education', 'e-learning', 'elearning', 'higher education',
  'university', 'school', 'academic', 'training'
];

// ─── Technology tiers ─────────────────────────────────────────────────────────
const TECH_TIER1_KEYWORDS = [
  'microsoft 365', 'office 365', 'm365', 'o365',
  'google workspace', 'g suite', 'gsuite'
];

const TECH_TIER2_KEYWORDS = [
  'dropbox', 'box.com', 'egnyte', 'slack', 'sharefile'
];

const TECH_TIER3_KEYWORDS = [
  'cloud', 'aws', 'azure', 'gcp', 'onedrive', 'sharepoint',
  'zoom', 'teams', 'salesforce', 'hubspot'
];

// ─── Buyer Fit (job title) ────────────────────────────────────────────────────
const BUYER_TIER1_KEYWORDS = [
  'cio', 'chief information officer',
  'cto', 'chief technology officer',
  'ceo', 'chief executive',
  'it director', 'director of it', 'director, it',
  'head of it', 'vp of it', 'vp it', 'vice president of it',
  'head of technology', 'vp of technology'
];

const BUYER_TIER2_KEYWORDS = [
  'it manager', 'it admin', 'it administrator',
  'systems administrator', 'sysadmin', 'sys admin',
  'network administrator', 'infrastructure manager',
  'it specialist', 'it lead', 'it supervisor'
];

const BUYER_TIER3_KEYWORDS = [
  'consultant', 'consulting', 'advisor', 'strategist'
];

// ─── ICP Category thresholds ──────────────────────────────────────────────────
const CATEGORIES = [
  { label: 'Core ICP',     priority: 'Highest Priority', min: 80, max: 100 },
  { label: 'Strong ICP',   priority: 'High Priority',    min: 65, max: 79  },
  { label: 'Moderate ICP', priority: 'Nurture',          min: 50, max: 64  },
  { label: 'Non ICP',      priority: 'Low Priority',     min: 0,  max: 49  }
];

module.exports = {
  MANDATORY_LEAD_SOURCES,
  MANDATORY_TEAM_NAMES,
  MANDATORY_MQL_TYPES,
  OUTBOUND_LEAD_PROP,
  OUTBOUND_LEAD_VALUE,
  OUTBOUND_OWNER_PROP,
  OUTBOUND_OWNERS,
  getLastQuarterRange,
  CONTACT_PROPERTIES,
  COMPANY_PROPERTIES,
  GEO_TIER1,
  GEO_TIER2,
  INDUSTRY_TIER1_KEYWORDS,
  INDUSTRY_TIER2_KEYWORDS,
  INDUSTRY_TIER3_KEYWORDS,
  TECH_TIER1_KEYWORDS,
  TECH_TIER2_KEYWORDS,
  TECH_TIER3_KEYWORDS,
  BUYER_TIER1_KEYWORDS,
  BUYER_TIER2_KEYWORDS,
  BUYER_TIER3_KEYWORDS,
  CATEGORIES
};
