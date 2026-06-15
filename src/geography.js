'use strict';

// ─── Country canonicalisation ────────────────────────────────────────────────
// Collapses country/region/city variants (abbreviations, ISO codes, sub-national
// states/provinces, and major cities) into a single canonical country name, so
// "US", "USA", "California", "Austin", "Calabasas, CA" all map to "United States".

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents (México → mexico)
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalised variant → canonical country name
const ALIASES = {
  'us': 'United States', 'usa': 'United States', 'u s': 'United States', 'u s a': 'United States',
  'united states': 'United States', 'united states of america': 'United States',
  'america': 'United States', 'states': 'United States', 'us of a': 'United States',
  'uk': 'United Kingdom', 'gb': 'United Kingdom', 'gbr': 'United Kingdom',
  'great britain': 'United Kingdom', 'united kingdom': 'United Kingdom', 'britain': 'United Kingdom',
  'england': 'United Kingdom', 'scotland': 'United Kingdom', 'wales': 'United Kingdom', 'northern ireland': 'United Kingdom',
  'ca': 'Canada', 'can': 'Canada', 'canada': 'Canada',
  'au': 'Australia', 'aus': 'Australia', 'australia': 'Australia',
  'in': 'India', 'ind': 'India', 'india': 'India', 'bharat': 'India',
  'de': 'Germany', 'deu': 'Germany', 'germany': 'Germany', 'deutschland': 'Germany',
  'fr': 'France', 'fra': 'France', 'france': 'France',
  'es': 'Spain', 'esp': 'Spain', 'spain': 'Spain',
  'it': 'Italy', 'ita': 'Italy', 'italy': 'Italy',
  'nl': 'Netherlands', 'nld': 'Netherlands', 'netherlands': 'Netherlands', 'the netherlands': 'Netherlands', 'holland': 'Netherlands',
  'be': 'Belgium', 'belgium': 'Belgium',
  'se': 'Sweden', 'sweden': 'Sweden',
  'no': 'Norway', 'norway': 'Norway',
  'dk': 'Denmark', 'denmark': 'Denmark',
  'fi': 'Finland', 'finland': 'Finland',
  'pl': 'Poland', 'poland': 'Poland',
  'cz': 'Czech Republic', 'czechia': 'Czech Republic', 'czech republic': 'Czech Republic',
  'at': 'Austria', 'austria': 'Austria',
  'ch': 'Switzerland', 'switzerland': 'Switzerland',
  'pt': 'Portugal', 'portugal': 'Portugal',
  'gr': 'Greece', 'greece': 'Greece',
  'ie': 'Ireland', 'ireland': 'Ireland', 'republic of ireland': 'Ireland',
  'ro': 'Romania', 'romania': 'Romania',
  'hu': 'Hungary', 'hungary': 'Hungary',
  'ae': 'United Arab Emirates', 'uae': 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
  'sa': 'Saudi Arabia', 'saudi arabia': 'Saudi Arabia', 'ksa': 'Saudi Arabia',
  'sg': 'Singapore', 'singapore': 'Singapore',
  'jp': 'Japan', 'japan': 'Japan',
  'cn': 'China', 'china': 'China',
  'br': 'Brazil', 'brazil': 'Brazil',
  'mx': 'Mexico', 'mexico': 'Mexico',
  'za': 'South Africa', 'south africa': 'South Africa',
  'nz': 'New Zealand', 'new zealand': 'New Zealand',
  'il': 'Israel', 'israel': 'Israel',
  'ph': 'Philippines', 'philippines': 'Philippines',
  'my': 'Malaysia', 'malaysia': 'Malaysia',
  'id': 'Indonesia', 'indonesia': 'Indonesia',
  'co': 'Colombia', 'colombia': 'Colombia',
  'eg': 'Egypt', 'egypt': 'Egypt',
  'hk': 'Hong Kong', 'hong kong': 'Hong Kong',
};

// Sub-national region / city → country.
const SUB_TO_COUNTRY = {};
function add(country, names) { names.forEach(n => { SUB_TO_COUNTRY[norm(n)] = country; }); }

add('United States', [
  // states + DC + territories
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware',
  'florida','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana',
  'maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana',
  'nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina',
  'south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
  'wisconsin','wyoming','washington dc','district of columbia','puerto rico','guam',
  // major cities
  'new york city','nyc','los angeles','chicago','houston','phoenix','philadelphia','san antonio',
  'san diego','dallas','san jose','austin','jacksonville','san francisco','columbus','charlotte',
  'fort worth','indianapolis','seattle','denver','boston','nashville','portland','las vegas',
  'memphis','louisville','baltimore','milwaukee','albuquerque','tucson','sacramento','atlanta',
  'kansas city','miami','raleigh','minneapolis','tampa','new orleans','pittsburgh','cincinnati',
  'sunnyvale','calabasas','westlake village','newberg','le sueur','west palm beach','dayton',
]);

add('Canada', [
  'ontario','quebec','british columbia','alberta','manitoba','saskatchewan','nova scotia',
  'new brunswick','newfoundland and labrador','newfoundland','prince edward island',
  'northwest territories','yukon','nunavut',
  'toronto','montreal','vancouver','calgary','ottawa','quebec city','edmonton','winnipeg',
]);

add('Australia', [
  'new south wales','nsw','queensland','qld','western australia','south australia',
  'tasmania','northern territory','australian capital territory','act',
  'sydney','melbourne','brisbane','perth','adelaide','canberra',
]);

add('India', [
  'maharashtra','karnataka','tamil nadu','delhi','new delhi','gujarat','telangana',
  'west bengal','rajasthan','uttar pradesh','madhya pradesh','kerala','andhra pradesh',
  'punjab','haryana','bihar','odisha','jharkhand','chhattisgarh','assam','uttarakhand',
  'himachal pradesh','goa',
  'mumbai','bangalore','bengaluru','chennai','hyderabad','pune','kolkata','ahmedabad',
  'noida','gurugram','gurgaon','jaipur',
]);

add('United Kingdom', ['london','manchester','birmingham','edinburgh','glasgow','liverpool','bristol','leeds','cardiff','belfast','hove','brighton']);
add('Germany', ['berlin','munich','munchen','frankfurt','hamburg','stuttgart','cologne','dusseldorf','bavaria','bayern','nordrhein westfalen','north rhine westphalia','hessen']);
add('France', ['paris','lyon','marseille','toulouse','nice','bordeaux','lille','brittany','normandy','chatillon','guadeloupe']);
add('Netherlands', ['amsterdam','rotterdam','the hague','utrecht','eindhoven','veghel']);
add('Ireland', ['dublin','cork','galway']);
add('Portugal', ['lisbon','porto','braga']);
add('Spain', ['madrid','barcelona','valencia','seville','malaga']);
add('Italy', ['milan','rome','naples','turin','florence','venice','bologna']);
add('Egypt', ['cairo']);
add('Japan', ['tokyo','osaka']);
add('Indonesia', ['jakarta']);
add('Colombia', ['bogota','cundinamarca']);
add('Mexico', ['mexico city','cdmx','ciudad de mexico']);
add('South Africa', ['gauteng','johannesburg','cape town']);
add('Finland', ['helsinki','uusimaa','espoo','tampere']);
add('Cyprus', ['limassol','nicosia']);
add('Belgium', ['brussels','antwerp','ghent']);
add('Romania', ['bucharest','cluj']);
add('United Arab Emirates', ['dubai','abu dhabi','sharjah']);
add('Cayman Islands', ['cayman']);
add('Turkey', ['istanbul','ankara']);
add('Greece', ['athens','thessaloniki']);
add('Israel', ['tel aviv','jerusalem','haifa']);
add('Brazil', ['sao paulo','rio de janeiro']);
add('China', ['beijing','shanghai','shenzhen']);
add('Czech Republic', ['prague','brno']);
add('Poland', ['warsaw','krakow']);
add('Austria', ['vienna']);
add('Switzerland', ['zurich','geneva']);

// US state two-letter abbreviations (used for "City, ST" and bare-code matching).
const US_STATE_ABBR = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la',
  'me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok',
  'or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc',
]);

/** Return the canonical country for a raw country/state/city value, or the
 *  trimmed original (unchanged) when it isn't recognised. */
function canonicalCountry(raw) {
  const v = norm(raw);
  if (!v) return null;
  if (ALIASES[v])        return ALIASES[v];
  if (SUB_TO_COUNTRY[v]) return SUB_TO_COUNTRY[v];

  // "City, ST" / "City, State, Country" — inspect each comma-separated segment
  if (v.includes(',')) {
    const parts = v.split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (ALIASES[part])        return ALIASES[part];
      if (SUB_TO_COUNTRY[part])  return SUB_TO_COUNTRY[part];
      if (US_STATE_ABBR.has(part)) return 'United States';
    }
  }

  // Bare US state code (e.g. "NY", "TX") — but ISO country codes in ALIASES win above
  if (US_STATE_ABBR.has(v)) return 'United States';

  return String(raw).trim();
}

module.exports = { canonicalCountry };
