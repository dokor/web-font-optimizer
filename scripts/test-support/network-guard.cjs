const blocked = () => { throw new Error('Network access during a scan is forbidden.'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) {
  const api = require(name);
  api.get = blocked;
  api.request = blocked;
}
const net = require('node:net');
net.connect = blocked;
net.createConnection = blocked;
