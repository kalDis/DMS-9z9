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
    'D': 'Delivered', 'PS': 'Delivered', 'CRC': 'Delivered', 'CBR': 'Delivered',
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
    await saveSyncStatus(null, 'syncing', 0, 0, 0, 0);

    const businesses = (await query(
      "SELECT id, name, domex_api_key, domex_customer_code FROM businesses WHERE domex_api_key IS NOT NULL AND domex_api_key != '' AND status = 'active'"
    )).rows;

    if (!businesses.length) {
      await saveSyncStatus(new Date().toISOString(), 'success');
      return { updated: 0, total: 0, errors: 0, businesses: 0 };
    }

    let totalUpdated = 0, totalChecked = 0, totalErrors = 0, totalOrders = 0;

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
            const statusResult = await getTrackingStatus(biz.domex_api_key, biz.domex_customer_code, order.tracking_number);
            let waybill = null;
            const needsDetails = !order.customer_name || !order.phone || !order.address || !order.product;
            if (needsDetails) {
              try {
                const wb = await getWaybillDetails(biz.domex_api_key, biz.domex_customer_code, order.tracking_number);
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
                updated_at = NOW()
                WHERE id = $13`,
                [newStatus || order.status, pickupDate, deliveredDate,
                 wbName, wbPhone, wbAddress, wbCity, wbProduct, wbWeight, wbAmount, wbPieces, wbExchange, order.id]);

              if (newStatus && newStatus !== order.status) totalUpdated++;
            }
          } else {
            totalErrors++;
            console.error('Domex sync error:', r.reason?.message);
          }
        }

        if (i + BATCH_SIZE < orders.length) await new Promise(resolve => setTimeout(resolve, 200));

        // Save progress after each batch
        await saveSyncStatus(new Date().toISOString(), 'syncing', totalChecked, totalOrders, totalUpdated, totalErrors);
      }
    }

    const syncTime = new Date().toISOString();
    await saveSyncStatus(syncTime, totalErrors > 0 ? 'partial' : 'success', totalChecked, totalOrders, totalUpdated, totalErrors);
    console.log(`Domex sync: ${totalUpdated}/${totalChecked} updated, ${totalErrors} errors across ${businesses.length} businesses`);
    return { updated: totalUpdated, total: totalChecked, errors: totalErrors, businesses: businesses.length };
  } catch (err) {
    await saveSyncStatus(new Date().toISOString(), 'error', totalChecked, totalOrders, totalUpdated, totalErrors);
    console.error('Domex sync error:', err);
    throw err;
  }
}

async function saveSyncStatus(last_sync, status, progress = 0, total = 0, updated = 0, errors = 0) {
  await query('UPDATE sync_status SET last_sync=$1, status=$2, progress=$3, total=$4, updated=$5, errors=$6 WHERE id=1',
    [last_sync, status, progress, total, updated, errors]);
}

async function getSyncStatus() {
  const row = (await query('SELECT last_sync, status, progress, total, updated, errors FROM sync_status WHERE id = 1')).rows[0];
  return {
    last_sync: row?.last_sync || null,
    status: row?.status || 'idle',
    progress: Number(row?.progress || 0),
    total: Number(row?.total || 0),
    updated: Number(row?.updated || 0),
    errors: Number(row?.errors || 0),
    auto_sync_active: !!syncInterval,
  };
}

function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => syncOrders().catch(() => {}), intervalMs);
  console.log(`Domex auto-sync started (every ${intervalMs / 60000} min)`);
}

function stopAutoSync() { if (syncInterval) { clearInterval(syncInterval); syncInterval = null; } }

module.exports = { syncOrders, startAutoSync, stopAutoSync, getSyncStatus, getTrackingStatus, getWaybillDetails, mapDomexStatus };
