/* Canonical cloud-name normaliser — shared by the server (combinations grouping)
 * and the browser (column-filter dropdowns).  Collapses the many messy variants
 * in the HubSpot data ("Dropbox", "Drop box", "dropbox ", "Dropbox Business", …)
 * to a single canonical brand label.  Genuinely different products stay distinct
 * (Google Drive ≠ Google Workspace ≠ Google Chat; SharePoint ≠ SharePoint Online).
 * Unknown / rare values are returned trimmed & space-collapsed so at least
 * whitespace/case duplicates merge downstream. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.canonicalCloud = api.canonicalCloud;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  // Ordered [pattern, canonical] rules — first match wins, so list the more
  // specific products BEFORE their broader family.
  const RULES = [
    // Google family (specific → general)
    [/google\s*chat|google\s*chats|g-?chat|google chat and spaces/, 'Google Chat'],
    [/google\s*shared\s*drives?|google\s*sharedrive|google\s*share\s*drive/, 'Google Shared Drive'],
    [/google\s*my\s*drive/,                                                   'Google My Drive'],
    [/google\s*drive|googledrive|gdrive|\bg[\s-]*drive\b/,                     'Google Drive'],
    [/google\s*work\s*space|google\s*workspaces?|g[\s-]*suite|gsuite|\bgws\b/, 'Google Workspace'],

    // Microsoft family (specific → general)
    [/share\s*point\s*online|securisync/, 'SharePoint Online'],
    [/share\s*point/,                      'SharePoint'],
    [/one\s*drive/,                        'OneDrive'],
    [/\b(ms|microsoft)\s*teams\b|\bteams\b/, 'Microsoft Teams'],
    [/microsoft\s*365|\bms\s*365\b|\bm365\b|office\s*365|\bo365\b|\bgcc\b/, 'Microsoft 365'],
    [/outlook/,  'Outlook'],
    [/exchange/, 'Exchange'],

    // File-storage vendors — Dropbox BEFORE Box (so "Dropbox" isn't caught by /box/)
    [/drop\s*box/, 'Dropbox'],
    [/\bbox\b/,    'Box'],
    [/eg[ny]{2}te/, 'Egnyte'],
    [/share\s*file|citrix/, 'ShareFile'],

    // Collaboration / mail / other majors
    [/slack/,               'Slack'],
    [/gmail/,               'Gmail'],
    [/amazon\s*s3|amazone\s*s3|aws\s*s3|s3\s*bucket/, 'Amazon S3'],
    [/azure/,               'Azure'],
    [/wasabi/,              'Wasabi'],
    [/next\s*cloud/,        'Nextcloud'],
    [/icloud/,              'iCloud'],
    [/zoho/,                'Zoho'],
  ];

  function canonicalCloud(raw) {
    if (raw == null) return '';
    const s = String(raw).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const low = s.toLowerCase();
    // Not-applicable / empty markers
    if (/^(n\s*[/\\]?\s*a|na|none|unknown|-|—)$/.test(low)) return low === 'unknown' ? 'Unknown' : 'N/A';
    for (const [re, canon] of RULES) if (re.test(low)) return canon;
    return s;   // unrecognised → trimmed original (case-insensitive dedup handles the rest)
  }

  return { canonicalCloud };
});
