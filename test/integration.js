'use strict'

const { writeFileSync, mkdirSync } = require('fs')
const { randomBytes } = require('crypto')
const { join } = require('path')
const { tmpdir } = require('os')
const test = require('ava')
const secp = require('secp256k1')
const createBitcoind = require('bitcoind')
const lotion = require('lotion')
const tendermint = require('tendermint-node')
const coins = require('coins')
const peg = require('..')

// TODO: don't monkey patch, let us pass in regtest params to webcoin
const params = require('webcoin-bitcoin-testnet').net
params.dnsSeeds = []
params.webSeeds = []
params.staticPeers = [ 'localhost' ]
params.defaultPort = 18444
params.magic = 0xdab5bffa

test('integration (bitcoind + lotion app + relayers)', async (t) => {
  let dataPath = join(tmpdir(), Math.random().toString(36))
  let bitcoinPath = join(dataPath, 'bitcoin')
  mkdirSync(dataPath)
  mkdirSync(bitcoinPath)
  console.log('set up data dir:', dataPath)

  let bitcoind = createBitcoind({
    regtest: true,
    datadir: bitcoinPath,
    debug: 1
  })
  await bitcoind.started()
  console.log('started bitcoind')

  await bitcoind.rpc.generate(200)
  let genesisHash = await bitcoind.rpc.getBlockHash(0)
  let genesisBlockRpc = await bitcoind.rpc.getBlock(genesisHash)
  let genesisBlock = {
    height: 0,
    bits: parseInt(genesisBlockRpc.bits, 16),
    nonce: genesisBlockRpc.nonce,
    version: genesisBlockRpc.version,
    merkleRoot: Buffer.from(genesisBlockRpc.merkleroot, 'hex').reverse(),
    timestamp: genesisBlockRpc.time,
    prevHash: Buffer.alloc(32)
  }
  console.log('generated bitcoin blocks')

  let privValidatorJson = tendermint.genValidator()
  let privValidator = JSON.parse(privValidatorJson)
  let privValidatorPath = join(dataPath, 'priv_validator.json')
  let genesisPath = join(dataPath, 'genesis.json')
  writeFileSync(privValidatorPath, privValidatorJson)
  writeFileSync(genesisPath, createGenesis(privValidator))
  console.log('created genesis and priv_validator')

  let app = lotion({
    initialState: {},
    keyPath: privValidatorPath,
    genesisPath: genesisPath
  })
  app.use('bitcoin', peg(genesisBlock, 'pbtc', {
    noRetargeting: true
  }))
  app.use('pbtc', coins({
    handlers: {
      bitcoin: peg.coinsHandler('bitcoin')
    }
  }))
  let appInfo = await app.start()
  console.log('started lotion app')

  await new Promise((resolve) => setTimeout(resolve, 1000))
  let client = await lotion.connect(appInfo.GCI)
  console.log('connected lotion client')

  // check initial peg state
  deepEqual(t, await client.state.bitcoin, {
    chain: [ genesisBlock ],
    processedTxs: {},
    signatoryKeys: {},
    signedTx: null,
    signingTx: null,
    utxos: [],
    withdrawals: []
  })

  // signatory key commitment
  t.deepEqual(await client.state.bitcoin.signatoryKeys, {})
  let signatoryPriv = randomBytes(32)
  let signatoryPub = secp.publicKeyCreate(signatoryPriv)
  await peg.signatory.commitPubkey(client, privValidator, signatoryPub)
  let signatoryKeyState = await client.state.bitcoin.signatoryKeys
  t.is(Object.keys(signatoryKeyState).length, 1)
  t.true(signatoryKeyState[privValidator.pub_key.value].equals(signatoryPub), 'signatory key is in state')
  console.log('committed signatory key')

  // header relay
  await peg.relay.relayHeaders(client, {
    netOpts: { numPeers: 1 },
    chainOpts: {
      maxTarget: Buffer.from('7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex'),
      noRetargeting: true
    }
  })
  t.is(await client.state.bitcoin.chain.length, 201)
  console.log('relayed bitcoin headers')

  // cleanup
  bitcoind.kill()
})

function createGenesis (privValidator) {
  return `
    {
      "genesis_time": "2019-01-03T18:15:05.000Z",
      "chain_id": "bitcoin-peg",
      "consensus_params": {
        "block_size_params": {
          "max_bytes": "22020096",
          "max_gas": "-1"
        },
        "evidence_params": {
          "max_age": "100000"
        }
      },
      "validators": [
        {
          "address": "${privValidator.address}",
          "pub_key": {
            "type": "tendermint/PubKeyEd25519",
            "value": "${privValidator.pub_key.value}"
          },
          "power": "10",
          "name": ""
        }
      ],
      "app_hash": ""
    }
  `
}

// deep equal that supports Buffers
function deepEqual (t, a, b) {
  function clone (src) {
    let dest = {}
    for (let [ key, value ] in Object.entries(src)) {
      if (Buffer.isBuffer(value)) {
        dest[key] = ':Buffer:' + value.toString('hex')
      } else if (typeof value === 'object' && value != null) {
        dest[key] = clone(value)
      } else {
        dest[key] = value
      }
    }
    return dest
  }

  let a2 = clone(a)
  let b2 = clone(b)
  return t.deepEqual(a2, b2)
}
