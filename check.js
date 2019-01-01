const request = require('request');
const _ = require('lodash');
const opn = require('opn');

var requests = 0;

if (!process.argv[2] || !process.argv[3]) {
  console.error('Usage: node check.js <seconds_wait> <serverid> <serverid> ....');
  console.info('\nnode check.js 10 1801sk13 1801sk12');
  console.info('Check every 10 seconds for server 1801sk13 and 1801sk12');
  return;
}

var time = process.argv[2]; //in seconds
var servers = process.argv.slice(3);

call();

function call(){
  requests++;
  process.stdout.clearLine();
  process.stdout.write(`Requests: ${requests}. Checking for ${servers.join(', ')} ...\r`);
  request('https://www.ovh.com/engine/api/dedicated/server/availabilities?country=es', { json: true }, (err, res, body) => {
    const nodes = _.filter(body, (item)=>{
      return servers.includes(item.hardware);
    });
    nodeDatacenters = _.map(nodes, (node) => [node.hardware, node.datacenters]);
    availables = _.filter(nodeDatacenters, (node) => {
      return _.filter(node[1], (datacenter)=>{
        return datacenter.availability != 'unavailable';
      }).length > 0
    });
    if (availables[0]) {
      const url = `https://www.kimsufi.com/es/pedido/kemsirve.xml?reference=${availables[0][0]}`;
      process.stdout.write(`Available. Opening: ${url}\r`);
      opn(url);
      return;
    }
    process.stdout.clearLine();
    process.stdout.write(`Requests: ${requests}. Not available. Waiting ${time} seconds...\r`);
    setTimeout(call, time * 1000);
  });
};
