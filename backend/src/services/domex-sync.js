const { db } = require('../config/db');

const DOMEX_BASE = 'https://www.connectmesecure.com/api/CustomerInwards';

let syncInterval = null;

function loadSyncStatus() {
  const row = db.prepare('SELECT last_sync, status FROM sync_status WHERE id = 1').get();
  return row || { last_sync: null, status: 'idle' };
}

function saveSyncStatus(last_sync, status) {
  db.prepare('UPDATE sync_status SET last_sync = ?, status = ? WHERE id = 1').run(last_sync, status);
}

async function callDomex(endpoint, options = {}) {
  const { apiKey, method = 'GET', body, params } = options;
  let url = `${DOMEX_BASE}/${endpoint}`;
  if (params) {
    url += '?' + new URLSearchParams(params).toString();
  }

  const fetchOptions = {
    method,
    headers: {
      'accept': '*/*',
      'x-api-key': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetch(url, fetchOptions);
  const data = await res.json();
  return { status: res.status, data };
}

// Get status for a single tracking number
async function getTrackingStatus(apiKey, customerCode, trackingNo) {
  return callDomex('getCustomerStatusDetails', {
    apiKey,
    params: { trackingNo, customerCode },
  });
}

// Get waybill details
async function getWaybillDetails(apiKey, customerCode, trackingNo) {
  return callDomex('getCustomerWayBillDetails', {
    apiKey,
    params: { customerCode, trackingNo },
  });
}

// Push order to Domex (create)
async function pushOrderToDomex(apiKey, orderData) {
  return callDomex('setCustomerDataEntry', {
    apiKey,
    method: 'POST',
    body: orderData,
  });
}

// Update order on Domex
async function updateOrderOnDomex(apiKey, orderData) {
  return callDomex('updateCustomerDataEntry', {
    apiKey,
    method: 'PUT',
    body: orderData,
  });
}

// Delete order from Domex
async function deleteOrderFromDomex(apiKey, customerCode, trackingNo) {
  return callDomex('DeleteCustomerDataEntry', {
    apiKey,
    method: 'DELETE',
    params: { customerCode, trackingNo },
  });
}

// Map Domex status codes to our statuses
function mapDomexStatus(statusCode, statusText) {
  // Code-based mapping (most reliable)
  const codeMap = {
    // Pickup & Dispatch
    'CI': 'Dispatched',         // Waiting To Pickup By Customer location
    'CIU': 'Dispatched',        // Record Updated By Customer
    'CD': null,                  // Inward Deleted — ignore
    'I': 'Dispatched',          // Parcel Received By pickup branch

    // In Transit
    'CC': 'In Transit',         // Parcel Collected By branch
    'SO': 'In Transit',         // Parcel Send to Sort Facility
    'SCCI': 'In Transit',       // Arrived at Sort Facility
    'M': 'In Transit',          // In Transit between hubs
    'A': 'In Transit',          // Parcel Received By destination branch
    'HI': 'In Transit',         // Hold By branch
    'HO': 'In Transit',         // Branch Hold
    'RR': 'In Transit',         // Reroute to another branch
    'RTNB': 'In Transit',       // Return To Next Branch
    'RS': 'In Transit',         // Reschedule delivery
    'SRR': 'In Transit',        // Status Removal Request
    'SRRA': 'In Transit',       // Internal Processing
    'IER': 'Dispatched',        // Inward Edit Request

    // Out for Delivery
    'ATD': 'Out for Delivery',   // Out For Delivery

    // Delivered & Complete
    'D': 'Delivered',            // Delivered
    'PS': 'Delivered',           // POD Submitted (proof of delivery)
    'CRC': 'Delivered',          // Cash Received by branch
    'CBR': 'Delivered',          // Cash Received confirmed
    'CIG': 'Delivered',          // Complete (payment settled by finance)

    // Failed
    'UD': 'Failed',              // Undelivered
    'UDH': 'Failed',             // Undelivered Hold

    // Returned
    'R': 'Returned',             // Returned
    'RTS': 'Returned',           // Return To Sender
    'RTH': 'Returned',           // Return To Hub
    'RTN': 'Returned',           // Return To Customer
    'RTNQ': 'Returned',          // Return To Customer Confirmed
  };

  if (statusCode && codeMap[statusCode] !== undefined) return codeMap[statusCode];

  // Fallback: text-based
  const lower = (statusText || '').toLowerCase();
  if (lower.includes('delivered') && !lower.includes('undelivered')) return 'Delivered';
  if (lower.includes('out for delivery')) return 'Out for Delivery';
  if (lower.includes('in transit') || lower.includes('sort facility') || lower.includes('send to')) return 'In Transit';
  if (lower.includes('returned') || lower.includes('return')) return 'Returned';
  if (lower.includes('undelivered') || lower.includes('failed')) return 'Failed';
  if (lower.includes('received') || lower.includes('collected') || lower.includes('pickup')) return 'Dispatched';
  return null;
}

// Sync all dispatched orders for businesses with Domex API configured
async function syncOrders() {
  try {
    saveSyncStatus(null, 'syncing');

    const businesses = db.prepare(
      "SELECT id, name, domex_api_key, domex_customer_code FROM businesses WHERE domex_api_key IS NOT NULL AND domex_api_key != '' AND status = 'active'"
    ).all();

    if (!businesses.length) {
      saveSyncStatus(new Date().toISOString(), 'success');
      return { updated: 0, total: 0, errors: 0, businesses: 0 };
    }

    let totalUpdated = 0, totalChecked = 0, totalErrors = 0;

    for (const biz of businesses) {
      // Active orders: always sync for status updates
      // + orders missing history: fetch once to populate timeline
      const orders = db.prepare(
        `SELECT o.id, o.tracking_number, o.status FROM orders o
         WHERE o.business_id = ? AND (
           (o.status IN ('Dispatched', 'In Transit', 'Out for Delivery', 'Waiting')
            AND o.created_at >= datetime('now', '-14 days'))
           OR
           (o.id NOT IN (SELECT DISTINCT order_id FROM delivery_statuses))
         )
         ORDER BY o.created_at DESC`
      ).all(biz.id);

      // Process in batches with small delay to avoid rate limiting
      const BATCH_SIZE = 10;
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(order =>
            getTrackingStatus(biz.domex_api_key, biz.domex_customer_code, order.tracking_number)
              .then(result => ({ order, result }))
          )
        );

        const statusInsert = db.prepare(
          `INSERT OR IGNORE INTO delivery_statuses (order_id, status_code, status_text, location, remark, status_date)
           VALUES (?, ?, ?, ?, ?, ?)`
        );

        for (const r of results) {
          totalChecked++;
          if (r.status === 'fulfilled') {
            const { order, result } = r.value;
            if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
              // Store all status history
              let pickupDate = null;
              let deliveredDate = null;
              for (const s of result.data) {
                const location = (s.status || '').replace(/^.*By\s+/i, '').trim();
                statusInsert.run(order.id, s.statusCode, s.status, location, s.remark || '', s.statusDate);
                if (s.statusCode === 'I' && !pickupDate) pickupDate = s.statusDate;
                if (s.statusCode === 'D' || s.statusCode === 'PS') deliveredDate = s.statusDate;
              }

              // Update order status + key dates
              const latest = result.data[result.data.length - 1];
              const newStatus = mapDomexStatus(latest.statusCode, latest.status);
              if (newStatus && newStatus !== order.status) {
                db.prepare(`UPDATE orders SET status = ?, pickup_date = COALESCE(?, pickup_date),
                  delivered_date = COALESCE(?, delivered_date), updated_at = datetime('now') WHERE id = ?`)
                  .run(newStatus, pickupDate, deliveredDate, order.id);
                totalUpdated++;
              } else {
                db.prepare(`UPDATE orders SET pickup_date = COALESCE(?, pickup_date),
                  delivered_date = COALESCE(?, delivered_date) WHERE id = ?`)
                  .run(pickupDate, deliveredDate, order.id);
              }
            }
          } else {
            totalErrors++;
            console.error('Domex sync error:', r.reason?.message);
          }
        }

        // Small delay between batches to be respectful to Domex API
        if (i + BATCH_SIZE < orders.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    const syncTime = new Date().toISOString();
    saveSyncStatus(syncTime, totalErrors > 0 ? 'partial' : 'success');

    console.log(`Domex sync: ${totalUpdated}/${totalChecked} updated, ${totalErrors} errors across ${businesses.length} businesses`);
    return { updated: totalUpdated, total: totalChecked, errors: totalErrors, businesses: businesses.length };
  } catch (err) {
    saveSyncStatus(new Date().toISOString(), 'error');
    console.error('Domex sync error:', err);
    throw err;
  }
}

function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => syncOrders().catch(() => {}), intervalMs);
  console.log(`Domex auto-sync started (every ${intervalMs / 60000} min)`);
}

function stopAutoSync() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

function getSyncStatus() {
  const s = loadSyncStatus();
  return { last_sync: s.last_sync, status: s.status, auto_sync_active: !!syncInterval };
}

module.exports = {
  syncOrders, startAutoSync, stopAutoSync, getSyncStatus,
  getTrackingStatus, getWaybillDetails, pushOrderToDomex, updateOrderOnDomex, deleteOrderFromDomex,
};
