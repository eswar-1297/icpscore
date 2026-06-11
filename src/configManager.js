'use strict';
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'scoring-config.json');

const DEFAULT_CONFIG = {
  companySize: [
    { label: '500+ employees',    minEmployees: 500, maxEmployees: null, score: 35 },
    { label: '250–499 employees', minEmployees: 250, maxEmployees: 499,  score: 25 },
    { label: '50–249 employees',  minEmployees: 50,  maxEmployees: 249,  score: 15 },
    { label: '1–49 employees',    minEmployees: 1,   maxEmployees: 49,   score: 5  }
  ],

  geography: {
    tier1: {
      score: 35,
      countries: [
        'United States', 'United States of America', 'US', 'USA', 'U.S.', 'U.S.A.', 'America',
        'United Kingdom', 'UK', 'GB', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales',
        'Canada', 'CA'
      ]
    },
    tier2: {
      score: 25,
      countries: [
        'India', 'IN',
        'Australia', 'AU',
        'Germany', 'DE', 'France', 'FR', 'Italy', 'IT', 'Spain', 'ES',
        'Netherlands', 'NL', 'Belgium', 'BE', 'Sweden', 'SE',
        'Norway', 'NO', 'Denmark', 'DK', 'Finland', 'FI',
        'Poland', 'PL', 'Czech Republic', 'CZ', 'Austria', 'AT',
        'Switzerland', 'CH', 'Portugal', 'PT', 'Ireland', 'IE',
        'Iceland', 'IS', 'Luxembourg', 'LU', 'Malta', 'MT',
        'Cyprus', 'CY', 'Greece', 'GR', 'Hungary', 'HU',
        'Romania', 'RO', 'Bulgaria', 'BG', 'Croatia', 'HR',
        'Slovakia', 'SK', 'Slovenia', 'SI', 'Estonia', 'EE',
        'Latvia', 'LV', 'Lithuania', 'LT',
        'Europe'
      ]
    },
    other: { score: 10 }
  },

  industry: {
    tier1: {
      score: 10,
      keywords: [
        'computer software', 'software', 'information technology',
        'it services', 'it consulting', 'software development',
        'technology', 'saas', 'internet',
        'computer & network security', 'computer and network security',
        'computer networking', 'network security', 'cybersecurity', 'cyber security',
        'computer hardware', 'semiconductors', 'telecommunications'
      ]
    },
    tier2: {
      score: 8,
      keywords: [
        'financial services', 'finance', 'banking', 'insurance',
        'marketing', 'advertising',
        'healthcare', 'hospital & health care', 'hospital and health care',
        'health care', 'medical', 'pharmaceuticals', 'pharma'
      ]
    },
    tier3: {
      score: 6,
      keywords: [
        'education', 'higher education', 'e-learning', 'elearning',
        'education management', 'primary/secondary education',
        'primary education', 'secondary education'
      ]
    },
    other: { score: 4 },
    none:  { score: 0 }
  },

  technology: {
    tier1: {
      score: 10,
      keywords: [
        'microsoft 365', 'office 365', 'o365', 'm365', 'microsoft',
        'onedrive', 'one drive', 'one drives',
        'sharepoint', 'share point', 'share points',
        'outlook', 'teams', 'microsoft teams',
        'ms teams', 'azure', 'office',
        'google workspace', 'g suite', 'gsuite', 'google', 'google drive',
        'google cloud', 'gmail', 'google docs', 'google sheets',
        'google chat', 'google files',
        'shared drive', 'shared drives', 'share drive', 'share drives'
      ]
    },
    tier2: {
      score: 8,
      keywords: [
        'dropbox', 'dropbox business',
        'box', 'box.com', 'box enterprise',
        'egnyte',
        'slack',
        'sharefile', 'share file', 'citrix sharefile'
      ]
    },
    tier3: { score: 5 },
    none:  { score: 0 }
  },

  buyerFit: {
    tier1: {
      score: 10,
      keywords: [
        'cio', 'cto', 'ceo', 'cfo', 'coo',
        'chief information officer', 'chief technology officer',
        'chief executive', 'chief financial officer', 'chief operating officer',
        'it director', 'director of it', 'head of it',
        'vp of it', 'vp it', 'vice president of it',
        'director of technology', 'head of technology', 'vp of technology'
      ]
    },
    tier2: {
      score: 7,
      keywords: [
        'it manager', 'it admin', 'it administrator',
        'system administrator', 'systems administrator', 'sysadmin',
        'network administrator', 'infrastructure manager',
        'it operations', 'it specialist'
      ]
    },
    tier3: {
      score: 5,
      keywords: [
        'consultant', 'consulting', 'advisor', 'freelance', 'project manager'
      ]
    },
    other: { score: 5 },
    none:  { score: 0 }
  },

  categories: [
    { label: 'Core ICP',     priority: 'Highest Priority', min: 80, max: 100 },
    { label: 'Strong ICP',   priority: 'High Priority',    min: 65, max: 79  },
    { label: 'Moderate ICP', priority: 'Nurture',          min: 50, max: 64  },
    { label: 'Non ICP',      priority: 'Low Priority',     min: 0,  max: 49  }
  ]
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (!cfg.industry?.none) cfg.industry.none = { score: 0 };
      if (!cfg.buyerFit?.none) cfg.buyerFit.none = { score: 0 };
      if (cfg.buyerFit?.other && cfg.buyerFit.other.score === 0) {
        cfg.buyerFit.other.score = 5;
      }
      return cfg;
    }
  } catch (e) {
    console.warn('[configManager] Failed to load config, using defaults:', e.message);
  }
  return deepClone(DEFAULT_CONFIG);
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function getDefaultConfig() {
  return deepClone(DEFAULT_CONFIG);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { loadConfig, saveConfig, getDefaultConfig };
