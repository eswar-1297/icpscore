'use strict';

const XLSX = require('xlsx');
const { parseEmployeeCount } = require('./scoring');

// ── Column name aliases → standard lead field mapping ────────────────────────
const FIELD_ALIASES = {
  name:              ['name', 'full name', 'fullname', 'contact name', 'contact', 'lead name', 'person name', 'contact person'],
  email:             ['email', 'email address', 'e-mail', 'emailaddress', 'mail', 'email id', 'emailid', 'person email', 'contact email', 'work email', 'business email', 'corporate email', 'primary email'],
  firstName:         ['first name', 'firstname', 'fname', 'given name'],
  lastName:          ['last name', 'lastname', 'lname', 'surname', 'family name'],
  jobTitle:          ['job title', 'jobtitle', 'title', 'role', 'position', 'designation', 'job role', 'person title', 'contact title'],
  companyName:       ['company', 'company name', 'companyname', 'organisation', 'organization', 'org', 'account', 'account name', 'firm', 'business name', 'employer', 'company  name'],
  numberOfEmployees: ['employee count', 'employees', 'number of employees', 'numberofemployees', 'company size', 'headcount', 'num employees', 'no of employees', 'employee size', 'team size', 'staff count', 'of employees', 'size'],
  country:           ['country', 'countryregion', 'country region', 'geography', 'location', 'region', 'geo', 'nation', 'person country', 'company country', 'hq country'],
  selectCountry:     ['select country', 'selected country'],
  industry:          ['industry', 'sector', 'vertical', 'business type', 'company industry'],
  sourceCloud:       ['source', 'sourcecloud', 'source cloud', 'source platform', 'migration source', 'current platform', 'from'],
  sourceDestination: ['source destination', 'sourcedestination'],
  destinationCloud:  ['destination', 'destinationcloud', 'destination cloud', 'destination platform', 'target', 'dest'],
  typeOfDestination: ['type of destination', 'typeofdestination', 'type of destination cloud'],
  techStack:         ['tech stack', 'techstack', 'technology', 'technologies', 'tools', 'software', 'tech'],
  sizeOfBusiness:    ['size of business', 'sob', 'business size', 'segment', 'account type'],
  phone:             ['phone', 'phone number', 'phonenumber', 'telephone', 'tel', 'mobile', 'cell', 'direct phone', 'work phone', 'contact number', 'mobile number', 'phone no'],
  leadStatus:        ['lead status', 'leadstatus', 'status', 'stage'],
  linkedinUrl:       ['linkedin', 'linkedin url', 'linkedin profile', 'person linkedin url', 'linkedin link'],
  website:           ['website', 'domain', 'company domain', 'url', 'web', 'company website', 'website url'],
  createdDate:       ['created date', 'createddate', 'create date', 'date created', 'date', 'created at', 'createdat', 'creation date', 'created', 'lead date', 'date added', 'added date', 'signup date', 'registered date']
};

/**
 * Normalise a header string for matching.
 * Collapses whitespace, strips non-alphanumeric (except spaces), lowercases.
 */
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Check if a header matches a field by:
 * 1. Exact alias match
 * 2. Header contains an alias as substring
 * 3. Alias contains the header as substring (min 5 chars)
 */
function findFieldMatch(headerNorm) {
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(headerNorm)) return field;
  }

  if (headerNorm.length >= 3) {
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      for (const alias of aliases) {
        if (headerNorm.includes(alias) || (alias.length >= 5 && alias.includes(headerNorm))) {
          return field;
        }
      }
    }
  }

  if (headerNorm.includes('email') || headerNorm.includes('mail')) return 'email';
  if (headerNorm.includes('phone') || headerNorm.includes('mobile')) return 'phone';
  if (headerNorm.includes('company') || headerNorm.includes('organization')) return 'companyName';
  if (headerNorm.includes('country')) return 'country';
  if (headerNorm.includes('industry')) return 'industry';
  if (headerNorm.includes('employee')) return 'numberOfEmployees';
  if (headerNorm.includes('linkedin')) return 'linkedinUrl';
  if (headerNorm.includes('title') && !headerNorm.includes('company')) return 'jobTitle';
  if (headerNorm.includes('date') || headerNorm.includes('created')) return 'createdDate';

  return null;
}

/**
 * Build a map: { actualColumnHeader → leadFieldName }
 */
function buildColumnMap(headers) {
  const map = {};
  const usedFields = new Set();

  for (const header of headers) {
    const h = norm(header);
    const field = findFieldMatch(h);
    if (field && !usedFields.has(field)) {
      map[header] = field;
      usedFields.add(field);
    }
  }

  console.log('[fileParser] Column mapping:', JSON.stringify(map, null, 2));
  console.log('[fileParser] Unmapped headers:', headers.filter(h => !map[h]));

  return map;
}

/**
 * If there's no 'name' column but there are first/last name columns, merge them.
 */
function handleNameColumns(headers, rows) {
  const hn = headers.map(norm);
  const firstIdx = hn.findIndex(h => ['first name', 'firstname', 'first', 'fname', 'given name'].includes(h));
  const lastIdx  = hn.findIndex(h => ['last name', 'lastname', 'last', 'surname', 'family name', 'lname'].includes(h));

  if (firstIdx === -1 && lastIdx === -1) return;

  const nameIdx = hn.findIndex(h => FIELD_ALIASES.name.includes(h));
  if (nameIdx !== -1) return;

  headers.push('name');
  for (const row of rows) {
    const first = (row[headers[firstIdx]] || '').toString().trim();
    const last  = (row[headers[lastIdx]]  || '').toString().trim();
    row['name'] = `${first} ${last}`.trim();
  }
}

/**
 * Parse a CSV / XLS / XLSX buffer and return an array of lead objects.
 */
function parseLeadsFile(buffer, filename = 'file.csv') {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    codepage: 65001
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The file contains no sheets.');

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rawRows.length) throw new Error('The file is empty — no data rows found.');

  const headers = Object.keys(rawRows[0]);

  handleNameColumns(headers, rawRows);

  const colMap = buildColumnMap(headers);

  const mappedFields = new Set(Object.values(colMap));
  if (!mappedFields.has('email') && !mappedFields.has('name')) {
    throw new Error(
      'Could not identify an "Email" or "Name" column in your file. ' +
      'Please ensure your headers include at least one of: ' +
      FIELD_ALIASES.email.concat(FIELD_ALIASES.name).join(', ')
    );
  }

  const leads = rawRows.map((row, rowIdx) => {
    const lead = { _rowIndex: rowIdx + 2 };
    for (const [colHeader, fieldName] of Object.entries(colMap)) {
      let val = row[colHeader];
      if (val === undefined || val === null) val = '';

      if (fieldName === 'numberOfEmployees') {
        lead[fieldName] = parseEmployeeCount(val);
      } else if (fieldName === 'createdDate') {
        let rawVal = row[colHeader];
        if (rawVal instanceof Date && !isNaN(rawVal)) {
          lead[fieldName] = rawVal.toISOString().split('T')[0];
        } else {
          val = String(val).trim();
          if (val) {
            const d = new Date(val);
            lead[fieldName] = (!isNaN(d)) ? d.toISOString().split('T')[0] : val;
          } else {
            lead[fieldName] = null;
          }
        }
      } else {
        val = String(val).trim();
        lead[fieldName] = val || null;
      }
    }

    // Country: selectCountry takes priority over country (matches HubSpot behavior)
    if (lead.selectCountry) {
      lead.country = lead.selectCountry;
    }
    delete lead.selectCountry;

    // Source cloud fallback: sourceCloud || sourceDestination (matches HubSpot fallback)
    if (!lead.sourceCloud && lead.sourceDestination) {
      lead.sourceCloud = lead.sourceDestination;
    }
    delete lead.sourceDestination;

    // Destination cloud fallback: destinationCloud || typeOfDestination (matches HubSpot fallback)
    if (!lead.destinationCloud && lead.typeOfDestination) {
      lead.destinationCloud = lead.typeOfDestination;
    }
    delete lead.typeOfDestination;

    // Merge firstName + lastName into name if we have them
    if (!lead.name && (lead.firstName || lead.lastName)) {
      lead.name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
    }
    delete lead.firstName;
    delete lead.lastName;

    return lead;
  });

  const validLeads = leads.filter(l =>
    l.email || l.name || l.companyName || l.jobTitle
  );

  if (!validLeads.length) {
    throw new Error('No valid leads found in the file. All rows appear to be empty.');
  }

  return validLeads;
}

module.exports = { parseLeadsFile };
