/* Samsara REST API client. Read-only. The API key comes from the
   SAMSARA_API_TOKEN secret and is never sent to the browser or logged. */
const BASE = process.env.SAMSARA_API_BASE || 'https://api.samsara.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

class SamsaraError extends Error {
  constructor(message, status, path) { super(message); this.status = status; this.path = path; }
}

function token() { return (process.env.SAMSARA_API_TOKEN || '').trim(); }
function hasToken() { return token().length > 0; }

async function get(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' } });
    } catch (e) {
      if (attempt < 3) { await sleep(800 * (attempt + 1)); continue; }
      throw new SamsaraError('Could not reach Samsara. Check the internet connection and try again.', 0, path);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 4) { const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * (attempt + 1); await sleep(Math.min(wait, 15000)); continue; }
    }
    if (!res.ok) {
      let detail = ''; try { const j = await res.json(); detail = j.message || ''; } catch (e) { /* no body */ }
      const msg = res.status === 401 ? 'Samsara rejected the API key. Check the SAMSARA_API_TOKEN secret.'
        : res.status === 403 ? 'The Samsara API key is missing a permission for ' + path + '.'
        : 'Samsara returned an error (' + res.status + ') for ' + path + '.';
      throw new SamsaraError(msg + (detail ? ' ' + detail : ''), res.status, path);
    }
    return res.json();
  }
}

/* newer endpoints: { data: [...], pagination: { endCursor, hasNextPage } } */
async function getAll(path, params) {
  const out = []; let after = null, guard = 0;
  do {
    const j = await get(path, Object.assign({}, params, after ? { after } : {}));
    out.push(...(j.data || []));
    after = j.pagination && j.pagination.hasNextPage ? j.pagination.endCursor : null;
  } while (after && ++guard < 500);
  return out;
}

async function pool(items, n, fn) {
  let i = 0; const errors = [];
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); } catch (e) {
        if (e.status === 401) throw e;
        errors.push(e);
      }
    }
  }));
  return errors;
}

const listVehicles = () => getAll('/fleet/vehicles', { limit: 512 });
async function listDrivers() {
  const [active, inactive] = await Promise.all([
    getAll('/fleet/drivers', { limit: 512 }),
    getAll('/fleet/drivers', { limit: 512, driverActivationStatus: 'deactivated' }).catch(() => [])
  ]);
  return active.concat(inactive);
}

/* Trips for one vehicle. The trips endpoint allows up to 90 days per request. */
async function vehicleTrips(vehicleId, startMs, endMs) {
  const out = []; const span = 80 * 86400000;
  for (let a = startMs; a < endMs; a += span) {
    const j = await get('/v1/fleet/trips', { vehicleId, startMs: a, endMs: Math.min(endMs, a + span) });
    out.push(...(j.trips || []));
  }
  return out;
}

/* Hours-of-service duty status logs for a set of drivers */
async function hosLogs(driverIds, startMs, endMs) {
  const byDriver = {};
  for (let i = 0; i < driverIds.length; i += 50) {
    const rows = await getAll('/fleet/hos/logs', {
      driverIds: driverIds.slice(i, i + 50).join(','),
      startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString()
    });
    for (const r of rows) {
      const id = r.driver && String(r.driver.id); if (!id) continue;
      (byDriver[id] = byDriver[id] || []).push(...(r.hosLogs || []));
    }
  }
  return byDriver;
}

module.exports = { hasToken, get, getAll, pool, listVehicles, listDrivers, vehicleTrips, hosLogs, SamsaraError };
