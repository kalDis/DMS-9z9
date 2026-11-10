// Daily ad-sync scheduler (Phase 3). Every minute it checks each ad-sync-enabled business and,
// when the current Sri Lanka time matches that business's ad_sync_time (and it hasn't already
// synced today), runs the Meta spend sync. No cron dependency — a plain minute interval.
const { query } = require('../config/db');
const { syncMetaForBusiness } = require('./ad-sync-meta');

const TZ = 'Asia/Colombo';

// "HH:MM" in Sri Lanka time right now.
function nowHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
// "YYYY-MM-DD" in Sri Lanka time for a given date (defaults to now).
function slDate(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

async function tick() {
  let businesses;
  try {
    businesses = (await query("SELECT * FROM businesses WHERE ad_sync_enabled = TRUE AND meta_access_token IS NOT NULL")).rows;
  } catch { return; }
  const hhmm = nowHHMM();
  const today = slDate();
  for (const biz of businesses) {
    const target = (biz.ad_sync_time || '02:00').slice(0, 5);
    if (target !== hhmm) continue;
    // Guard: only once per SL day.
    if (biz.ad_last_sync_at && slDate(new Date(biz.ad_last_sync_at)) === today) continue;
    try {
      // Sync the last 7 SL days so late-attributed spend is corrected.
      const from = slDate(new Date(Date.now() - 7 * 86400000));
      await syncMetaForBusiness(biz, { date_from: from, date_to: today });
      console.log(`[ad-sync] daily sync done for business ${biz.id} (${biz.name})`);
    } catch (e) {
      console.error(`[ad-sync] daily sync failed for business ${biz.id}:`, e.message);
      try { await query('UPDATE businesses SET ad_last_sync_at=NOW(), ad_last_sync_status=$1 WHERE id=$2', [`Auto-sync failed: ${e.message}`, biz.id]); } catch {}
    }
  }
}

let timer = null;
function startAdSyncScheduler() {
  if (timer) return;
  timer = setInterval(() => tick().catch(() => {}), 60 * 1000);
  console.log('Ad-sync daily scheduler started (checks every minute, Asia/Colombo).');
}
function stopAdSyncScheduler() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { startAdSyncScheduler, stopAdSyncScheduler };
