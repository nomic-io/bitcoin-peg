// import anyTest, { TestInterface } from 'ava'
// let test = anyTest as TestInterface<{
//   bitcoind: any
// }>

// let testnetParams = require('webcoin-bitcoin-testnet')
// let createBitcoind = require('bitcoind')
// let { mkdirSync, removeSync } = require('fs-extra')
// let { tmpdir } = require('os')
// let getPort = require('get-port')
// let { join } = require('path')
// let SPVNode = require('webcoin')

// async function makeBitcoind() {
//   let rpcport = await getPort()
//   let port = await getPort()
//   let dataPath = join(tmpdir(), Math.random().toString(36) + rpcport + port)
//   mkdirSync(dataPath)
//   let bitcoind = createBitcoind({
//     rpcport,
//     port,
//     listen: 1,
//     regtest: true,
//     datadir: dataPath,
//     debug: 1,
//     deprecatedrpc: 'signrawtransaction',
//     txindex: 1
//   })
//   await bitcoind.started()
//   let netinfo = await bitcoind.rpc.getNetworkInfo()
//   console.log(netinfo)
//   return { rpc: bitcoind.rpc, port, rpcport, node: bitcoind, dataPath }
// }
// test.beforeEach(async function(t) {
//   let btcd = await makeBitcoind()
//   t.context.bitcoind = btcd
// })
// test.afterEach.always(async function(t) {
//   t.context.bitcoind.node.kill()
//   removeSync(t.context.bitcoind.dataPath)
// })

// async function getRegtestParams(bitcoind) {
//   let webcoinGenesisHeader = await rpcFetchHeader(bitcoind.rpc)
//   console.log(webcoinGenesisHeader)

//   let regtestParams = Object.assign({}, testnetParams)
//   console.log(regtestParams)

//   regtestParams.net = Object.assign({}, regtestParams.net, {
//     dnsSeeds: [],
//     webSeeds: [],
//     staticPeers: ['localhost'],
//     defaultPort: bitcoind.port,
//     magic: 0xdab5bffa
//   })

//   regtestParams.blockchain = Object.assign({}, regtestParams.blockchain, {
//     genesisHeader: webcoinGenesisHeader,
//     checkpoints: []
//   })

//   return regtestParams
// }

// /**
//  * Given an rpc client, return webcoin-formatted genesis header
//  *
//  */
// async function rpcFetchHeader(rpc) {
//   let genesisHash = await rpc.getBlockHash(0)
//   let genesisBlock = await rpc.getBlock(genesisHash)
//   return formatHeader(genesisBlock)
// }

// /**
//  * rpc header format -> webcoin format
//  */
// function formatHeader(header) {
//   console.log(header)
//   return {
//     height: header.height,
//     version: header.version,
//     prevHash: header.previousblockhash
//       ? Buffer.from(header.previousblockhash, 'hex').reverse()
//       : Buffer.alloc(32),
//     merkleRoot: Buffer.from(header.merkleroot, 'hex').reverse(),
//     timestamp: header.time,
//     bits: parseInt(header.bits, 16),
//     nonce: header.nonce
//   }
// }

// test('regtest node', async function(t) {
//   let btcd = t.context.bitcoind
//   let header = await rpcFetchHeader(btcd.rpc)

//   let regtestParams = await getRegtestParams(btcd)

//   let node = SPVNode({
//     network: 'regtest',
//     params: regtestParams,
//     netOpts: { maxPeers: 1 },
//     chainOpts: {
//       store: [header],
//       maxTarget: Buffer.from(
//         '7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
//         'hex'
//       ),
//       noRetargeting: true,
//       allowMinDifficultyBlocks: true
//     }
//   })

//   node.peers.once('peer', function(peer) {
//     console.log(peer.socket.remoteAddress)
//   })
//   node.start()
//   await delay()
//   t.true(true)
// })

// function delay(ms = 1000) {
//   return new Promise(resolve => setTimeout(resolve, ms))
// }
