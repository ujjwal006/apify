# 🎬 Video Editor Lead Generation Engine

An Apify Actor that autonomously finds businesses that need video editing services, using a **3-phase scraping pipeline** backed by PlaywrightCrawler and residential proxy rotation.

---

## How It Works

### Phase 1 — Discovery
Seeds the request queue with **Google Maps** and **Google Search** URLs for the given `niche` + `location`. Extracts business listings (name, address, Maps URL, website) and enqueues them for deeper enrichment.

### Phase 2 — Enrichment
- **Maps Detail Pages** → extracts phone, website, category
- **Business Websites** → extracts emails (regex), phone numbers, and all social profile links

### Phase 3 — Intent Analysis
Visits **Instagram / YouTube / TikTok** profiles and scores each business against intent signals:

| Signal | Meaning |
|---|---|
| `NO_VIDEO_ON_WEBSITE` | No `<video>` or embed found on site |
| `OLD_YOUTUBE_UPLOAD_DATES` | Videos mostly from 2019–2021 |
| `LOW_YOUTUBE_VIDEO_COUNT_N` | Fewer than 10 videos |
| `NO_INSTAGRAM_REELS` | Profile page has no Reels section |
| `SHORT_OR_NO_CAPTIONS_ON_REELS` | Very short aria-labels (no real captions) |
| `LOW_INSTAGRAM_FOLLOWERS_N` | Under 2,000 followers |
| `INFREQUENT_INSTAGRAM_POSTING` | Lots of "weeks/months ago" timestamps |
| `NO_YOUTUBE_SHORTS` | Channel has no Shorts |
| `DIY_VIDEO_MENTIONS` | Text mentions "phone camera", "DIY video" |
| `PLACEHOLDER_CONTENT` | Lorem ipsum detected |

---

## Scoring

### `intentScore` (0–100)
Each detected intent signal adds **+10 points** (capped at 100).  
A high score means the business shows many signs of needing professional video help.

### `contactScore` (0–100)
Composite reachability score:

| Factor | Points |
|---|---|
| Has email address | +30 |
| Has phone number | +10 |
| Has Instagram | +10 |
| Has LinkedIn | +10 |
| Has YouTube | +5 |
| Has TikTok | +5 |
| Has a website | +10 |
| Maps listing only | −5 |
| Intent signals (up to +20) | +4×signals |

---

## Input

```json
{
  "niche": "Real Estate Agents",
  "location": "Pune, India",
  "maxLeads": 20,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Output (per lead)

```json
{
  "businessName": "Sunshine Realty",
  "website": "https://sunshinerealty.in",
  "mapsUrl": "https://www.google.com/maps/place/...",
  "emails": ["contact@sunshinerealty.in"],
  "phone": "+91 98765 43210",
  "address": "FC Road, Pune, Maharashtra",
  "location": "Pune, India",
  "category": "Real estate agency",
  "socialLinks": {
    "instagram": "https://instagram.com/sunshinerealty",
    "linkedin":  "https://linkedin.com/company/sunshinerealty"
  },
  "intentSignals": [
    "NO_VIDEO_ON_WEBSITE",
    "NO_INSTAGRAM_REELS",
    "LOW_INSTAGRAM_FOLLOWERS_412"
  ],
  "intentScore": 30,
  "contactScore": 75,
  "source": "google_maps+website",
  "scrapedAt": "2024-11-01T12:34:56.789Z"
}
```

---

## Local Development

```bash
npm install
npx playwright install chromium
# create a local INPUT.json then:
npm run dev
```

## Deploy to Apify

```bash
apify push
```
