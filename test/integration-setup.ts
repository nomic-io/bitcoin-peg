import * as bitcoinPeg from '../src/index'
import * as deposit from '../src/deposit'
import anyTest, { TestInterface } from 'ava'
let test = anyTest as TestInterface<{
  bitcoind: any
  spvNode: any
  lotionApp: any
  lightClient: any
  relay: any
  alice: any
  bob: any
  carol: any
  miner: any
}>
import * as coins from 'coins'
import lotion = require('lotion-mock')
import createBitcoind = require('bitcoind')
import { tmpdir } from 'os'
let { mkdirSync, removeSync } = require('fs-extra')
import { join } from 'path'
import getPort = require('get-port')
import {
  buildSignatoryCommitmentTx,
  commitPubkey,
  signDisbursal
} from '../src/signatory'
import * as seed from 'random-bytes-seed'
import { Relay } from '../src/relay'
let RPCClient = require('bitcoin-core')
let { genValidator } = require('tendermint-node')
import ed = require('ed25519-supercop')
import secp = require('secp256k1')
let randomBytes = seed('seed')
let base58 = require('bs58check')
import { ValidatorMap, ValidatorKey, SignatoryMap } from '../src/types'

let validatorKey: ValidatorKey = JSON.parse(genValidator()).Key

let lotionValidators: ValidatorMap = {
  [validatorKey.pub_key.value]: 10
}

let randBytes = randomBytes(32)
let signatoryPub = secp.publicKeyCreate(randBytes)

let signatoryKeyPair = {
  publicKey: signatoryPub,
  privateKey: randBytes
}

let signatories: SignatoryMap = {
  [validatorKey.pub_key.value]: signatoryPub
}

async function makeBitcoind(t) {
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

  // Create RPC clients
  t.context.alice = new RPCClient({
    network: 'regtest',
    port: rpcport,
    wallet: 'alice-wallet',
    username: 'foo',
    password: 'j1DuzF7QRUp-iSXjgewO9T_WT1Qgrtz_XWOHCMn_O-Y='
  })

  t.context.bob = new RPCClient({
    network: 'regtest',
    port: rpcport,
    wallet: 'bob-wallet',
    username: 'foo',
    password: 'j1DuzF7QRUp-iSXjgewO9T_WT1Qgrtz_XWOHCMn_O-Y='
  })

  t.context.carol = new RPCClient({
    network: 'regtest',
    port: rpcport,
    wallet: 'carol-wallet',
    username: 'foo',
    password: 'j1DuzF7QRUp-iSXjgewO9T_WT1Qgrtz_XWOHCMn_O-Y='
  })

  t.context.miner = new RPCClient({
    network: 'regtest',
    port: rpcport,
    wallet: 'miner-wallet',
    username: 'foo',
    password: 'j1DuzF7QRUp-iSXjgewO9T_WT1Qgrtz_XWOHCMn_O-Y='
  })

  // Create wallets
  await t.context.alice.createWallet('alice-wallet')
  await t.context.bob.createWallet('bob-wallet')
  await t.context.carol.createWallet('carol-wallet')
  await t.context.miner.createWallet('miner-wallet')

  return { rpc: bitcoind.rpc, port, rpcport, node: bitcoind, dataPath }
}
function makeLotionApp(trustedBtcHeader) {
  let trustedHeader = formatHeader(trustedBtcHeader)
  let app = lotion({
    initialState: {}
  })

  app.use(
    'bitcoin',
    bitcoinPeg(trustedHeader, 'mycoin', { noRetargeting: true })
  )

  let coinsModule: any = coins({
    initialBalances: {},
    handlers: {
      bitcoin: bitcoinPeg.coinsHandler('bitcoin')
    }
  })
  app.use('mycoin', coinsModule)
  app.useBlock(function(state, context) {
    Object.assign(context.validators, lotionValidators)
  })

  app.start()
  return app
}

test.beforeEach(async function(t) {
  let last = Date.now()
  let btcd = await makeBitcoind(t)
  t.context.bitcoind = btcd
  let genesisHash = await btcd.rpc.getBlockHash(0) //?.

  let genesisBlock = await btcd.rpc.getBlock(genesisHash) //?.

  t.context.lotionApp = makeLotionApp(genesisBlock)
  let lc: any = await lotion.connect(t.context.lotionApp) //?.

  t.context.relay = new Relay({
    bitcoinRPC: btcd.rpc,
    lotionLightClient: lc
  })
  t.context.lightClient = lc
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
  removeSync(t.context.bitcoind.dataPath)
})

test.only('sanity', async function(t) {
  t.is(true, true)
})

function formatHeader(header) {
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
