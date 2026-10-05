const { query } = require('../config/db');

// Domex "Global API" (Oct 2026 security update): new host + token auth.
// Flow: POST /Token/access-token-v-4-1 { userName, password } (with x-api-key) → { token };
// then every CustomerInwards call needs BOTH x-api-key AND Authorization: Bearer <token>.
// The status/waybill GETs now take ONLY trackingNo (customerCode was removed).
const DOMEX_BASE = 'https://www.connectmesecurego.com/api';

let syncInterval = null;

// Per-business Bearer-token cache: businessId -> { token, exp(ms) }
const tokenCache = new Map();

function decodeJwtExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    if (payload && payload.exp) return payload.exp * 1000;
  } catch {}
  return Date.now() + 50 * 60 * 1000; // fallback if token can't be parsed
}

// Low-level HTTP. Adds x-api-key / Bearer / Content-Type as provided. Returns { status, data }.
async function callDomex(endpoint, { method = 'GET', apiKey, token, body, params } = {}) {
  let url = `${DOMEX_BASE}/${endpoint}`;
  if (params) url += '?' + new URLSearchParams(params).toString();
  const headers = { accept: '*/*' };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// Get (and cache) a Bearer token for a business via the login endpoint.
// biz = { id, domex_api_key, domex_username, domex_password }. Null if creds missing/invalid.
async function getDomexToken(biz, force = false) {
  if (!biz || !biz.domex_api_key || !biz.domex_username || !biz.domex_password) return null;
  const cached = tokenCache.get(biz.id);
  if (!force && cached && cached.exp > Date.now() + 60 * 1000) return cached.token;
  const res = await callDomex('Token/access-token-v-4-1', {
    method: 'POST', apiKey: biz.domex_api_key,
    body: { userName: biz.domex_username, password: biz.domex_password },
  });
  const token = res.status === 200 && res.data && res.data.token ? res.data.token : null;
  if (token) { tokenCache.set(biz.id, { token, exp: decodeJwtExpMs(token) }); return token; }
  tokenCache.delete(biz.id);
  return null;
}

// GET a CustomerInwards endpoint for one tracking number. Returns { status, data }.
// status 401/403 (or null token) signals an auth/credential problem.
async function domexGet(biz, endpoint, trackingNo) {
  let token = await getDomexToken(biz);
  if (!token) return { status: 401, data: { error: 'No Domex token — check API key / username / password' } };
  let res = await callDomex(endpoint, { apiKey: biz.domex_api_key, token, params: { trackingNo } });
  if (res.status === 401) { // token likely expired — refresh once and retry
    token = await getDomexToken(biz, true);
    if (token) res = await callDomex(endpoint, { apiKey: biz.domex_api_key, token, params: { trackingNo } });
  }
  return res;
}

async function getTrackingStatus(biz, trackingNo) {
  return domexGet(biz, 'CustomerInwards/getCustomerStatusDetails', trackingNo);
}

async function getWaybillDetails(biz, trackingNo) {
  return domexGet(biz, 'CustomerInwards/getCustomerWayBillDetails', trackingNo);
}

function mapDomexStatus(statusCode, statusText) {
  const codeMap = {
    'CI': 'Dispatched', 'CIU': 'Dispatched', 'CD': null, 'I': 'Dispatched', 'IER': 'Dispatched',
    'CC': 'In Transit', 'SO': 'In Transit', 'SCCI': 'In Transit', 'M': 'In Transit',
    'A': 'In Transit', 'HI': 'Hold', 'HO': 'Hold', 'RR': 'In Transit',
    'RTNB': 'In Transit', 'RS': 'In Transit', 'SRR': 'In Transit', 'SRRA': 'In Transit',
    'ATD': 'Out for Delivery',
    'D': 'Delivered', 'PS': 'Delivered', 'CRC': 'Delivered', 'CBR': 'Delivered',
    'UD': 'Failed', 'UDH': 'Failed',
    'R': 'Returned', 'RTS': 'Returned', 'RTH': 'Returned', 'RTN': 'Returned', 'RTNQ': 'Returned',
  };
  if (statusCode && codeMap[statusCode] !== undefined) return codeMap[statusCode];
  const lower = (statusText || '').toLowerCase();
  if (lower.includes('delivered') && !lower.includes('undelivered')) return 'Delivered';
  if (lower.includes('out for delivery')) return 'Out for Delivery';
  if (lower.includes('hold')) return 'Hold';
  if (lower.includes('in transit') || lower.includes('sort facility')) return 'In Transit';
  if (lower.includes('returned') || lower.includes('return')) return 'Returned';
  if (lower.includes('undelivered') || lower.includes('failed')) return 'Failed';
  if (lower.includes('received') || lower.includes('collected') || lower.includes('pickup')) return 'Dispatched';
  return null;
}

// Scans that represent an action performed BY the last-mile (delivering) branch:
// ATD = out for delivery, D/PS = delivered, UD/UDH = failed attempt, RS = reschedule,
// HI/HO = hold, RTNB = return to next branch. All of these are done by the branch
// attempting delivery. Deliberately EXCLUDED: 'A' (Parcel Received) and 'RTN'
// (Return To Customer) — these fire at the ORIGIN branch when a parcel comes back,
// and would mis-attribute returns to the origin. Also excluded: I/CC/SO (origin
// dispatch) and SCCI/M (sort/transit hubs).
const LAST_MILE_CODES = ['ATD', 'D', 'PS', 'UD', 'UDH', 'RS', 'HI', 'HO', 'RTNB'];

// Given tracking events (chronological) return the delivering branch: the location
// of the most recent last-mile scan. Null if the parcel hasn't reached one yet.
function deliveryBranchFrom(events) {
  let branch = null;
  for (const s of events) {
    if (LAST_MILE_CODES.includes(s.statusCode)) {
      const loc = (s.status || '').replace(/^.*By\s+/i, '').trim();
      if (loc) branch = loc;
    }
  }
  return branch;
}

async function syncOrders() {
  try {
    await saveSyncStatus(null, 'syncing', 0, 0, 0, 0);

    const businesses = (await query(
      "SELECT id, name, domex_api_key, domex_customer_code, domex_username, domex_password FROM businesses WHERE domex_api_key IS NOT NULL AND domex_api_key != '' AND status = 'active'"
    )).rows;

    if (!businesses.length) {
      await saveSyncStatus(new Date().toISOString(), 'success');
      return { updated: 0, total: 0, errors: 0, businesses: 0 };
    }

    let totalUpdated = 0, totalChecked = 0, totalErrors = 0, totalOrders = 0;
    let totalFound = 0, totalNotFound = 0; // Domex returned usable data vs none (404/empty)

    // Count total orders first for progress
    for (const biz of businesses) {
      const cnt = (await query(`SELECT COUNT(*) as c FROM orders WHERE business_id = $1 AND status NOT IN ('Delivered','Returned')`, [biz.id])).rows[0];
      totalOrders += Number(cnt.c);
    }
    await saveSyncStatus(null, 'syncing', 0, totalOrders, 0, 0);

    for (const biz of businesses) {
      const orders = (await query(
        `SELECT o.id, o.tracking_number, o.status, o.customer_name, o.phone, o.address, o.city, o.product FROM orders o
         WHERE o.business_id = $1 AND o.status NOT IN ('Delivered','Returned')
         ORDER BY o.created_at DESC`, [biz.id]
      )).rows;

      const BATCH_SIZE = 10;
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        // Fetch status + waybill details for orders missing customer data
        const results = await Promise.allSettled(
          batch.map(async order => {
            const statusResult = await getTrackingStatus(biz, order.tracking_number);
            let waybill = null;
            const needsDetails = !order.customer_name || !order.phone || !order.address || !order.product;
            if (needsDetails) {
              try {
                const wb = await getWaybillDetails(biz, order.tracking_number);
                if (wb.status === 200 && wb.data && !wb.data.errorCode) waybill = wb.data;
              } catch {}
            }
            return { order, result: statusResult, waybill };
          })
        );

        for (const r of results) {
          totalChecked++;
          if (r.status === 'fulfilled') {
            const { order, result, waybill } = r.value;
            if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
              totalFound++;
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

              // Find most recent status that maps to something (scan from latest backwards)
              let newStatus = null;
              for (let si = result.data.length - 1; si >= 0; si--) {
                const mapped = mapDomexStatus(result.data[si].statusCode, result.data[si].status);
                if (mapped !== null) { newStatus = mapped; break; }
              }

              // Build update with waybill customer details
              const wbName = waybill?.receiverName || '';
              const wbPhone = waybill?.receiverContactNo || '';
              const wbAddress = waybill?.receiverAddress || '';
              const wbCity = waybill?.receiverCity || '';
              const wbProduct = waybill?.packageDesc || '';
              const wbWeight = waybill?.weight ? String(waybill.weight) : '';
              const wbAmount = waybill?.value || null;
              const wbPieces = waybill?.noOfPcs || null;
              const wbExchange = waybill?.exchange || '';
              const deliveryBranch = deliveryBranchFrom(result.data);

              await query(`UPDATE orders SET
                status = COALESCE($1, status),
                pickup_date = COALESCE($2, pickup_date),
                delivered_date = COALESCE($3, delivered_date),
                customer_name = COALESCE(NULLIF($4,''), customer_name),
                phone = COALESCE(NULLIF($5,''), phone),
                address = COALESCE(NULLIF($6,''), address),
                city = COALESCE(NULLIF($7,''), city),
                product = COALESCE(NULLIF($8,''), product),
                weight = COALESCE(NULLIF($9,''), weight),
                amount = COALESCE($10, amount),
                pieces = COALESCE($11, pieces),
                exchange = COALESCE(NULLIF($12,''), exchange),
                delivery_branch = COALESCE(NULLIF($13,''), delivery_branch),
                updated_at = NOW()
                WHERE id = $14`,
                [newStatus || order.status, pickupDate, deliveredDate,
                 wbName, wbPhone, wbAddress, wbCity, wbProduct, wbWeight, wbAmount, wbPieces, wbExchange, deliveryBranch, order.id]);

              if (newStatus && newStatus !== order.status) totalUpdated++;
            } else {
              // Fulfilled but Domex returned no usable data (404 / empty array).
              totalNotFound++;
            }
          } else {
            totalErrors++;
            console.error('Domex sync error:', r.reason?.message);
          }
        }

        if (i + BATCH_SIZE < orders.length) await new Promise(resolve => setTimeout(resolve, 200));

        // Save progress after each batch
        await saveSyncStatus(new Date().toISOString(), 'syncing', totalChecked, totalOrders, totalUpdated, totalErrors, totalNotFound);
      }
    }

    // Classify the run's health. If the API returned NOTHING for a meaningful number
    // of orders it's almost certainly a credential/endpoint problem, not "all delivered".
    const syncTime = new Date().toISOString();
    let finalStatus, note = null;
    if (totalChecked >= 10 && totalFound === 0) {
      finalStatus = 'api_down';
      note = `Domex API returned NO data for all ${totalChecked} pending orders — likely an expired/changed API key or login (username/password). Verify Domex credentials in Admin → business → Domex settings.`;
    } else if (totalChecked >= 20 && totalFound > 0 && totalNotFound / totalChecked >= 0.8) {
      finalStatus = 'warning';
      note = `Domex returned no data for ${totalNotFound} of ${totalChecked} orders — check if the API key / login is still valid.`;
    } else if (totalErrors > 0) {
      finalStatus = 'partial';
    } else {
      finalStatus = 'success';
    }
    await saveSyncStatus(syncTime, finalStatus, totalChecked, totalOrders, totalUpdated, totalErrors, totalNotFound, note);
    console.log(`Domex sync: ${totalUpdated}/${totalChecked} updated, found=${totalFound} notFound=${totalNotFound} errors=${totalErrors} across ${businesses.length} businesses → ${finalStatus}`);
    return { updated: totalUpdated, total: totalChecked, errors: totalErrors, not_found: totalNotFound, businesses: businesses.length, status: finalStatus };
  } catch (err) {
    await saveSyncStatus(new Date().toISOString(), 'error', totalChecked, totalOrders, totalUpdated, totalErrors, totalNotFound, err.message);
    console.error('Domex sync error:', err);
    throw err;
  }
}

async function saveSyncStatus(last_sync, status, progress = 0, total = 0, updated = 0, errors = 0, not_found = 0, note = null) {
  await query('UPDATE sync_status SET last_sync=$1, status=$2, progress=$3, total=$4, updated=$5, errors=$6, not_found=$7, note=$8 WHERE id=1',
    [last_sync, status, progress, total, updated, errors, not_found, note]);
}

async function detectCouriers(orderIds) {
  const orders = (await query(
    `SELECT o.id, o.tracking_number, b.id as business_id, b.domex_api_key, b.domex_customer_code, b.domex_username, b.domex_password
     FROM orders o JOIN businesses b ON o.business_id = b.id
     WHERE o.id = ANY($1)`, [orderIds]
  )).rows;

  let detected = 0;
  await Promise.allSettled(orders.map(async order => {
    try {
      // Try Domex
      if (order.domex_api_key) {
        const biz = { id: order.business_id, domex_api_key: order.domex_api_key, domex_username: order.domex_username, domex_password: order.domex_password };
        const result = await getTrackingStatus(biz, order.tracking_number);
        if (result.status === 200 && Array.isArray(result.data) && result.data.length > 0) {
          await query("UPDATE orders SET courier = 'domex', updated_at = NOW() WHERE id = $1", [order.id]);
          detected++;
          return;
        }
      }
      // Future couriers: add more checks here
      // If nothing matched, leave as 'unknown'
    } catch {}
  }));

  return { detected, total: orders.length, undetected: orders.length - detected };
}

async function syncSelectedOrders(orderIds) {
  const orders = (await query(
    `SELECT o.id, o.tracking_number, o.status, o.customer_name, o.phone, o.address, o.city, o.product,
            b.id as business_id, b.domex_api_key, b.domex_customer_code, b.domex_username, b.domex_password
     FROM orders o
     JOIN businesses b ON o.business_id = b.id
     WHERE o.id = ANY($1) AND b.domex_api_key IS NOT NULL AND b.domex_api_key != ''`,
    [orderIds]
  )).rows;

  let updated = 0, errors = 0;

  await Promise.allSettled(orders.map(async order => {
    try {
      const biz = { id: order.business_id, domex_api_key: order.domex_api_key, domex_username: order.domex_username, domex_password: order.domex_password };
      const statusResult = await getTrackingStatus(biz, order.tracking_number);
      const needsDetails = !order.customer_name || !order.phone || !order.address || !order.product;
      let waybill = null;
      if (needsDetails) {
        try {
          const wb = await getWaybillDetails(biz, order.tracking_number);
          if (wb.status === 200 && wb.data && !wb.data.errorCode) waybill = wb.data;
        } catch {}
      }

      if (statusResult.status === 200 && Array.isArray(statusResult.data) && statusResult.data.length > 0) {
        let pickupDate = null, deliveredDate = null;
        for (const s of statusResult.data) {
          const location = (s.status || '').replace(/^.*By\s+/i, '').trim();
          try {
            await query(
              `INSERT INTO delivery_statuses (order_id, status_code, status_text, location, remark, status_date) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id, status_code, status_date) DO NOTHING`,
              [order.id, s.statusCode, s.status, location, s.remark || '', s.statusDate]
            );
          } catch {}
          if (s.statusCode === 'I' && !pickupDate) pickupDate = s.statusDate;
          if (s.statusCode === 'D' || s.statusCode === 'PS') deliveredDate = s.statusDate;
        }

        let newStatus = null;
        for (let si = statusResult.data.length - 1; si >= 0; si--) {
          const mapped = mapDomexStatus(statusResult.data[si].statusCode, statusResult.data[si].status);
          if (mapped !== null) { newStatus = mapped; break; }
        }
        const deliveryBranch = deliveryBranchFrom(statusResult.data);

        await query(`UPDATE orders SET
          status = COALESCE($1, status),
          pickup_date = COALESCE($2, pickup_date),
          delivered_date = COALESCE($3, delivered_date),
          customer_name = COALESCE(NULLIF($4,''), customer_name),
          phone = COALESCE(NULLIF($5,''), phone),
          address = COALESCE(NULLIF($6,''), address),
          city = COALESCE(NULLIF($7,''), city),
          product = COALESCE(NULLIF($8,''), product),
          weight = COALESCE(NULLIF($9,''), weight),
          amount = COALESCE($10, amount),
          pieces = COALESCE($11, pieces),
          exchange = COALESCE(NULLIF($12,''), exchange),
          delivery_branch = COALESCE(NULLIF($13,''), delivery_branch),
          updated_at = NOW()
          WHERE id = $14`,
          [newStatus || order.status, pickupDate, deliveredDate,
           waybill?.receiverName || '', waybill?.receiverContactNo || '', waybill?.receiverAddress || '',
           waybill?.receiverCity || '', waybill?.packageDesc || '', waybill?.weight ? String(waybill.weight) : '',
           waybill?.value || null, waybill?.noOfPcs || null, waybill?.exchange || '', deliveryBranch, order.id]);

        if (newStatus && newStatus !== order.status) updated++;
      }
    } catch (err) {
      errors++;
      console.error(`Sync error for order ${order.tracking_number}:`, err.message);
    }
  }));

  return { updated, total: orders.length, errors, skipped: orderIds.length - orders.length };
}

// Reconcile orders that were marked Returned via the ISSUE WORKFLOW (resolved/auto_return)
// against live Domex — fixes ones Domex actually Delivered (or otherwise moved past Returned).
// Auto-sync skips Returned/Delivered orders, so these can't self-correct. `since` limits to
// issues closed on/after a date (keeps it to the relevant window, not years of history).
async function reconcileReturned({ since, businessId } = {}) {
  const params = [];
  const conds = ["o.status = 'Returned'", "di.status IN ('resolved','auto_return')"];
  let i = 0; const p = () => `$${++i}`;
  if (since) { conds.push(`di.resolved_at >= ${p()}`); params.push(since); }
  if (businessId) { conds.push(`o.business_id = ${p()}`); params.push(businessId); }
  const rows = (await query(
    `SELECT DISTINCT o.id, o.tracking_number, o.status, b.id as business_id,
            b.domex_api_key, b.domex_username, b.domex_password
     FROM orders o
     JOIN delivery_issues di ON di.order_id = o.id
     JOIN businesses b ON o.business_id = b.id
     WHERE ${conds.join(' AND ')} AND b.domex_api_key IS NOT NULL AND b.domex_api_key != ''`,
    params)).rows;

  let checked = 0, corrected = 0, stillReturned = 0, notFound = 0;
  const examples = [];
  const BATCH = 10;
  for (let s = 0; s < rows.length; s += BATCH) {
    const batch = rows.slice(s, s + BATCH);
    await Promise.allSettled(batch.map(async order => {
      checked++;
      const biz = { id: order.business_id, domex_api_key: order.domex_api_key, domex_username: order.domex_username, domex_password: order.domex_password };
      const res = await getTrackingStatus(biz, order.tracking_number);
      if (!(res.status === 200 && Array.isArray(res.data) && res.data.length > 0)) { notFound++; return; }
      let deliveredDate = null;
      for (const sObj of res.data) {
        const location = (sObj.status || '').replace(/^.*By\s+/i, '').trim();
        try {
          await query(`INSERT INTO delivery_statuses (order_id, status_code, status_text, location, remark, status_date) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id, status_code, status_date) DO NOTHING`,
            [order.id, sObj.statusCode, sObj.status, location, sObj.remark || '', sObj.statusDate]);
        } catch {}
        if (sObj.statusCode === 'D' || sObj.statusCode === 'PS') deliveredDate = sObj.statusDate;
      }
      let newStatus = null;
      for (let k = res.data.length - 1; k >= 0; k--) {
        const m = mapDomexStatus(res.data[k].statusCode, res.data[k].status);
        if (m !== null) { newStatus = m; break; }
      }
      const branch = deliveryBranchFrom(res.data);
      if (newStatus && newStatus !== 'Returned') {
        await query(`UPDATE orders SET status=$1, delivered_date=COALESCE($2,delivered_date), delivery_branch=COALESCE(NULLIF($3,''),delivery_branch), updated_at=NOW() WHERE id=$4`,
          [newStatus, deliveredDate, branch, order.id]);
        corrected++;
        if (examples.length < 20) examples.push({ tracking_number: order.tracking_number, from: 'Returned', to: newStatus });
      } else {
        stillReturned++;
      }
    }));
    await new Promise(r => setTimeout(r, 200));
  }
  return { total: rows.length, checked, corrected, still_returned: stillReturned, not_found: notFound, examples };
}

async function getSyncStatus() {
  const row = (await query('SELECT last_sync, status, progress, total, updated, errors, not_found, note FROM sync_status WHERE id = 1')).rows[0];
  return {
    last_sync: row?.last_sync || null,
    status: row?.status || 'idle',
    progress: Number(row?.progress || 0),
    total: Number(row?.total || 0),
    updated: Number(row?.updated || 0),
    errors: Number(row?.errors || 0),
    not_found: Number(row?.not_found || 0),
    note: row?.note || null,
    auto_sync_active: !!syncInterval,
  };
}

function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => syncOrders().catch(() => {}), intervalMs);
  console.log(`Domex auto-sync started (every ${intervalMs / 60000} min)`);
}

function stopAutoSync() { if (syncInterval) { clearInterval(syncInterval); syncInterval = null; } }

module.exports = { syncOrders, syncSelectedOrders, detectCouriers, reconcileReturned, startAutoSync, stopAutoSync, getSyncStatus, getTrackingStatus, getWaybillDetails, getDomexToken, mapDomexStatus };
