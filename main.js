import { Actor } from 'apify';
import { PlaywrightCrawler, RequestQueue, log } from 'crawlee';
import {
  buildSearchUrls,
  extractBusinessInfo,
  extractContactDetails,
  analyzeIntentSignals,
  calculateContactScore,
  buildSocialProfileUrls,
  sanitizeUrl,
  sleep,
} from './tools.js';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
await Actor.init();

const input = await Actor.getInput();

const {
  niche = 'Real Estate Agents',
  location = 'Pune, India',
  maxLeads = 20,
  proxyConfiguration: proxyConfig,
} = input ?? {};

log.info(`🎬 Video Editor Lead Engine starting`, { niche, location, maxLeads });

// ─── Proxy Setup ─────────────────────────────────────────────────────────────
const proxyConfiguration = proxyConfig
  ? await Actor.createProxyConfiguration(proxyConfig)
  : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });

// ─── Shared State ────────────────────────────────────────────────────────────
const discoveredLeads = new Map();   // url → raw business object
const enrichedLeads   = [];
let   leadCount       = 0;

// ─── Request Queue ────────────────────────────────────────────────────────────
const requestQueue = await RequestQueue.open();

// Phase 1 — Seed discovery URLs (Google Maps + Google Search)
const seedUrls = buildSearchUrls(niche, location);
for (const { url, label } of seedUrls) {
  await requestQueue.addRequest({ url, label, userData: { phase: 'DISCOVERY', label } });
}

// ─── Crawler ─────────────────────────────────────────────────────────────────
const crawler = new PlaywrightCrawler({
  requestQueue,
  proxyConfiguration,
  maxConcurrency: 3,
  maxRequestRetries: 2,
  navigationTimeoutSecs: 45,
  requestHandlerTimeoutSecs: 90,
  launchContext: {
    launchOptions: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    },
  },
  browserPoolOptions: { useFingerprints: true },

  // ── Pre-navigation: skip heavy assets ────────────────────────────────────
  preNavigationHooks: [
    async ({ page }) => {
      await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,mp4,webm}', (route) =>
        route.abort()
      );
      // Stealth: hide webdriver flag
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
    },
  ],

  // ── Main handler ─────────────────────────────────────────────────────────
  requestHandler: async ({ request, page, enqueueLinks, log: crawlLog }) => {
    const { phase, label } = request.userData;

    // ── PHASE 1: DISCOVERY ──────────────────────────────────────────────────
    if (phase === 'DISCOVERY') {
      crawlLog.info(`[DISCOVERY] Crawling: ${request.url}`);

      // Handle Google Maps
      if (label === 'GOOGLE_MAPS') {
        await page.waitForSelector('[role="feed"], .Nv2PK, [data-result-index]', {
          timeout: 15_000,
        }).catch(() => {});

        // Scroll to load more results
        for (let i = 0; i < 4; i++) {
          await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            if (feed) feed.scrollTop += 1200;
          });
          await sleep(1500);
        }

        const businesses = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.Nv2PK, [data-result-index]')];
          return cards.map((card) => ({
            name: card.querySelector('.qBF1Pd, .fontHeadlineSmall')?.textContent?.trim() ?? '',
            mapsUrl: card.querySelector('a[href*="/maps/place/"]')?.href ?? '',
            rating: card.querySelector('.MW4etd')?.textContent?.trim() ?? '',
            reviewCount: card.querySelector('.UY7F9')?.textContent?.replace(/[()]/g, '').trim() ?? '',
            category: card.querySelector('.W4Efsd span:first-child')?.textContent?.trim() ?? '',
            address: card.querySelector('.W4Efsd:last-child')?.textContent?.trim() ?? '',
          }));
        });

        for (const biz of businesses) {
          if (!biz.name || discoveredLeads.size >= maxLeads * 3) break;
          if (biz.mapsUrl && !discoveredLeads.has(biz.mapsUrl)) {
            discoveredLeads.set(biz.mapsUrl, { ...biz, location });
            await requestQueue.addRequest({
              url: biz.mapsUrl,
              userData: { phase: 'ENRICH_MAPS', business: biz },
            });
          }
        }
        crawlLog.info(`[DISCOVERY] Found ${businesses.length} businesses on Maps`);
      }

      // Handle Google Search
      if (label === 'GOOGLE_SEARCH') {
        await page.waitForSelector('#search, #rso', { timeout: 12_000 }).catch(() => {});

        const results = await page.evaluate(() => {
          const items = [...document.querySelectorAll('#rso .g, #rso [data-hveid]')];
          return items.map((el) => ({
            title: el.querySelector('h3')?.textContent?.trim() ?? '',
            url: el.querySelector('a[href]')?.href ?? '',
            snippet: el.querySelector('.VwiC3b, .lEBKkf')?.textContent?.trim() ?? '',
          })).filter((r) => r.url.startsWith('http') && !r.url.includes('google.com'));
        });

        for (const result of results) {
          if (!result.url || discoveredLeads.size >= maxLeads * 3) break;
          const cleanUrl = sanitizeUrl(result.url);
          if (cleanUrl && !discoveredLeads.has(cleanUrl)) {
            discoveredLeads.set(cleanUrl, { name: result.title, website: cleanUrl, snippet: result.snippet, location });
            await requestQueue.addRequest({
              url: cleanUrl,
              userData: { phase: 'ENRICH_WEBSITE', business: { name: result.title, website: cleanUrl } },
            });
          }
        }
        crawlLog.info(`[DISCOVERY] Found ${results.length} search results`);
      }
    }

    // ── PHASE 2a: ENRICH via Google Maps Detail Page ────────────────────────
    if (phase === 'ENRICH_MAPS') {
      if (leadCount >= maxLeads) return;
      crawlLog.info(`[ENRICH_MAPS] ${request.userData.business?.name}`);

      await page.waitForSelector('h1.DUwDvf, [data-attrid="title"]', { timeout: 12_000 }).catch(() => {});

      const details = await page.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
        const getHref = (sel) => document.querySelector(sel)?.href ?? '';
        return {
          businessName: getText('h1.DUwDvf') || getText('[data-attrid="title"]'),
          phone:        getText('[data-tooltip="Copy phone number"] .Io6YTe, .UsdlK') ||
                        [...document.querySelectorAll('[data-item-id^="phone"]')].map((el) => el.textContent).join(''),
          website:      getHref('a[data-item-id="authority"]') || getHref('[aria-label*="website"] a'),
          address:      getText('.rogA2c .Io6YTe') || getText('[data-item-id*="address"] .Io6YTe'),
          category:     getText('.DkEaL'),
        };
      });

      const website = sanitizeUrl(details.website);

      const lead = {
        businessName: details.businessName || request.userData.business?.name,
        mapsUrl: request.url,
        website,
        phone: details.phone,
        address: details.address || location,
        category: details.category,
        location,
        emails: [],
        socialLinks: {},
        intentSignals: [],
        intentScore: 0,
        contactScore: 0,
        source: 'google_maps',
      };

      discoveredLeads.set(request.url, lead);

      // Enqueue the actual website for deeper enrichment
      if (website) {
        await requestQueue.addRequest({
          url: website,
          userData: { phase: 'ENRICH_WEBSITE', business: lead, fromMaps: true },
        });
      } else {
        await finalizeLead(lead, crawlLog);
      }
    }

    // ── PHASE 2b: ENRICH via Website ────────────────────────────────────────
    if (phase === 'ENRICH_WEBSITE') {
      if (leadCount >= maxLeads) return;
      const existing = request.userData.business ?? {};
      crawlLog.info(`[ENRICH_WEBSITE] ${existing.name || existing.businessName || request.url}`);

      const html = await page.content();
      const pageText = await page.evaluate(() => document.body?.innerText ?? '');

      // Extract contacts
      const contacts = extractContactDetails(html, pageText);

      // Detect intent signals from the website
      const websiteSignals = analyzeIntentSignals({ html, pageText, url: request.url, type: 'website' });

      const lead = {
        businessName: existing.businessName || existing.name || '',
        website: request.url,
        mapsUrl: existing.mapsUrl ?? '',
        phone: contacts.phones[0] || existing.phone || '',
        address: existing.address || location,
        category: existing.category || '',
        location,
        emails: contacts.emails,
        socialLinks: contacts.socialLinks,
        intentSignals: websiteSignals,
        intentScore: 0,
        contactScore: 0,
        source: existing.fromMaps ? 'google_maps+website' : 'google_search',
      };

      // Enqueue social profiles for Phase 3 intent analysis
      const socialUrls = buildSocialProfileUrls(contacts.socialLinks);
      for (const { url: socialUrl, platform } of socialUrls) {
        if (!discoveredLeads.has(socialUrl)) {
          discoveredLeads.set(socialUrl, true); // mark as queued
          await requestQueue.addRequest({
            url: socialUrl,
            userData: { phase: 'ANALYZE_SOCIAL', business: lead, platform },
          });
        }
      }

      if (socialUrls.length === 0) {
        await finalizeLead(lead, crawlLog);
      } else {
        // Store partial lead; social handler will finalize
        discoveredLeads.set(request.url + '__partial', lead);
      }
    }

    // ── PHASE 3: SOCIAL INTENT ANALYSIS ─────────────────────────────────────
    if (phase === 'ANALYZE_SOCIAL') {
      if (leadCount >= maxLeads) return;
      const { business, platform } = request.userData;
      crawlLog.info(`[SOCIAL] Analyzing ${platform} for ${business.businessName}`);

      const html = await page.content();
      const pageText = await page.evaluate(() => document.body?.innerText ?? '');

      const socialSignals = analyzeIntentSignals({ html, pageText, url: request.url, type: platform });

      // Merge signals into the lead
      const partialKey = (business.website || business.mapsUrl) + '__partial';
      const existingLead = discoveredLeads.get(partialKey) ?? business;

      existingLead.intentSignals = [
        ...(existingLead.intentSignals ?? []),
        ...socialSignals,
      ];
      existingLead.socialLinks[platform] = request.url;

      discoveredLeads.set(partialKey, existingLead);
      await finalizeLead(existingLead, crawlLog);
    }
  },

  // ── Error / Blocked handling ──────────────────────────────────────────────
  failedRequestHandler: async ({ request, log: crawlLog }) => {
    crawlLog.warning(`[FAILED] ${request.url} — ${request.errorMessages?.slice(-1)[0] ?? 'unknown error'}`);
  },

  errorHandler: async ({ request, error, log: crawlLog }) => {
    const msg = error?.message ?? '';
    if (msg.includes('Page crashed') || msg.includes('Target closed')) {
      crawlLog.warning(`[CRASHED] Skipping ${request.url}`);
      request.noRetry = true;
    } else if (msg.includes('net::ERR_BLOCKED') || msg.includes('403') || msg.includes('captcha')) {
      crawlLog.warning(`[BLOCKED] ${request.url} — rotating proxy on retry`);
    } else {
      crawlLog.error(`[ERROR] ${request.url}: ${msg}`);
    }
  },
});

// ─── Lead Finalizer ───────────────────────────────────────────────────────────
async function finalizeLead(lead, crawlLog) {
  if (leadCount >= maxLeads) return;
  if (!lead.businessName && !lead.website) return;

  // De-dupe by website or mapsUrl
  const dedupeKey = lead.website || lead.mapsUrl;
  if (!dedupeKey) return;

  // Avoid pushing same lead twice
  if (enrichedLeads.some((l) => l.website === lead.website && l.businessName === lead.businessName)) return;

  // Enrich info from page-extracted data
  const info = extractBusinessInfo(lead);

  lead.intentScore  = info.intentScore;
  lead.contactScore = calculateContactScore(lead);

  enrichedLeads.push(lead);
  leadCount++;

  crawlLog.info(
    `✅ Lead #${leadCount}: ${lead.businessName} | intent=${lead.intentScore} contact=${lead.contactScore}`
  );

  await Actor.pushData({
    businessName:  lead.businessName,
    website:       lead.website       || null,
    mapsUrl:       lead.mapsUrl       || null,
    emails:        lead.emails        ?? [],
    phone:         lead.phone         || null,
    address:       lead.address       || null,
    location:      lead.location,
    category:      lead.category      || null,
    socialLinks:   lead.socialLinks   ?? {},
    intentSignals: lead.intentSignals ?? [],
    intentScore:   lead.intentScore,
    contactScore:  lead.contactScore,
    source:        lead.source,
    scrapedAt:     new Date().toISOString(),
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────
await crawler.run();

log.info(`🏁 Done. Total leads saved: ${leadCount}`);
await Actor.exit();
