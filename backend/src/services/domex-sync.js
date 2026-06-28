const { query } = require('../config/db');

const DOMEX_BASE = 'https://www.connectmesecure.com/api/CustomerInwards';

let syncInterval = null;

async function callDomex(endpoint, options = {}) {
  const { apiKey, method = 'GET', body, params } = options;
  let url = `${DOMEX_BASE}/${endpoint}`;
  if (params) url += '?' + new URLSearchParams(params).toString();
  const fetchOptions = {
    method,
    headers: { 'accept': '*/*', 'x-api-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, fetchOptions);
  const data = await res.json();
  return { status: res.status, data };
}

async function getTrackingStatus(apiKey, customerCode, trackingNo) {
  return callDomex('getCustomerStatusDetails', { apiKey, params: { trackingNo, customerCode } });
}

async function getWaybillDetails(apiKey, customerCode, trackingNo) {
  return callDomex('getCustomerWayBillDetails', { apiKey, params: { customerCode, trackingNo } });
}

function mapDomexStatus(statusCode, statusText) {
  const codeMap = {
    'CI': 'Dispatched', 'CIU': 'Dispatched', 'CD': null, 'I': 'Dispatched', 'IER': 'Dispatched',
    'CC': 'In Transit', 'SO': 'In Transit', 'SCCI': 'In Transit', 'M': 'In Transit',
    'A': 'In Transit', 'HI': 'In Transit', 'HO': 'In Transit', 'RR': 'In Transit',
    'RTNB': 'In Transit', 'RS': 'In Transit', 'SRR': 'In Transit', 'SRRA': 'In Transit',
    'ATD': 'Out for Delivery',
    'D': 'Delivered', 'PS': 'Delivered', 'CRC': 'Delivered', 'CBR': 'Delivered', 'CIG': 'Delivered',
    'UD': 'Failed', 'UDH': 'Failed',
    'R': 'Returned', 'RTS': 'Returned', 'RTH': 'Returned', 'RTN': 'Returned', 'RTNQ': 'Returned',
  };
  if (statusCode && codeMap[statusCode] !== undefined) return codeMap[statusCode];
  const lower = (statusText || '').toLowerCase();
  if (lower.includes('delivered') && !lower.includes('undelivered')) return 'Delivered';
  if (lower.includes('out for delivery')) return 'Out for Delivery';
  if (lower.includes('in transit') || lower.includes('sort facility')) return 'In Transit';
  if (lower.includes('returned') || lower.includes('return')) return 'Returned';
  if (lower.includes('undelivered') || lower.includes('failed')) return 'Failed';
  if (lower.includes('received') || lower.includes('collected') || lower.includes('pickup')) return 'Dispatched';
  return null;
}

async function syncOrders() {
  try {
    await saveSyncStatus(null, 'syncing');

    const businesses = (await query(
      "SELECT id, name, domex_api_key, domex_customer_code FROM businesses WHERE domex_api_key IS NOT NULL AND domex_api_key != '' AND status = 'active'"
    )).rows;

    if (!businesses.length) {
      await saveSyncStatus(new Date().toISOString(), 'success');
      return { updated: 0, total: 0, errors: 0, businesses: 0 };
    }

    let totalUpdated = 0, totalChecked = 0, totalErrors = 0;

    for (const biz of businesses) {
      const orders = (await query(
        `SELECT o.id, o.tracking_number, o.status FROM orders o
         WHERE o.business_id = $1 AND o.status NOT IN ('Delivered','Returned')
         ORDER BY o.created_at DESC`, [biz.id]
      )).rows;

      const BATCH_SIZE = 10;
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(order => getTrackingStatus(biz.domex_api_key, biz.domex_customer_code, order.tracking_number).then(result => ({ order, result })))
        );

        for (const r of results) {
          totalChecked++;
          if (r.status === 'fulfilled') {
            const { order, result } = r.value;
            if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
              let pickupDate = null, deliveredDate = null;
              for (const s of result.data) {
                const location = (s.status || '').replace(/^.*By\s+/i, '').trim();
                try {
                  await query(
                    `INSERT INTO delivery_statuses (order_id, status_code, status_text, location, remark, status_date) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id, status_code, status_date) DO NOTHING`,
                    [order.id, s.statusCode, s.status, location, s.remark||'', s.statusDate]
                  );
                } catch {}
                if (s.statusCode === 'I' && !pickupDate) pickupDate = s.statusDate;
                if (s.statusCode === 'D' || s.statusCode === 'PS') deliveredDate = s.statusDate;
              }

              const latest = result.data[result.data.length - 1];
              const newStatus = mapDomexStatus(latest.statusCode, latest.status);
              if (newStatus && newStatus !== order.status) {
                await query(`UPDATE orders SET status=$1, pickup_date=COALESCE($2,pickup_date), delivered_date=COALESCE($3,delivered_date), updated_at=NOW() WHERE id=$4`,
                  [newStatus, pickupDate, deliveredDate, order.id]);
                totalUpdated++;
              } else {
                await query(`UPDATE orders SET pickup_date=COALESCE($1,pickup_date), delivered_date=COALESCE($2,delivered_date) WHERE id=$3`,
                  [pickupDate, deliveredDate, order.id]);
              }
            }
          } else {
            totalErrors++;
            console.error('Domex sync error:', r.reason?.message);
          }
        }

        if (i + BATCH_SIZE < orders.length) await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const syncTime = new Date().toISOString();
    await saveSyncStatus(syncTime, totalErrors > 0 ? 'partial' : 'success');
    console.log(`Domex sync: ${totalUpdated}/${totalChecked} updated, ${totalErrors} errors across ${businesses.length} businesses`);
    return { updated: totalUpdated, total: totalChecked, errors: totalErrors, businesses: businesses.length };
  } catch (err) {
    await saveSyncStatus(new Date().toISOString(), 'error');
    console.error('Domex sync error:', err);
    throw err;
  }
}

async function saveSyncStatus(last_sync, status) {
  await query('UPDATE sync_status SET last_sync = $1, status = $2 WHERE id = 1', [last_sync, status]);
}

async function getSyncStatus() {
  const row = (await query('SELECT last_sync, status FROM sync_status WHERE id = 1')).rows[0];
  return { last_sync: row?.last_sync || null, status: row?.status || 'idle', auto_sync_active: !!syncInterval };
}

function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => syncOrders().catch(() => {}), intervalMs);
  console.log(`Domex auto-sync started (every ${intervalMs / 60000} min)`);
}

function stopAutoSync() { if (syncInterval) { clearInterval(syncInterval); syncInterval = null; } }

module.exports = { syncOrders, startAutoSync, stopAutoSync, getSyncStatus, getTrackingStatus, getWaybillDetails, mapDomexStatus };
