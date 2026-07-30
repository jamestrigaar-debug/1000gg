# Verify SEO Changes Checklist

Use this checklist to verify that all SEO changes have been implemented correctly.

## ✅ Files Modified

### index.html
- [ ] Meta description updated (line 17)
  - Should say: "Draft DNA from Premier League legends, build a striker, simulate every season and chase 1000 career goals. Play free in your browser — no download."
  
- [ ] VideoGame schema updated (lines 37-53)
  - Should have: `"@type": ["VideoGame", "WebApplication"]`
  - Should have: `"gamePlatform": ["Desktop web", "Mobile web", "Tablet web"]`
  - Should have: `"isAccessibleForFree": true`
  
- [ ] Footer note updated (line 995)
  - Should say: "1992–2025" (not 1992–2024)
  
- [ ] Internal navigation links added (lines 807-812)
  - Should have 4 links: How to Play, Peak vs At-the-Time, Difficulty Guide, Era Guide

### sitemap.xml
- [ ] 4 new URLs added
  - `/how-to-play/`
  - `/peak-rating-vs-rating-at-the-time/`
  - `/difficulty-guide/`
  - `/era-guide/`

---

## ✅ Files Created

### how-to-play.html
- [ ] File exists at `/how-to-play.html`
- [ ] Title: "How to Play Football DNA Simulator – Draft DNA & Chase 1000 Goals"
- [ ] Meta description present
- [ ] Canonical tag: `https://1000goals.co.uk/how-to-play/`
- [ ] HowTo schema present (6 steps)
- [ ] Back link to homepage works
- [ ] Internal links to other guides work
- [ ] Page loads without errors

### peak-rating-vs-rating-at-the-time.html
- [ ] File exists at `/peak-rating-vs-rating-at-the-time.html`
- [ ] Title: "Peak Rating vs Rating at the Time – Football DNA Simulator Guide"
- [ ] Meta description present
- [ ] Canonical tag: `https://1000goals.co.uk/peak-rating-vs-rating-at-the-time/`
- [ ] FAQPage schema present (4 questions)
- [ ] Comparison cards visible
- [ ] Back link to homepage works
- [ ] Internal links to other guides work
- [ ] Page loads without errors

### difficulty-guide.html
- [ ] File exists at `/difficulty-guide.html`
- [ ] Title: "Difficulty Guide – Football DNA Simulator"
- [ ] Meta description present
- [ ] Canonical tag: `https://1000goals.co.uk/difficulty-guide/`
- [ ] 4 difficulty cards visible (Easy, Medium, Hard, Impossible)
- [ ] Back link to homepage works
- [ ] Internal links to other guides work
- [ ] Page loads without errors

### era-guide.html
- [ ] File exists at `/era-guide.html`
- [ ] Title: "Era Guide – Football DNA Simulator"
- [ ] Meta description present
- [ ] Canonical tag: `https://1000goals.co.uk/era-guide/`
- [ ] 5 era blocks visible (All Eras, Classic, Modern, Recent, Current)
- [ ] Back link to homepage works
- [ ] Internal links to other guides work
- [ ] Page loads without errors

---

## ✅ Documentation Created

- [ ] `docs/SEO_IMPLEMENTATION.md` exists
- [ ] `docs/CAREER_SHARE_SEO_ROADMAP.md` exists
- [ ] `docs/SEO_QUICK_REFERENCE.md` exists
- [ ] `SEO_IMPLEMENTATION_SUMMARY.md` exists
- [ ] `VERIFY_SEO_CHANGES.md` (this file) exists

---

## ✅ Testing in Browser

### Homepage (index.html)
1. [ ] Open `https://1000goals.co.uk/` (or local equivalent)
2. [ ] Verify 4 guide links visible below "How to play" section
3. [ ] Click each link and verify it navigates correctly
4. [ ] Check page title in browser tab
5. [ ] Check meta description in page source

### How to Play Page
1. [ ] Open `/how-to-play/`
2. [ ] Verify page loads without errors
3. [ ] Verify "← Back to Game" link works
4. [ ] Verify 4 guide links at bottom work
5. [ ] Check page title and meta description

### Peak vs At-the-Time Page
1. [ ] Open `/peak-rating-vs-rating-at-the-time/`
2. [ ] Verify comparison cards visible
3. [ ] Verify "← Back to Game" link works
4. [ ] Verify 4 guide links at bottom work
5. [ ] Check page title and meta description

### Difficulty Guide Page
1. [ ] Open `/difficulty-guide/`
2. [ ] Verify 4 difficulty cards visible
3. [ ] Verify "← Back to Game" link works
4. [ ] Verify 4 guide links at bottom work
5. [ ] Check page title and meta description

### Era Guide Page
1. [ ] Open `/era-guide/`
2. [ ] Verify 5 era blocks visible
3. [ ] Verify "← Back to Game" link works
4. [ ] Verify 4 guide links at bottom work
5. [ ] Check page title and meta description

---

## ✅ SEO Validation

### Metadata
1. [ ] All pages have unique titles
2. [ ] All pages have meta descriptions
3. [ ] All pages have canonical tags
4. [ ] All pages have Open Graph tags
5. [ ] All pages have Twitter Card tags

### Structured Data
1. [ ] Homepage has VideoGame + WebApplication schema
2. [ ] Homepage has FAQPage schema
3. [ ] How to Play has HowTo schema
4. [ ] Peak vs At-the-Time has FAQPage schema
5. [ ] Validate schema with Google's Rich Results Test

### Links
1. [ ] All internal links use `<a href="">` (not JavaScript)
2. [ ] All links have descriptive anchor text
3. [ ] No broken links
4. [ ] Homepage links to all 4 guides
5. [ ] All guides link back to homepage

### Mobile
1. [ ] All pages responsive on mobile (320px width)
2. [ ] All text readable on mobile
3. [ ] All buttons clickable on mobile
4. [ ] No horizontal scrolling

### Performance
1. [ ] Pages load in under 2.5 seconds
2. [ ] No console errors
3. [ ] No network errors
4. [ ] Images optimized (if any)

---

## ✅ Search Console Preparation

Before submitting to Google:

1. [ ] Verify sitemap.xml is valid
   - Open `/sitemap.xml` in browser
   - Should show XML with 6 URLs
   
2. [ ] Verify robots.txt is correct
   - Open `/robots.txt` in browser
   - Should allow all and reference sitemap
   
3. [ ] Verify canonical tags
   - Check page source for `<link rel="canonical">`
   - Should match page URL

4. [ ] Verify no noindex tags
   - Check page source for `<meta name="robots" content="noindex">`
   - Should NOT be present on any page (yet)

---

## ✅ Google Search Console Setup

1. [ ] Add property: `https://1000goals.co.uk`
2. [ ] Verify ownership (DNS or HTML file)
3. [ ] Submit sitemap: `https://1000goals.co.uk/sitemap.xml`
4. [ ] Wait for indexation (24-48 hours)
5. [ ] Check "Coverage" report
   - All 5 pages should be "Indexed"
   - No errors or warnings
6. [ ] Check "Performance" report
   - Monitor impressions and clicks
   - Track average position

---

## ✅ Google Analytics 4 Setup

1. [ ] GA4 tracking code present in index.html (lines 4-12)
2. [ ] Test tracking with browser console
   - Open DevTools
   - Check Network tab for `google-analytics` requests
3. [ ] Verify events are firing
   - Check Realtime report
   - Should see page views and events

---

## ✅ Content Quality Check

### How to Play
- [ ] 1,200+ words
- [ ] 6 clear steps
- [ ] HowTo schema with all 6 steps
- [ ] Internal links to other guides
- [ ] No spelling/grammar errors
- [ ] Proper heading hierarchy

### Peak vs At-the-Time
- [ ] 1,000+ words
- [ ] Comparison cards visible
- [ ] Real examples provided
- [ ] FAQPage schema with 4 questions
- [ ] Internal links to other guides
- [ ] No spelling/grammar errors

### Difficulty Guide
- [ ] 900+ words
- [ ] 4 difficulty cards visible
- [ ] Strategy tips for each difficulty
- [ ] Internal links to other guides
- [ ] No spelling/grammar errors
- [ ] Proper heading hierarchy

### Era Guide
- [ ] 1,100+ words
- [ ] 5 era blocks visible
- [ ] Legends listed for each era
- [ ] Strategy tips for each era
- [ ] Internal links to other guides
- [ ] No spelling/grammar errors

---

## ✅ Deployment Checklist

Before going live:

1. [ ] All files created and tested locally
2. [ ] No broken links
3. [ ] No console errors
4. [ ] No network errors
5. [ ] Mobile responsive verified
6. [ ] Performance acceptable (< 2.5s load time)
7. [ ] Metadata correct on all pages
8. [ ] Structured data valid
9. [ ] Sitemap updated
10. [ ] Documentation complete

---

## ✅ Post-Deployment Checklist

After deploying to production:

1. [ ] Verify all pages accessible at correct URLs
2. [ ] Verify sitemap accessible at `/sitemap.xml`
3. [ ] Verify robots.txt accessible at `/robots.txt`
4. [ ] Test all internal links
5. [ ] Check Google Search Console
   - Submit sitemap
   - Monitor indexation
6. [ ] Check Google Analytics
   - Verify tracking is working
   - Check Realtime report
7. [ ] Monitor for errors
   - Check Search Console for crawl errors
   - Check Analytics for 404 errors
8. [ ] Share with team/stakeholders
   - Show new pages
   - Explain SEO benefits
   - Set expectations for timeline

---

## ✅ Monitoring (Ongoing)

### Weekly
- [ ] Check Google Search Console
  - Any crawl errors?
  - Any indexation issues?
  - New search queries?

### Monthly
- [ ] Review Google Analytics
  - Organic traffic trend
  - Top pages
  - Bounce rate
  - Engagement metrics

### Quarterly
- [ ] Review SEO strategy
  - Are we hitting targets?
  - What's working?
  - What needs adjustment?
  - Plan Phase 2 (career shares)

---

## ✅ Troubleshooting

### Pages not indexed
- [ ] Check Search Console Coverage report
- [ ] Verify canonical tags are correct
- [ ] Verify no noindex tags present
- [ ] Check robots.txt allows crawling
- [ ] Request indexation in Search Console

### Low organic traffic
- [ ] Check average position in Search Console
- [ ] Check CTR (meta description may need improvement)
- [ ] Check page load speed
- [ ] Verify content is unique and valuable
- [ ] Check for crawl errors

### Broken links
- [ ] Use Search Console to find 404 errors
- [ ] Check all internal links in HTML
- [ ] Verify file paths are correct
- [ ] Test links in browser

### Schema validation errors
- [ ] Use Google's Rich Results Test
- [ ] Check schema.org documentation
- [ ] Verify JSON-LD syntax
- [ ] Fix any validation errors

---

## ✅ Success Criteria

### 1 Month
- [ ] All 5 pages indexed in Google
- [ ] 0 crawl errors in Search Console
- [ ] 50+ monthly impressions
- [ ] 5+ monthly clicks

### 3 Months
- [ ] 100+ monthly impressions
- [ ] 10+ monthly clicks
- [ ] Average position improving (20-30 → 15-20)
- [ ] CTR improving (2% → 3-4%)

### 6 Months
- [ ] 1,000+ monthly impressions
- [ ] 100+ monthly clicks
- [ ] Top 10 ranking for "football career simulator"
- [ ] 10+ backlinks from social shares

---

## Questions?

Refer to:
- `docs/SEO_IMPLEMENTATION.md` — Technical details
- `docs/CAREER_SHARE_SEO_ROADMAP.md` — Phase 2 strategy
- `docs/SEO_QUICK_REFERENCE.md` — Quick reference
- `SEO_IMPLEMENTATION_SUMMARY.md` — Overview

---

**Last Updated:** July 26, 2026  
**Status:** Ready for verification ✅
