import { Relay } from '../src/relay'
let lotion = require('lotion-mock')
import anyTest, { TestInterface } from 'ava'
let test = anyTest as TestInterface<{
  lotionApp: any
  lotionLightClient: any
  bitcoind: any
}>
let getPort = require('get-port')
let { join } = require('path')
let { mkdirSync, removeSync } = require('fs-extra')
let createBitcoind = require('bitcoind')
let { tmpdir } = require('os')
let RPCClient = require('bitcoin-core')

async function makeBitcoind() {
  let rpcport = await getPort()
  let port = await getPort()
  let dataPath = join(tmpdir(), Math.random().toString(36) + rpcport + port)
  console.log('data path:' + dataPath)
  mkdirSync(dataPath)
  let bitcoind = createBitcoind({
    rpcport,
    port,
    listen: 1,
    regtest: true,
    datadir: dataPath,
    debug: 1,
    deprecatedrpc: 'signrawtransaction',
    txindex: 1
  })
  await bitcoind.started() //?.
  let rpc = new RPCClient({
    network: 'regtest',
    port: rpcport
  })
  return { rpc, port, rpcport, node: bitcoind, dataPath }
}

test.beforeEach(async function(t) {
  t.context.bitcoind = await makeBitcoind()
  let app = lotion({
    initialState: { headers: [] }
  })

  app.use(function(state, tx, context) {
    if (tx.type === 'header') {
      state.headers.push(tx.header)
    }
  })

  app.start()
  let lc = await lotion.connect(app)
  t.context.lotionLightClient = lc
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
  removeSync(t.context.bitcoind.dataPath)
})

test.only('basic relaying', async function(t) {
  let lc = t.context.lotionLightClient
  console.log(t.context.bitcoind.rpc)

  let relay = new Relay({
    bitcoinRPC: t.context.bitcoind.rpc,
    lotionLightClient: lc
  })

  let stepResult = await relay.step()
  t.is(true, true)
})
