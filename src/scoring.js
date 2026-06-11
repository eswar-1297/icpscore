'use strict';
const { loadConfig } = require('./configManager');

// ═══════════════════════════════════════════════════════════════════════════════
//  Employee Count Parser (handles K, M, ranges, Excel date-converted values)
// ═══════════════════════════════════════════════════════════════════════════════

const MONTHS_MAP = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseSingleValue(str) {
  if (!str) return null;
  str = str.trim();
  const kMatch = str.match(/^([\d.]+)\s*[kK]$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const mMatch = str.match(/^([\d.]+)\s*[mM]$/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);
  const n = parseFloat(str);
  return isNaN(n) ? null : Math.round(n);
}

function parseEmployeeCount(val) {
  if (val == null) return null;

  if (val instanceof Date && !isNaN(val)) {
    const month = val.getMonth() + 1;
    const day = val.getDate();
    return Math.max(month, day);
  }

  let str = String(val).trim();
  if (!str || /^(n\/a|unknown|none|null|undefined|na|-|#n\/a|#value!|#ref!)$/i.test(str)) return null;

  str = str.replace(/,/g, '');

  // Strip common suffixes: "10K+ employees" → "10K+", "200-500 employees" → "200-500"
  str = str.replace(/\s*(employees|employee|people|persons|person|staff|workers|headcount|hc)\s*$/i, '').trim();

  // Date patterns: "10-Feb", "Feb-10", "5-Jan", "Jan-5"
  const dayMonth = str.match(/^(\d+)[\s\-–—]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*$/i);
  if (dayMonth) {
    return Math.max(parseInt(dayMonth[1], 10), MONTHS_MAP[dayMonth[2].toLowerCase().slice(0, 3)] || 0);
  }
  const monthDay = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-–—]+(\d+)$/i);
  if (monthDay) {
    return Math.max(MONTHS_MAP[monthDay[1].toLowerCase().slice(0, 3)] || 0, parseInt(monthDay[2], 10));
  }

  str = str.replace(/\+\s*$/, '');

  // Ranges: "200-500", "500-1k", "1k-5k"
  const rangeParts = str.split(/[\-–—]/);
  if (rangeParts.length >= 2 && rangeParts.every(p => /\S/.test(p))) {
    const nums = rangeParts.map(p => parseSingleValue(p.trim())).filter(n => n != null);
    if (nums.length >= 2) return Math.max(...nums);
  }

  return parseSingleValue(str);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Matching Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function normalise(str) {
  return (str || '').toLowerCase().trim();
}

function matchesAny(value, keywords) {
  if (!keywords || !keywords.length) return false;
  const v = normalise(value);
  if (!v) return false;
  return keywords.some(kw => v.includes(normalise(kw)));
}

function matchesAnyWholeWord(value, keywords) {
  if (!keywords || !keywords.length) return false;
  const v = normalise(value);
  if (!v) return false;
  return keywords.some(kw => {
    const escaped = normalise(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(v);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Geography Lookup Tables (sub-national: states, cities, provinces)
// ═══════════════════════════════════════════════════════════════════════════════

const TIER1_GEO = new Set([
  // --- US States (all 50) ---
  'alabama','alaska','arizona','arkansas','california','colorado',
  'connecticut','delaware','florida','georgia','hawaii','idaho',
  'illinois','indiana','iowa','kansas','kentucky','louisiana',
  'maine','maryland','massachusetts','michigan','minnesota',
  'mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york',
  'north carolina','north dakota','ohio','oklahoma','oregon',
  'pennsylvania','rhode island','south carolina','south dakota',
  'tennessee','texas','utah','vermont','virginia','washington',
  'west virginia','wisconsin','wyoming',
  // --- US Major Cities ---
  'new york city','nyc','los angeles','chicago','houston','phoenix',
  'philadelphia','san antonio','san diego','dallas','san jose',
  'austin','jacksonville','san francisco','charlotte','columbus',
  'fort worth','indianapolis','seattle','denver','boston',
  'nashville','oklahoma city','portland','las vegas','memphis',
  'louisville','baltimore','milwaukee','albuquerque','tucson',
  'fresno','sacramento','mesa','kansas city','atlanta','omaha',
  'colorado springs','raleigh','long beach','virginia beach',
  'miami','oakland','minneapolis','tulsa','tampa','arlington',
  'new orleans','pittsburgh','detroit','cincinnati','cleveland',
  'st. louis','st louis','salt lake city','honolulu',
  // --- US Territories & DC ---
  'washington dc','washington d.c.','dc','d.c.',
  'puerto rico','guam','us virgin islands','usvi',
  'american samoa','northern mariana islands',
  // --- UK Nations ---
  'england','scotland','wales','northern ireland',
  // --- UK Cities ---
  'london','manchester','birmingham','edinburgh','glasgow',
  'liverpool','bristol','leeds','sheffield','cardiff','belfast',
  'nottingham','newcastle','brighton','oxford','cambridge',
  'york','bath','aberdeen','dundee','southampton','portsmouth',
  'leicester','coventry','exeter','norwich','plymouth',
  'reading','wolverhampton','derby','swansea',
  // --- Canadian Provinces ---
  'ontario','quebec','british columbia','alberta','manitoba',
  'saskatchewan','nova scotia','new brunswick',
  'newfoundland and labrador','newfoundland','prince edward island',
  'northwest territories','yukon','nunavut',
  // --- Canadian Cities ---
  'toronto','montreal','vancouver','calgary','edmonton','ottawa',
  'winnipeg','quebec city','hamilton','halifax','victoria',
  'saskatoon','regina',"st. john's",'st johns','kitchener',
  'oshawa','barrie','windsor','kelowna','mississauga','brampton',
  'surrey','burnaby','richmond'
]);

const TIER2_GEO = new Set([
  // --- India States ---
  'maharashtra','karnataka','tamil nadu','delhi','gujarat',
  'telangana','west bengal','rajasthan','uttar pradesh',
  'madhya pradesh','kerala','andhra pradesh','punjab','haryana',
  'bihar','odisha','jharkhand','chhattisgarh','assam',
  'uttarakhand','himachal pradesh','goa','tripura','meghalaya',
  'manipur','nagaland','mizoram','arunachal pradesh','sikkim',
  'jammu and kashmir','ladakh','new delhi',
  // --- India Cities ---
  'mumbai','bangalore','bengaluru','chennai','hyderabad','pune',
  'kolkata','ahmedabad','noida','gurugram','gurgaon','jaipur',
  'lucknow','chandigarh','indore','bhopal','coimbatore','kochi',
  'thiruvananthapuram','trivandrum','visakhapatnam','vizag',
  'nagpur','surat','vadodara','patna','ranchi','dehradun',
  'mysore','mysuru','mangalore','mangaluru','madurai',
  // --- Australia States ---
  'new south wales','nsw','victoria','queensland','qld',
  'western australia','south australia','tasmania','tas',
  'northern territory','australian capital territory','act',
  // --- Australia Cities ---
  'sydney','melbourne','brisbane','perth','adelaide','canberra',
  'hobart','darwin','gold coast','wollongong','geelong',
  'cairns','townsville',
  // --- European States/Cities ---
  'bavaria','bayern','berlin','munich','frankfurt','hamburg','stuttgart',
  'düsseldorf','dusseldorf','cologne','koln',
  'nordrhein-westfalen','north rhine-westphalia','north rhine westphalia',
  'baden-württemberg','baden-wurttemberg','hessen','sachsen','saxony',
  'niedersachsen','lower saxony','schleswig-holstein',
  'paris','lyon','marseille','toulouse','nice','bordeaux','lille',
  'brittany','bretagne','normandy','normandie','provence',
  'ile-de-france','ile de france',
  'milan','rome','naples','turin','florence','venice','bologna',
  'madrid','barcelona','valencia','seville','malaga',
  'amsterdam','rotterdam','the hague','utrecht','eindhoven',
  'zurich','geneva','basel','bern','lausanne',
  'dublin','cork','galway','limerick',
  'stockholm','gothenburg','malmö','malmo',
  'oslo','bergen','stavanger',
  'copenhagen','aarhus',
  'helsinki','tampere','espoo',
  'brussels','antwerp','ghent',
  'vienna','salzburg','graz',
  'lisbon','porto','braga',
  'warsaw','krakow','wroclaw','gdansk',
  'prague','brno',
  'budapest','debrecen',
  'bucharest','cluj',
  'sofia','zagreb','bratislava','ljubljana',
  'tallinn','riga','vilnius',
  'luxembourg city','valletta','nicosia',
  'athens','thessaloniki',
  'reykjavik',
  'europe'
]);

// ═══════════════════════════════════════════════════════════════════════════════
//  1. Company Size (max 35)
// ═══════════════════════════════════════════════════════════════════════════════

function scoreCompanySize(employees, config) {
  const n = parseEmployeeCount(employees);
  if (n == null || n <= 0) return { score: 0, reason: 'Unknown / Empty' };
  for (const tier of config.companySize) {
    if (n >= tier.minEmployees && (tier.maxEmployees === null || n <= tier.maxEmployees)) {
      return { score: tier.score, reason: `${n} employees → ${tier.label}` };
    }
  }
  return { score: 0, reason: `${n} employees — no matching tier` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2. Geography (max 35)
// ═══════════════════════════════════════════════════════════════════════════════

function scoreGeography(country, config) {
  const c = normalise(country);
  if (!c) return { score: 0, reason: 'Country not detected' };
  const { tier1, tier2, other } = config.geography;

  if (tier1.countries.some(ct => normalise(ct) === c)) {
    return { score: tier1.score, reason: `${country} → Tier 1` };
  }
  if (tier2.countries.some(ct => normalise(ct) === c)) {
    return { score: tier2.score, reason: `${country} → Tier 2` };
  }
  if (TIER1_GEO.has(c)) {
    return { score: tier1.score, reason: `${country} → Tier 1 (state/city)` };
  }
  if (TIER2_GEO.has(c)) {
    return { score: tier2.score, reason: `${country} → Tier 2 (state/city)` };
  }
  return { score: other.score, reason: `${country} → Other region` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  3. Industry (max 10)
// ═══════════════════════════════════════════════════════════════════════════════

function scoreIndustry(industry, config) {
  const { tier1, tier2, tier3, other, none } = config.industry;
  if (!industry || !normalise(industry)) {
    return { score: (none || { score: 0 }).score, reason: 'Industry not detected' };
  }
  if (matchesAny(industry, tier1.keywords)) {
    return { score: tier1.score, reason: `${industry} → Tier 1 (IT/Software)` };
  }
  if (matchesAny(industry, tier2.keywords)) {
    return { score: tier2.score, reason: `${industry} → Tier 2 (Finance/Health)` };
  }
  if (matchesAny(industry, tier3.keywords)) {
    return { score: tier3.score, reason: `${industry} → Tier 3 (Education)` };
  }
  return { score: other.score, reason: `${industry} → Other industry` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  4. Migration Platform (max 10) — checks BOTH source AND destination
// ═══════════════════════════════════════════════════════════════════════════════

function scoreMigration(sourceCloud, destCloud, config) {
  const { tier1, tier2, tier3, none } = config.technology;
  const src = normalise(sourceCloud);
  const dst = normalise(destCloud);

  const srcIsMain = src && tier1.keywords && matchesAny(sourceCloud, tier1.keywords);
  const dstIsMain = dst && tier1.keywords && matchesAny(destCloud, tier1.keywords);
  if (srcIsMain || dstIsMain) {
    const matched = srcIsMain ? sourceCloud : destCloud;
    return { score: tier1.score, reason: `${matched} → Main platform (Google/Microsoft)` };
  }

  const srcIsSec = src && tier2.keywords && matchesAny(sourceCloud, tier2.keywords);
  const dstIsSec = dst && tier2.keywords && matchesAny(destCloud, tier2.keywords);
  if (srcIsSec || dstIsSec) {
    const matched = srcIsSec ? sourceCloud : destCloud;
    return { score: tier2.score, reason: `${matched} → Secondary platform` };
  }

  if (!src || !dst) {
    return { score: (tier3 || { score: 5 }).score, reason: 'Platform not provided' };
  }

  return { score: (none || { score: 0 }).score, reason: `${sourceCloud} → ${destCloud} — unsupported platforms` };
}

function scoreTechnology(techStack, config) {
  return scoreMigration(null, techStack, config);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  5. Buyer Fit (max 10) — whole-word boundary matching
// ═══════════════════════════════════════════════════════════════════════════════

function scoreBuyerFit(jobTitle, config) {
  const { tier1, tier2, tier3, other, none } = config.buyerFit;
  if (!jobTitle || !normalise(jobTitle)) {
    return { score: (none || { score: 0 }).score, reason: 'No title' };
  }
  if (matchesAnyWholeWord(jobTitle, tier1.keywords)) {
    return { score: tier1.score, reason: `${jobTitle} → C-Level / IT Leadership` };
  }
  if (matchesAnyWholeWord(jobTitle, tier2.keywords)) {
    return { score: tier2.score, reason: `${jobTitle} → IT Manager / Admin` };
  }
  if (matchesAnyWholeWord(jobTitle, tier3.keywords)) {
    return { score: tier3.score, reason: `${jobTitle} → Consultant` };
  }
  return { score: other.score, reason: `${jobTitle} → Non-IT role` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Category Classification
// ═══════════════════════════════════════════════════════════════════════════════

function getCategory(score, config) {
  for (const cat of config.categories) {
    if (score >= cat.min && score <= cat.max) return cat;
  }
  return config.categories[config.categories.length - 1];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Score a HubSpot contact (direct from HubSpot properties)
// ═══════════════════════════════════════════════════════════════════════════════

function scoreContact(contactProps, companyProps = {}) {
  const config    = loadConfig();
  const techField = process.env.TECH_STACK_FIELD || 'technologies';

  const employees   = companyProps.numberofemployees || contactProps.numberofemployees || null;
  const country     = contactProps[process.env.SELECT_COUNTRY_FIELD || 'select_country']
                   || contactProps.country || companyProps.country || null;
  const industry    = companyProps.industry || contactProps.industry || null;
  const sourceCloud = contactProps.source__cloud || contactProps.source_destination || null;
  const destCloud   = contactProps.type_of_destination || contactProps.destination_cloud
                   || companyProps[techField] || null;
  const jobTitle    = contactProps.jobtitle || null;

  const sizeResult  = scoreCompanySize(employees, config);
  const geoResult   = scoreGeography(country, config);
  const indResult   = scoreIndustry(industry, config);
  const migResult   = scoreMigration(sourceCloud, destCloud, config);
  const buyerResult = scoreBuyerFit(jobTitle, config);

  const breakdown = {
    companySize: sizeResult.score,
    geography:   geoResult.score,
    industry:    indResult.score,
    technology:  migResult.score,
    buyerFit:    buyerResult.score
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const cat   = getCategory(score, config);

  return {
    score,
    category:  cat.label,
    priority:  cat.priority,
    breakdown,
    reasons: {
      companySize: sizeResult.reason,
      geography:   geoResult.reason,
      industry:    indResult.reason,
      technology:  migResult.reason,
      buyerFit:    buyerResult.reason
    },
    inputs: { employees, country, industry, sourceCloud, destCloud, jobTitle }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Score an extracted lead (from file upload or HubSpot pull)
// ═══════════════════════════════════════════════════════════════════════════════

function scoreExtractedLead(lead, config) {
  const cfg = config || loadConfig();

  const sourceCloud = lead.sourceCloud || null;
  const destCloud   = lead.destinationCloud || lead.typeOfDestination || lead.techStack || null;

  const sizeResult  = scoreCompanySize(lead.numberOfEmployees, cfg);
  const geoResult   = scoreGeography(lead.country, cfg);
  const indResult   = scoreIndustry(lead.industry, cfg);
  const migResult   = scoreMigration(sourceCloud, destCloud, cfg);
  const buyerResult = scoreBuyerFit(lead.jobTitle, cfg);

  const breakdown = {
    companySize: sizeResult.score,
    geography:   geoResult.score,
    industry:    indResult.score,
    technology:  migResult.score,
    buyerFit:    buyerResult.score
  };

  const reasons = {
    companySize: sizeResult.reason,
    geography:   geoResult.reason,
    industry:    indResult.reason,
    technology:  migResult.reason,
    buyerFit:    buyerResult.reason
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const cat   = getCategory(score, cfg);

  return {
    ...lead,
    score,
    category:  cat.label,
    priority:  cat.priority,
    breakdown,
    reasons
  };
}

module.exports = {
  scoreContact,
  scoreExtractedLead,
  scoreCompanySize,
  scoreGeography,
  scoreIndustry,
  scoreTechnology,
  scoreMigration,
  scoreBuyerFit,
  getCategory,
  parseEmployeeCount
};
