import { lookup as systemLookup } from 'node:dns';
import { isIPv4, Socket } from 'node:net';

// Deliberately not configurable: this is the one approved private demo target.
export const DEMO_DATABASE_HOST = 'pgm-j6cdnxlsd0mjok7u.rwlb.cnhk.rds.aliyuncs.com';
export const DEMO_DATABASE_CIDR = '172.26.0.0/20';

const denied = () =>
  Object.assign(new Error('Private database destination validation failed'), { code: 'EPRIVATEADDRESS' });

export function approvedDatabaseAddress(address) {
  if (typeof address !== 'string' || !isIPv4(address)) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a === 172 && b === 26 && c < 16;
}

// Validate all DNS answers, not just the first. The validated address is handed
// straight to this socket's connect, so there is no second DNS lookup/rebinding
// window. An IPv6, mixed, missing or out-of-subnet answer fails closed.
export function privateDatabaseLookup(resolver = systemLookup) {
  return (hostname, options, callback) => {
    let completed = false;
    const finish = (error, records) => {
      if (completed) return;
      completed = true;
      queueMicrotask(() => {
        if (
          error ||
          !Array.isArray(records) ||
          records.length === 0 ||
          records.some((record) => record?.family !== 4 || !approvedDatabaseAddress(record.address))
        ) {
          callback(denied());
          return;
        }
        const addresses = records.map(({ address }) => ({ address, family: 4 }));
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, 4);
      });
    };
    if (hostname !== DEMO_DATABASE_HOST) return finish(denied());
    try {
      // Do not filter family here: an unexpected AAAA answer must be rejected.
      resolver(hostname, { all: true, verbatim: true }, finish);
    } catch {
      finish(denied());
    }
  };
}

export function createPrivateDatabaseStream({ resolver = systemLookup, createSocket = () => new Socket() } = {}) {
  const socket = createSocket();
  const connect = socket.connect.bind(socket);
  socket.connect = (port, host) => {
    if (port !== 5432 || host !== DEMO_DATABASE_HOST) {
      queueMicrotask(() => socket.destroy(denied()));
      return socket;
    }
    return connect({
      port: 5432,
      host: DEMO_DATABASE_HOST,
      family: 4,
      autoSelectFamily: false,
      lookup: privateDatabaseLookup(resolver),
    });
  };
  return socket;
}
