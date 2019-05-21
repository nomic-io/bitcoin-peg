import * as bitcoinPeg from '../src/index'
import anyTest, { TestInterface } from 'ava'
let test = anyTest as TestInterface<{ bitcoind: any }>
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
  return { rpc: bitcoind.rpc, port: rpcport, node: bitcoind }
}

test.beforeEach(async function(t) {
  let btcd = await makeBitcoind()
  t.context.bitcoind = btcd
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
})

let trustedHeader = {
  version: 1073676288,
  prevHash: Buffer.from(
    '08d61fcf532a044364f0648a41a55bba405d5aa0bf6f415d8402000000000000',
    'hex'
  ),
  merkleRoot: Buffer.from(
    'a4fb1664d00ae4448dbdf8f99f1a78f7c5bb8036fd69d6f34aed5ee62386f65c',
    'hex'
  ),
  timestamp: 1556877853,
  bits: 436373240,
  nonce: 388744679,
  height: 1514016
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

/**
 * Set up local bitcoin fullnode
 */

test('bitcoin headers transaction', async function(t) {
  let btcd = t.context.bitcoind
})
