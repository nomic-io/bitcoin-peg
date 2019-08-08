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
  await bitcoind.rpc.generate(1)
  let netinfo = await bitcoind.rpc.getNetworkInfo()
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

function delay(ms = 1000) {
  return new Promise(resolve => {
    setTimeout(() => resolve(), ms)
  })
}

test.beforeEach(async function(t) {
  let last = Date.now()
  let btcd = await makeBitcoind()
  t.context.bitcoind = btcd
  let genesisHash = await btcd.rpc.getBlockHash(0) //?.

  let genesisBlock = await btcd.rpc.getBlock(genesisHash) //?.

  t.context.lotionApp = makeLotionApp(genesisBlock)
  let lc: any = await lotion.connect(t.context.lotionApp) //?.
  lc.validators = [
    {
      address: 'B4CD63E54D7FCF52528E8CC5C4DF4EB8B055BEC0',
      pub_key: validatorKey.pub_key,
      power: '10',
      name: '',
      voting_power: 10
    }
  ]
  console.log(lc.validators)
  // lc.send = async function send(tx) {
  //   t.context.lotionApp.run(tx)
  //   return { check_tx: {}, deliver_tx: {}, height: '42' }
  // }
  // lc.on = function() {}
  // lc.emit = function() {}

  let spvNode = await SPVNode(btcd)

  t.context.spvNode = spvNode
  t.context.lightClient = lc
})

test.afterEach.always(async function(t) {
  t.context.bitcoind.node.kill()
  removeSync(t.context.bitcoind.dataPath)
})

test.skip('bitcoin header and deposit transactions', async function(t) {
  let btcd = t.context.bitcoind
  let app = t.context.lotionApp
  let lc = t.context.lightClient
  let spvClient = t.context.spvNode

  let generatedBlockHashes = await btcd.rpc.generate(101) //?.
  //t.is(app.state.bitcoin.chain.length, 4)

  /**
   * Commit to signatory public key
   */
  let signatoryCommitmentTx = buildSignatoryCommitmentTx(
    lotionValidators,
    validatorKey,
    signatoryPub
  )

  try {
    let result = await commitPubkey(
      t.context.lightClient,
      validatorKey,
      signatoryPub
    )

    console.log(result)
  } catch (e) {
    console.log(e)
  }

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

  let relayHeaderResult = await relay.relayHeaders(lc, { spvNode: spvClient })

  t.is(app.state.bitcoin.chain.length, 104)

  let relayDepositResult = await relay.relayDeposits(lc, { spvNode: spvClient })
  let mycoinState = await lc.state.mycoin
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

  console.log(res)
  /**
   * Sign disbursal transaction with signatory key
   */
  let signedResponse = await signDisbursal(lc, signatoryKeyPair.privateKey)

  let signedTx = await lc.state.bitcoin.signedTx
  let signatoryState = await lc.state.bitcoin.signatoryKeys
  let disbursalBtcTx = relay.buildDisbursalTransaction(
    signedTx,
    lotionValidators,
    signatoryState
  )

  /**
   * Make sure coins balance decreased after withdrawal
   */
  mycoinState = await lc.state.mycoin
  t.is(
    mycoinState.accounts[base58.encode(destinationCoinsAddress)].balance,
    9899990000
  )

  /**
   * Make sure disbursal transaction is a valid bitcoin transaction
   */
  await btcd.rpc.sendRawTransaction(disbursalBtcTx.toHex())
  t.deepEqual(await btcd.rpc.getRawMempool(), [disbursalBtcTx.getId()])
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

function formatUtxo(utxo) {
  return {
    vout: utxo.vout,
    txid: Buffer.from(utxo.txid, 'hex').reverse(),
    value: utxo.amount * 1e8
  }
}
