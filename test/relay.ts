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
let Blockchain = require('blockchain-spv')
let decodeBitcoinTx = require('bitcoin-protocol').types.transaction.decode
let { getTxHash } = require('bitcoin-net/src/utils.js')

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
    txindex: 1,
    rpcauth:
      'foo:e1fcea9fb59df8b0388f251984fe85$26431097d48c5b6047df8dee64f387f63835c01a2a463728ad75087d0133b8e6'
  })
  await bitcoind.started() //?.
  let rpc = new RPCClient({
    network: 'regtest',
    port: rpcport,
    wallet: 'default',
    username: 'foo',
    password: 'j1DuzF7QRUp-iSXjgewO9T_WT1Qgrtz_XWOHCMn_O-Y='
  })
  await rpc.createWallet('default')
  return { rpc, port, rpcport, node: bitcoind, dataPath }
}

test.beforeEach(async function(t) {
  t.context.bitcoind = await makeBitcoind()
  let rpc = t.context.bitcoind.rpc

  let genesisHash = await rpc.getBestBlockHash()
  let genesisHeader = await rpc.getBlockHeader(genesisHash)

  let app = lotion({
    initialState: {
      bitcoin: {
        headers: [formatHeader(genesisHeader)],
        processedTxs: {},
        _txs: []
      }
    }
  })

  app.use(function(state, tx, context) {
    if (tx.type === 'bitcoin' && tx.headers) {
      try {
        let chain = new Blockchain({
          start: state.bitcoin.headers[0],
          store: state.bitcoin.headers,
          allowMinDifficultyBlocks: true,
          noRetargeting: true
        })

        chain.add(tx.headers)
      } catch (e) {
        console.log(e)
      }
    }
    if (tx.type === 'bitcoin' && tx.proof) {
      let btcTx = decodeBitcoinTx(tx.transactions[0])
      console.log(btcTx)
      let txid = getTxHash(btcTx).toString('hex')
      state.bitcoin.processedTxs[txid] = true
      state.bitcoin._txs.push(btcTx)
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

test.skip('header and deposit relaying', async function(t) {
  let lc = t.context.lotionLightClient
  let rpc = t.context.bitcoind.rpc
  let aliceAddress = await rpc.getNewAddress()
  let depositAddress = await rpc.getNewAddress()

  await rpc.generateToAddress(101, aliceAddress)

  console.log(depositAddress)
  let relay = new Relay({
    bitcoinRPC: t.context.bitcoind.rpc,
    lotionLightClient: lc
    // depositAddress
  })

  await relay.start()

  t.is(await lc.state.bitcoin.headers.length, 1)
  await relay.step()
  t.is(await lc.state.bitcoin.headers.length, 102)
  await rpc.generateToAddress(2, aliceAddress)
  await relay.step()
  t.is(await lc.state.bitcoin.headers.length, 104)

  let latestBlockHashOnBtc = await rpc.getBestBlockHash()
  let latestBtcHeader = await rpc.getBlockHeader(latestBlockHashOnBtc)

  let pegHeaders = await lc.state.bitcoin.headers
  let latestBlockHeaderOnPeg = pegHeaders[pegHeaders.length - 1]
  t.is(latestBlockHeaderOnPeg.timestamp, latestBtcHeader.time)

  t.is(await lc.state.bitcoin._txs.length, 0)
  await rpc.sendToAddress(depositAddress, 10)
  await rpc.generateToAddress(1, aliceAddress)
  await relay.step()
  t.is(await lc.state.bitcoin._txs.length, 1)
  await relay.step()
  // Double check that the deposit transaction is only relayed once:
  t.is(await lc.state.bitcoin._txs.length, 1)
})

function formatHeader(header) {
  return {
    height: Number(header.height),
    version: Number(header.version),
    prevHash: header.previousblockhash
      ? Buffer.from(header.previousblockhash, 'hex').reverse()
      : Buffer.alloc(32),
    merkleRoot: Buffer.from(header.merkleroot, 'hex').reverse(),
    timestamp: Number(header.time),
    bits: parseInt(header.bits, 16),
    nonce: Number(header.nonce)
  }
}
