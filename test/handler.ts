import * as bitcoinPeg from '../src/index'
import * as deposit from '../src/deposit'
import anyTest, { TestInterface } from 'ava'
let test = anyTest as TestInterface<{
  bitcoind: any
  spvNode: any
  lotionApp: any
  lightClient: any
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
import { KeyType } from '../src/types'
import * as seed from 'random-bytes-seed'
import * as relay from '../src/relay'
let { genValidator } = require('tendermint-node')
import ed = require('ed25519-supercop')
import secp = require('secp256k1')
let randomBytes = seed('seed')
let base58 = require('bs58check')
import { ValidatorMap, ValidatorKey, SignatoryMap } from '../src/types'
let SPVNode = require('webcoin-regtest')

// this gets monkey patched in test setup:
let params = require('webcoin-bitcoin-testnet').net
let testnetParams = require('webcoin-bitcoin-testnet')

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

async function makeBitcoind() {
  let rpcport = await getPort()
  let port = await getPort()
  let dataPath = join(tmpdir(), Math.random().toString(36) + rpcport + port)
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
  let netinfo = await bitcoind.rpc.getNetworkInfo()
  console.log(netinfo)
  return { rpc: bitcoind.rpc, port, rpcport, node: bitcoind, dataPath }
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

function monkeyPatchBitcoinNetParams(port) {
  params.dnsSeeds = []
  params.webSeeds = []
  params.staticPeers = ['localhost']
  params.defaultPort = port
  params.magic = 0xdab5bffa
}

test.beforeEach(async function(t) {
  let btcd = await makeBitcoind() //?.
  t.context.bitcoind = btcd
  monkeyPatchBitcoinNetParams(btcd.port)
  let genesisHash = await btcd.rpc.getBlockHash(0)
  let genesisBlock = await btcd.rpc.getBlock(genesisHash)

  t.context.lotionApp = makeLotionApp(genesisBlock)
  let lc: any = await lotion.connect(t.context.lotionApp)
  lc.validators = [
    {
      address: 'B4CD63E54D7FCF52528E8CC5C4DF4EB8B055BEC0',
      pub_key: validatorKey.pub_key,
      power: '10',
      name: '',
      voting_power: 10
    }
  ]
  lc.send = async function send(tx) {
    t.context.lotionApp.run(tx)
    return { check_tx: {}, deliver_tx: {}, height: '42' }
  }
  lc.on = function() {}
  lc.emit = function() {}

  let spvNode = await SPVNode(btcd)

  t.context.spvNode = spvNode
  t.context.lightClient = lc
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
  removeSync(t.context.bitcoind.dataPath)
})

test('bitcoin header and deposit transactions', async function(t) {
  let btcd = t.context.bitcoind
  let app = t.context.lotionApp
  let lc = t.context.lightClient
  let spvClient = t.context.spvNode

  let generatedBlockHashes = await btcd.rpc.generate(102) //?.
  let secondHeader = await btcd.rpc.getBlockHeader(generatedBlockHashes[0])
  let thirdHeader = await btcd.rpc.getBlockHeader(generatedBlockHashes[1])
  let fourthHeader = await btcd.rpc.getBlockHeader(generatedBlockHashes[2])

  t.is(app.state.bitcoin.chain.length, 1)
  let headersTx = {
    type: 'bitcoin',
    headers: [secondHeader].map(formatHeader)
  }
  console.log(app.run(headersTx))
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

  /**
   * Commit to signatory public key
   */
  let signatoryCommitmentTx = buildSignatoryCommitmentTx(
    lotionValidators,
    validatorKey,
    signatoryPub
  )

  let result = await commitPubkey(
    t.context.lightClient,
    validatorKey,
    signatoryPub
  )
  t.is(result.height, '42')
  console.log(app.run(signatoryCommitmentTx))

  let rpcUtxos = await btcd.rpc.listUnspent()
  let utxos = rpcUtxos.map(formatUtxo)
  let coinsPrivkey = randomBytes(32)
  let wallet = coins.wallet(coinsPrivkey, lc, { route: 'mycoin' })
  let destinationCoinsAddress = base58.decode(wallet.address())
  let rawDepositTx = deposit.createBitcoinTx(
    lotionValidators,
    signatories,
    utxos,
    destinationCoinsAddress
  )
  let signedDepositTx = await btcd.rpc.signRawTransaction(rawDepositTx.toHex())
  let depositTxidHex = await btcd.rpc.sendRawTransaction(signedDepositTx.hex)
  let depositTxid = Buffer.from(depositTxidHex, 'hex')
  let [blockHash] = await btcd.rpc.generate(1)

  let relayHeaderResult = await relay.relayHeaders(lc, spvClient)

  t.is(app.state.bitcoin.chain.length, 104)

  let relayDepositResult = await relay.relayDeposits(lc, spvClient) //?.
  let mycoinState = await lc.state.mycoin
  console.log(mycoinState)
  t.is(
    mycoinState.accounts[base58.encode(destinationCoinsAddress)].balance,
    9999990000
  )

  /**
   * Now test withdrawals
   */
  let res = await wallet.send({
    type: 'bitcoin',
    amount: 1e8,
    script: Buffer.from([1, 2, 3, 4])
  })

  t.is(res.height, '42')

  /**
   * Sign disbursal transaction with signatory key
   */
  let signedResponse = await signDisbursal(lc, signatoryKeyPair.privateKey)
  console.log(signedResponse)

  let signedTx = await lc.state.bitcoin.signedTx
  console.log(signedTx)
  let signatoryState = await lc.state.bitcoin.signatoryKeys
  console.log(signatoryState)
  let disbursalTx = relay.buildDisbursalTransaction(
    signedTx,
    lotionValidators,
    signatoryState
  )
  console.log(disbursalTx)

  t.true(true)
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

function formatUtxo(utxo) {
  return {
    vout: utxo.vout,
    txid: Buffer.from(utxo.txid, 'hex').reverse(),
    value: utxo.amount * 1e8
  }
}
