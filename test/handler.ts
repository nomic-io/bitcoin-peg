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
import rimraf = require('rimraf')

async function makeBitcoind() {
  let dataPath = join(tmpdir(), Math.random().toString(36))
  mkdirSync(dataPath)
  let rpcport = await getPort()
  let bitcoind = createBitcoind({
    rpcport,
    listen: 0,
    regtest: true,
    datadir: dataPath,
    debug: 1,
    deprecatedrpc: 'signrawtransaction',
    txindex: 1
  })
  await bitcoind.started()
  return { rpc: bitcoind.rpc, port: rpcport, node: bitcoind, dataPath }
}
function makeLotionApp(trustedBtcHeader) {
  let trustedHeader = formatHeader(trustedBtcHeader)
  console.log(trustedHeader)
  let app = lotion({
    initialState: {}
  })

  app.use(
    'bitcoin',
    bitcoinPeg(trustedHeader, 'mycoin', { noRetargeting: true })
  )

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

  let genesisHash = await btcd.rpc.getBlockHash(0)
  let genesisBlock = await btcd.rpc.getBlock(genesisHash)

  t.context.lotionApp = makeLotionApp(genesisBlock)
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
  rimraf.sync(t.context.bitcoind.dataPath)
})

test('bitcoin headers transaction', async function(t) {
  let btcd = t.context.bitcoind
  let app = t.context.lotionApp

  let generatedBlockHashes = await btcd.rpc.generate(101)
  let bestHash = await btcd.rpc.getBestBlockHash()
  let bestBlock = await btcd.rpc.getBlock(bestHash)
  let genesisHash = await btcd.rpc.getBlockHash(0)
  let genesisHeader = await btcd.rpc.getBlockHeader(genesisHash)
  let secondHeader = await btcd.rpc.getBlockHeader(generatedBlockHashes[0])
  let thirdHeader = await btcd.rpc.getBlockHeader(generatedBlockHashes[1])
  let fourthHeader = await btcd.rpc.getBlockHeader(generatedBlockHashes[2])

  t.is(app.state.bitcoin.chain.length, 1)
  let headersTx = {
    type: 'bitcoin',
    headers: [secondHeader].map(formatHeader)
  }
  app.run(headersTx)
  t.is(app.state.bitcoin.chain.length, 2)

  let errs = app.run({
    type: 'bitcoin',
    headers: [fourthHeader].map(formatHeader)
  })
  t.is(app.state.bitcoin.chain.length, 2)
  t.true(errs[0] !== null)

  app.run({
    type: 'bitcoin',
    headers: [thirdHeader, fourthHeader].map(formatHeader)
  })
  t.is(app.state.bitcoin.chain.length, 4)
})

function formatHeader(header) {
  console.log(header)
  return {
    height: header.height,
    version: header.version,
    prevHash: header.previousblockhash
      ? Buffer.from(header.previousblockhash, 'hex').reverse()
      : Buffer.alloc(32),
    merkleRoot: Buffer.from(header.merkleroot, 'hex').reverse(),
    timestamp: header.time,
    bits: parseInt(header.bits, 16),
    nonce: header.nonce
  }
}
