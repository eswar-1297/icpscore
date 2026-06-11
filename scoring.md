# CloudFuze ICP Lead Scoring — Complete Documentation

**Version:** 1.0  
**Last Updated:** March 2026  
**Total Maximum Score:** 100 points

---

## 1. Overview

The CloudFuze ICP (Ideal Customer Profile) scoring system evaluates leads across **5 attributes** to produce a total score out of 100. Each lead is then classified into a priority category based on their total score.

### Score Breakdown

| # | Attribute | Max Score | Weight |
|---|-----------|-----------|--------|
| 1 | Company Size (Employee Count) | 35 | 35% |
| 2 | Geography (Country/Region) | 35 | 35% |
| 3 | Industry / Sector | 10 | 10% |
| 4 | Migration Platform (Source → Destination) | 10 | 10% |
| 5 | Buyer Fit (Job Title / Role) | 10 | 10% |
| | **Total** | **100** | **100%** |

### ICP Categories

| Total Score | Category | Priority |
|-------------|----------|----------|
| 80 – 100 | **Core ICP** | Highest |
| 65 – 79 | **Strong ICP** | High |
| 50 – 64 | **Moderate ICP** | Nurture |
| 0 – 49 | **Non-ICP** | Low |

---

## 2. Attribute 1: Company Size (0–35 points)

**Source field:** `Employee Count`, `Employees`, `Company Size`, `Headcount`

| Employee Count | Score | Rationale |
|----------------|-------|-----------|
| 500+ | **35** | Enterprise-scale, highest migration value |
| 250 – 499 | **25** | Mid-to-large company |
| 50 – 249 | **15** | Mid-market |
| 1 – 49 | **5** | Small business |
| Unknown / Empty | **0** | Cannot assess |

### Special Handling for Employee Count Data

| Excel Value | Parsed As | Explanation |
|-------------|-----------|-------------|
| `500` | 500 | Direct number |
| `1,000` | 1000 | Commas removed |
| `5K` or `5k` | 5000 | K = thousands |
| `1.5K` | 1500 | Decimal K notation |
| `2M` | 2000000 | M = millions |
| `200-500` | **500** | Range → takes HIGHEST value |
| `500-1k` | **1000** | Range with K notation |
| `1k-5k` | **5000** | Range with K notation |
| `500+` | 500 | Plus notation |
| `10-Feb` (date) | **10** | Excel auto-converted "2-10" to date → extracts month=2, day=10 → takes max = 10 |
| `5-Jan` (date) | **5** | Excel auto-converted "1-5" to date → extracts 5 |
| `N/A`, `Unknown`, empty | null → **0** | Scores 0 |

---

## 3. Attribute 2: Geography (0–35 points)

**Source fields:** `Country/Region`, `Select Country`, `Country`, `Geography`, `Region`, `Location`

If both "Country/Region" and "Select Country" columns exist, the system uses "Country/Region" first; if empty, falls back to "Select Country".

### Tier 1 — Score: 35

**Countries:** United States (USA), United Kingdom (UK/GB), Canada

**Also recognized:**
- All 50 US states by full name (California, Texas, New York, etc.)
- US major cities (New York City, Los Angeles, Chicago, San Francisco, Seattle, etc.)
- Washington DC, Puerto Rico, Guam, US Virgin Islands
- UK nations (England, Scotland, Wales, Northern Ireland)
- UK cities (London, Manchester, Birmingham, Edinburgh, Glasgow, etc.)
- Canadian provinces (Ontario, British Columbia, Alberta, Quebec, etc.)
- Canadian cities (Toronto, Montreal, Vancouver, Calgary, Ottawa, etc.)

### Tier 2 — Score: 25

**Countries:** India, Australia, and European countries

**India** — all states and major cities recognized:
- States: Maharashtra, Karnataka, Tamil Nadu, Delhi, Gujarat, Telangana, etc.
- Cities: Mumbai, Bangalore/Bengaluru, Chennai, Hyderabad, Pune, Kolkata, Noida, Gurugram, etc.

**Australia** — all states and major cities recognized:
- States: New South Wales, Victoria, Queensland, etc.
- Cities: Sydney, Melbourne, Brisbane, Perth, Adelaide, Canberra, etc.

**European countries and their states/cities:**
- Germany (Bavaria, Berlin, Munich, Frankfurt, etc.)
- France (Paris, Lyon, Marseille, etc.)
- Italy (Milan, Rome, etc.)
- Spain (Madrid, Barcelona, etc.)
- Netherlands (Amsterdam, Rotterdam, etc.)
- Switzerland (Zurich, Geneva, etc.)
- Ireland (Dublin, Cork, etc.)
- Sweden, Norway, Denmark, Finland, Belgium, Austria, Portugal, Poland, Czech Republic
- Generic: "Europe"

### Tier 3 (Other) — Score: 10

Any country/region detected but not in Tier 1 or Tier 2 (e.g., Japan, Brazil, China, Mexico, South Korea, etc.)

### Not Detected — Score: 0

Country field is empty or missing.

### Important Notes

- Matching is **case-insensitive** ("california" = "California" = "CALIFORNIA")
- **No ambiguous 2-letter US state abbreviations** are used (e.g., "IN" maps to India, not Indiana; "DE" maps to Germany, not Delaware)
- ISO 2-letter country codes are supported: US, GB, IN, AU, DE, FR, IT, ES, NL, etc.

---

## 4. Attribute 3: Industry (0–10 points)

**Source field:** `Industry`, `Sector`, `Company Industry`, `Vertical`

| Tier | Score | Industries |
|------|-------|------------|
| **Tier 1 — IT/Software** | **10** | Computer Software, Information Technology, IT Services, Computer & Network Security, IT Consulting, Software Development, Technology, SaaS, Internet |
| **Tier 2 — Finance/Marketing/Healthcare** | **8** | Financial Services, Banking, Insurance, Marketing, Advertising, Healthcare, Hospital & Health Care, Medical, Pharmaceuticals |
| **Tier 3 — Education** | **6** | Education, Higher Education, E-Learning, Education Management, Primary/Secondary Education |
| **Other (detected)** | **4** | Industry detected but doesn't match any tier (e.g., Retail, Manufacturing, Construction) |
| **Not detected** | **0** | Industry field is empty or missing |

- Matching is **case-insensitive** and uses **substring matching** (e.g., "information technology and services" matches "information technology")

---

## 5. Attribute 4: Migration Platform (0–10 points)

**Source fields:** `Source_Cloud` / `Destination_Cloud`, `Source` / `Destination`, `Source Platform` / `Destination Platform`, `From` / `To`

### Recognized Platforms

**Main Platforms (Google/Microsoft family):**
- Microsoft 365, Office 365, O365, M365, Microsoft, OneDrive, SharePoint, Outlook, Teams, Microsoft Teams, MS Teams, Azure, Office
- Google Workspace, G Suite, Google, Google Drive, Google Cloud, Gmail, Google Docs, Google Sheets

**Secondary Platforms:**
- Dropbox, Dropbox Business
- Box, Box.com, Box Enterprise
- Egnyte
- Slack
- ShareFile, Citrix ShareFile

### Scoring Rules

| Condition | Score | Example |
|-----------|-------|---------|
| **Either** source OR destination is Google/Microsoft | **10** | Source: Google Workspace, Dest: Dropbox → 10 (source is main) |
| **Either** source OR destination is Dropbox/Box/Egnyte/Slack/ShareFile (and neither is Google/Microsoft) | **8** | Source: Dropbox, Dest: Box → 8 |
| One or both fields not provided | **5** | Source: empty, Dest: empty → 5 |
| Both provided but **neither** is a supported platform | **0** | Source: Zoho, Dest: Notion → 0 |

### Priority Order
1. Main platforms (Google/Microsoft) are checked FIRST — if either source or destination is a main platform, score is 10 regardless of the other field
2. Secondary platforms checked next
3. If fields are missing → 5
4. If both are unsupported → 0

---

## 6. Attribute 5: Buyer Fit (0–10 points)

**Source field:** `Title`, `Job Title`, `Role`, `Designation`, `Position`

### Tier 1 — C-Level / IT Leadership — Score: 10

| Keywords matched (whole-word boundary) |
|----------------------------------------|
| CIO, CTO, CEO, **CFO**, **COO** |
| Chief Information Officer, Chief Technology Officer, Chief Executive |
| **Chief Financial Officer**, **Chief Operating Officer** |
| IT Director, Director of IT, Head of IT |
| VP of IT, Vice President of IT, VP IT |
| Director of Technology, Head of Technology, VP of Technology |

### Tier 2 — IT Managers / Admins — Score: 7

| Keywords matched |
|------------------|
| IT Manager, IT Admin, IT Administrator |
| System Administrator, Systems Administrator, Sysadmin |
| Network Administrator, Infrastructure Manager, IT Operations |
| **IT Specialist** |

### Tier 3 — Consultants — Score: 5

| Keywords matched |
|------------------|
| Consultant, Consulting, Advisor, Freelance, Project Manager |

### Non-IT Roles — Score: 5

Any title that doesn't match the above keywords (e.g., Marketing Director, Sales Rep, HR Manager, Account Executive).

### No Title — Score: 0

Title field is empty or missing.

### Important Notes

- **Whole-word matching** is used to prevent false positives (e.g., "Marketing Director" does NOT match "CTO" even though "director" contains "cto" as substring)
- Matching is case-insensitive

---

## 7. Excel Input Requirements

### Required/Expected Columns

The system uses **flexible column name matching** — it recognizes multiple common variations of each column header:

| Field | Recognized Column Names |
|-------|------------------------|
| Email | Email, Email Address, E-mail, Mail |
| First Name | First Name, FirstName, FName, Given Name |
| Last Name | Last Name, LastName, LName, Surname, Family Name |
| Company | Company, Company Name, Organization, Org |
| Job Title | Title, Job Title, Role, Designation, Position |
| Industry | Industry, Sector, Company Industry, Vertical |
| Country (primary) | Country, Country/Region, Geography, Location, Region, Geo |
| Country (fallback) | Select Country, Selected Country |
| Employee Count | Employee Count, Employees, Company Size, Size, Headcount, Number of Employees |
| Source Platform | Source, Source_Cloud, Source Cloud, Source Platform, From, Migration Source, Current Platform |
| Destination Platform | Destination, Destination_Cloud, Destination Cloud, Destination Platform, To, Target, Dest |
| Size of Business | Size of Business, SOB, Business Size, Segment, Account Type |

### Notes
- Column matching is **case-insensitive**
- Only the **first sheet** of the Excel file is processed
- If a column is not found, that attribute scores **0** (or **5** for migration if nothing provided)
- The **Size of Business (SOB)** column is NOT scored — it is used only for grouping leads into separate sheets

---

## 8. Output Excel Structure

The downloaded scored file contains the following sheets:

| Sheet Name | Contents |
|------------|----------|
| **All Scored Leads** | All leads with original data + ICP scores, sorted by total score (highest first) |
| **Summary** | Overall summary (Core/Strong/Moderate/Non-ICP counts) + per-SOB group breakdown + scoring rules reference |
| **SOB - SMB** | Leads where Size of Business = SMB |
| **SOB - Large MSP** | Leads where Size of Business = Large MSP |
| **SOB - MSP** | Leads where Size of Business = MSP |
| **SOB - Enterprise** | Leads where Size of Business = Enterprise |
| **SOB - Unassigned** | Leads where Size of Business is empty |
| **Errors** | (Only if errors occurred) Row numbers and error messages |

### Output Columns Added to Each Lead

| Column | Description |
|--------|-------------|
| ICP Total Score | Sum of all 5 attribute scores (0–100) |
| ICP Category | Core ICP / Strong ICP / Moderate ICP / Non-ICP |
| ICP Priority | Highest / High / Nurture / Low |
| Company Size Score | Individual score (0–35) |
| Company Size Reason | Explanation of how the score was determined |
| Geography Score | Individual score (0–35) |
| Geography Reason | Explanation |
| Industry Score | Individual score (0–10) |
| Industry Reason | Explanation |
| Migration Score | Individual score (0–10) |
| Migration Reason | Explanation |
| Buyer Fit Score | Individual score (0–10) |
| Buyer Fit Reason | Explanation |

---

## 9. Scoring Examples

### Example 1: Core ICP Lead (Score: 100)
| Attribute | Value | Score |
|-----------|-------|-------|
| Employee Count | 600 | 35 |
| Country | United States | 35 |
| Industry | Computer Software | 10 |
| Source → Destination | Microsoft 365 → Google Workspace | 10 |
| Title | CIO | 10 |
| **Total** | | **100 → Core ICP** |

### Example 2: Strong ICP Lead (Score: 65)
| Attribute | Value | Score |
|-----------|-------|-------|
| Employee Count | 150 | 15 |
| Country | Mumbai | 25 |
| Industry | Banking | 8 |
| Source → Destination | Google Workspace → Dropbox | 10 |
| Title | IT Manager | 7 |
| **Total** | | **65 → Strong ICP** |

### Example 3: Non-ICP Lead (Score: 19)
| Attribute | Value | Score |
|-----------|-------|-------|
| Employee Count | (empty) | 0 |
| Country | (empty) | 0 |
| Industry | (empty) | 0 |
| Source → Destination | (empty) → (empty) | 5 |
| Title | (empty) | 0 |
| **Total** | | **5 → Non-ICP** |

---

## 10. Things to Take Care Of

### Data Quality
1. **Employee count as dates** — If you type "2-10" in Excel, it auto-converts to "10-Feb". The system handles this, but it's best to format the Employee Count column as **Text** in Excel before entering data.
2. **Country field** — Use full country/state/city names for best accuracy. Avoid 2-letter abbreviations for states (use "California" not "CA").
3. **Two country columns** — If your Excel has both "Country/Region" and "Select Country", the system checks "Country/Region" first, then falls back to "Select Country".
4. **Migration platforms** — Must contain recognizable platform names. "Google" or "Microsoft" alone will work. Custom/internal platform names will score 0.
5. **Job titles** — The more specific the title, the better the match. "IT Director" scores 10, but "Director" alone scores 5 (Non-IT).

### Column Names
6. **Flexible matching** — Column headers are matched case-insensitively. "EMPLOYEE COUNT", "employee count", and "Employee Count" all work.
7. **Unmapped columns** — If a column isn't recognized, it simply won't be scored (defaults to 0 or 5 for migration).
8. **SOB column** — Only used for grouping, never affects the ICP score.

### Scoring Logic
9. **No double-counting** — Each attribute is scored independently. Geography only looks at country, not industry or title.
10. **Migration: main platforms trump secondary** — If source is "Google Workspace" and destination is "Dropbox", score is 10 (because source is a main platform), not 8.
11. **Buyer Fit: whole-word matching** — "Marketing Director" does NOT accidentally match "CTO" (fixed to use word boundaries).
12. **Industry: substring matching** — "Information Technology and Services" matches the keyword "information technology".

---

*Document generated for CloudFuze ICP Lead Scoring Tool*
