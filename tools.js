/**
 * tools.js — Helper utilities for the Video Editor Lead Generation Engine
 * Handles: URL building, regex extraction, intent analysis, scoring
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const EMAIL_REGEX =
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,7}\b/g;

const PHONE_REGEX =
  /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;

const SOCIAL_PATTERNS = {
  instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?!p\/|explore\/)([A-Za-z0-9_.]+)\/?/i,
  youtube:   /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)([A-Za-z0-9_\-.]+)\/?/i,
  tiktok:    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]+)\/?/i,
  linkedin:  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|company)\/([A-Za-z0-9_\-.]+)\/?/i,
  twitter:   /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)\/?/i,
  facebook:  /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([A-Za-z0-9_.]+)\/?/i,
};

// Domains that should be excluded from email extraction
const EMAIL_BLOCKLIST = new Set([
  'example.com', 'yourdomain.com', 'domain.com', 'email.com',
  'sentry.io', 'w3.org', 'schema.org', 'cloudflare.com',
]);

// Keywords that suggest low-quality or missing video content
const INTENT_KEYWORDS = {
  noVideo: [
    'contact us', 'about us', 'services', 'portfolio',
  ],
  lowQualityVideo: [
    'watch our video', 'view our video', 'see our video',
    'check out our video', 'promotional video', 'intro video',
  ],
  missingCaptions: ['no captions', 'uncaptioned'],
  oldContent: ['2018', '2019', '2020', '2021'],
};

// Signals on a social page indicating low video investment
const SOCIAL_LOW_QUALITY_INDICATORS = [
  /(\d+)\s*videos?/i,                   // < 5 videos
  /last\s+(?:post|upload)[^<]{0,60}(?:year|months ago)/i,
  /no\s+(?:reels|videos|shorts)/i,
  /\b(views?|likes?)\b[^<]{0,20}\b([0-9]{1,2})\b/i, // very low engagement
];

// ─── URL Builders ─────────────────────────────────────────────────────────────

/**
 * Build seed URLs for Phase 1 discovery.
 * Returns both a Google Maps URL and a Google Search URL.
 */
export function buildSearchUrls(niche, location) {
  const query = encodeURIComponent(`${niche} ${location}`);
  return [
    {
      url: `https://www.google.com/maps/search/${query}`,
      label: 'GOOGLE_MAPS',
    },
    {
      url: `https://www.google.com/search?q=${query}+website&num=20&gl=us&hl=en`,
      label: 'GOOGLE_SEARCH',
    },
    {
      url: `https://www.google.com/search?q=${encodeURIComponent(niche)}+${encodeURIComponent(location)}+Instagram+OR+LinkedIn&num=20`,
      label: 'GOOGLE_SEARCH',
    },
  ];
}

/**
 * Given a socialLinks map, return crawlable profile URLs with platform labels.
 * Only returns well-formed absolute URLs.
 */
export function buildSocialProfileUrls(socialLinks = {}) {
  const out = [];
  for (const [platform, url] of Object.entries(socialLinks)) {
    if (!url) continue;
    const absolute = url.startsWith('http') ? url : `https://${url}`;
    if (['instagram', 'youtube', 'tiktok'].includes(platform)) {
      out.push({ url: absolute, platform });
    }
  }
  return out;
}

// ─── Contact Extraction ───────────────────────────────────────────────────────

/**
 * Extract emails, phone numbers and social links from page HTML + text.
 */
export function extractContactDetails(html = '', pageText = '') {
  const combined = html + '\n' + pageText;

  // ── Emails ──────────────────────────────────────────────────────────────
  const rawEmails = [...new Set(combined.match(EMAIL_REGEX) ?? [])];
  const emails = rawEmails.filter((e) => {
    const domain = e.split('@')[1]?.toLowerCase();
    return domain && !EMAIL_BLOCKLIST.has(domain) && !domain.includes('example');
  });

  // ── Phones ──────────────────────────────────────────────────────────────
  const phones = [...new Set(combined.match(PHONE_REGEX) ?? [])].slice(0, 3);

  // ── Social Links ─────────────────────────────────────────────────────────
  const socialLinks = {};
  for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS)) {
    const match = combined.match(pattern);
    if (match?.[0]) {
      const raw = match[0].trim();
      socialLinks[platform] = raw.startsWith('http') ? raw : `https://${raw}`;
    }
  }

  return { emails, phones, socialLinks };
}

// ─── Business Info Enrichment ─────────────────────────────────────────────────

/**
 * Derive additional structured info from a partially-filled lead object.
 * Returns an enriched object including a preliminary intentScore.
 */
export function extractBusinessInfo(lead = {}) {
  const signals = lead.intentSignals ?? [];

  // Rough intent score: each signal = +10, cap at 100
  const intentScore = Math.min(signals.length * 10, 100);

  return {
    intentScore,
  };
}

// ─── Intent Signal Analysis ───────────────────────────────────────────────────

/**
 * Analyse a page for indicators that the business needs video editing help.
 * @param {object} opts
 * @param {string} opts.html      Raw HTML of the page
 * @param {string} opts.pageText  Plain text of the page
 * @param {string} opts.url       Page URL
 * @param {string} opts.type      'website' | 'instagram' | 'youtube' | 'tiktok' | ...
 * @returns {string[]} Array of human-readable signal strings
 */
export function analyzeIntentSignals({ html = '', pageText = '', url = '', type = 'website' }) {
  const signals = [];
  const lowerText = pageText.toLowerCase();
  const lowerHtml = html.toLowerCase();

  if (type === 'website') {
    // No video embed found
    if (
      !lowerHtml.includes('<video') &&
      !lowerHtml.includes('youtube.com/embed') &&
      !lowerHtml.includes('vimeo.com') &&
      !lowerHtml.includes('loom.com')
    ) {
      signals.push('NO_VIDEO_ON_WEBSITE');
    }

    // Stock-photo/no-visual keywords
    if (lowerText.includes('lorem ipsum')) {
      signals.push('PLACEHOLDER_CONTENT');
    }

    // No YouTube link at all
    if (!lowerHtml.includes('youtube.com') && !lowerHtml.includes('youtu.be')) {
      signals.push('NO_YOUTUBE_LINK');
    }

    // Very old copyright year
    const yearMatch = html.match(/copyright[^<]{0,20}(20\d{2})/i);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      if (year <= 2021) signals.push(`OUTDATED_WEBSITE_${year}`);
    }

    // DIY video keywords
    const diyKeywords = ['do it yourself', 'diy video', 'phone camera', 'selfie video'];
    if (diyKeywords.some((k) => lowerText.includes(k))) {
      signals.push('DIY_VIDEO_MENTIONS');
    }
  }

  if (type === 'youtube') {
    // Low video count
    const videoCountMatch = pageText.match(/(\d+)\s+videos?/i);
    if (videoCountMatch) {
      const count = parseInt(videoCountMatch[1], 10);
      if (count < 10) signals.push(`LOW_YOUTUBE_VIDEO_COUNT_${count}`);
    }

    // Old upload dates
    const oldDatePattern = /\b(2019|2020|2021)\b/g;
    const oldDates = pageText.match(oldDatePattern) ?? [];
    if (oldDates.length >= 2) signals.push('OLD_YOUTUBE_UPLOAD_DATES');

    // No shorts / minimal engagement language
    if (!lowerText.includes('shorts')) {
      signals.push('NO_YOUTUBE_SHORTS');
    }

    // Very low subscriber count
    const subMatch = pageText.match(/(\d+(?:\.\d+)?[KM]?)\s+subscribers?/i);
    if (subMatch) {
      const rawSubs = subMatch[1].toUpperCase();
      const subs = rawSubs.endsWith('K')
        ? parseFloat(rawSubs) * 1000
        : rawSubs.endsWith('M')
        ? parseFloat(rawSubs) * 1_000_000
        : parseFloat(rawSubs);
      if (subs < 1000) signals.push(`LOW_SUBSCRIBER_COUNT_${Math.round(subs)}`);
    }
  }

  if (type === 'instagram') {
    // No Reels mentions
    if (!lowerText.includes('reel') && !lowerText.includes('reels')) {
      signals.push('NO_INSTAGRAM_REELS');
    }

    // No captions (very short caption text)
    const captionMatches = html.match(/<[^>]+aria-label="[^"]{0,30}"/g) ?? [];
    if (captionMatches.length > 3) {
      signals.push('SHORT_OR_NO_CAPTIONS_ON_REELS');
    }

    // Low follower count
    const followerMatch = pageText.match(/(\d+(?:\.\d+)?[KM]?)\s+followers?/i);
    if (followerMatch) {
      const raw = followerMatch[1].toUpperCase();
      const count = raw.endsWith('K')
        ? parseFloat(raw) * 1000
        : raw.endsWith('M')
        ? parseFloat(raw) * 1_000_000
        : parseFloat(raw);
      if (count < 2000) signals.push(`LOW_INSTAGRAM_FOLLOWERS_${Math.round(count)}`);
    }

    // Posting frequency — if "days ago" appears many times, they post
    // If "weeks ago" / "months ago" dominate, they are inactive
    const weeksAgo  = (pageText.match(/\d+\s+weeks?\s+ago/gi) ?? []).length;
    const monthsAgo = (pageText.match(/\d+\s+months?\s+ago/gi) ?? []).length;
    if (weeksAgo + monthsAgo > 5) signals.push('INFREQUENT_INSTAGRAM_POSTING');
  }

  if (type === 'tiktok') {
    if (!lowerText.includes('duet') && !lowerText.includes('stitch')) {
      signals.push('NO_TIKTOK_ENGAGEMENT_FEATURES');
    }

    const likeMatch = pageText.match(/(\d+(?:\.\d+)?[KM]?)\s+likes?/i);
    if (likeMatch) {
      const raw = likeMatch[1].toUpperCase();
      const likes = raw.endsWith('K')
        ? parseFloat(raw) * 1000
        : raw.endsWith('M')
        ? parseFloat(raw) * 1_000_000
        : parseFloat(raw);
      if (likes < 500) signals.push(`VERY_LOW_TIKTOK_LIKES_${Math.round(likes)}`);
    }
  }

  return signals;
}

// ─── Contact Score ────────────────────────────────────────────────────────────

/**
 * Calculate a composite contact score (0–100) for prioritisation.
 *
 * Scoring logic:
 *  +30   Has at least one email
 *  +10   Has a phone number
 *  +10   Has an Instagram profile
 *  +10   Has a LinkedIn profile
 *  +5    Has a YouTube channel
 *  +5    Has a TikTok profile
 *  +20   Has intent signals (video quality issues) — scales with signal count
 *  +10   Has a website (easier to reach / more legitimate)
 *  –5    Only a Maps listing, no website
 */
export function calculateContactScore(lead = {}) {
  let score = 0;

  if (lead.emails?.length > 0)          score += 30;
  if (lead.phone)                        score += 10;
  if (lead.socialLinks?.instagram)       score += 10;
  if (lead.socialLinks?.linkedin)        score += 10;
  if (lead.socialLinks?.youtube)         score +=  5;
  if (lead.socialLinks?.tiktok)          score +=  5;
  if (lead.website)                      score += 10;
  else if (lead.mapsUrl)                 score -=  5;

  // Intent signals bonus (up to +20)
  const signalCount = lead.intentSignals?.length ?? 0;
  score += Math.min(signalCount * 4, 20);

  return Math.max(0, Math.min(score, 100));
}

// ─── URL Utilities ────────────────────────────────────────────────────────────

/**
 * Normalise and validate a URL string.
 * Returns null for junk/relative/blob/data URLs.
 */
export function sanitizeUrl(raw = '') {
  if (!raw) return null;
  try {
    // Strip Google redirect wrappers
    if (raw.includes('google.com/url')) {
      const inner = new URL(raw).searchParams.get('q');
      if (inner) return sanitizeUrl(inner);
    }
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    // Reject obvious non-business domains
    const excluded = ['google.com', 'facebook.com', 'yelp.com', 'yellowpages.com', 'tripadvisor.com'];
    if (excluded.some((d) => u.hostname.includes(d))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ─── Misc Utilities ───────────────────────────────────────────────────────────

/** Async sleep helper */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
