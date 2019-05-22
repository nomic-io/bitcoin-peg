import * as bitcoinPeg from '../src/index'
import anyTest, { TestInterface } from 'ava'
let test = anyTest as TestInterface<{ bitcoind: any; lotionApp: any }>
import * as coins from 'coins'
import lotion = require('lotion-mock')
import createBitcoind = require('bitcoind')
import { tmpdir } from 'os'
import { mkdirSync } from 'fs'
import { join } from 'path'
import getPort = require('get-port')

async function makeBitcoind() {
  let dataPath = join(tmpdir(), Math.random().toString(36))
  mkdirSync(dataPath)
  let rpcport = await getPort()
  let bitcoind = createBitcoind({
    rpcport,
    listen: 0,
    regtest: false,
    datadir: dataPath,
    debug: 1,
    deprecatedrpc: 'signrawtransaction',
    txindex: 1
  })
  await bitcoind.started()
  return { rpc: bitcoind.rpc, port: rpcport, node: bitcoind, dataPath }
}
function makeLotionApp(trustedBtcHeader) {
  let trustedHeader = {
    version: trustedBtcHeader.version,
    merkleRoot: Buffer.from(trustedBtcHeader.merkleroot, 'hex'),
    timestamp: trustedBtcHeader.time,
    bits: trustedBtcHeader.bits, // check on whether this is the right base / type
    nonce: trustedBtcHeader.nonce,
    height: trustedBtcHeader.height
  }
  let app = lotion({
    initialState: {}
  })

  app.use('bitcoin', bitcoinPeg(trustedHeader, 'mycoin'))

  app.use(
    'mycoin',
    coins({
      initialBalances: {},
      handlers: {
        bitcoin: bitcoinPeg.coinsHandler('bitcoin')
      }
    })
  )

  app.start()
  return app
}

test.beforeEach(async function(t) {
  let btcd = await makeBitcoind()
  t.context.bitcoind = btcd

  await btcd.rpc.generate(1)
  let genesisHash = await btcd.rpc.getBlockHash(0)
  let genesisBlock = await btcd.rpc.getBlock(genesisHash)

  t.context.lotionApp = makeLotionApp(genesisBlock)
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
})

test('bitcoin headers transaction', async function(t) {
  let btcd = t.context.bitcoind
  let netInfo = await btcd.rpc.getNetworkInfo()
  console.log(netInfo)
  let genesisHash = await btcd.rpc.getBlockHash(0)
  console.log(genesisHash)
  let genesisBlock = await btcd.rpc.getBlock(genesisHash)
  console.log(genesisBlock)

  t.true(true)
})
