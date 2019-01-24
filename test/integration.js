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

test('integration (bitcoind + lotion app + relayers)', async (t) => {
  let dataPath = join(tmpdir(), Math.random().toString(36))
  let bitcoinPath = join(dataPath, 'bitcoin')
  mkdirSync(dataPath)
  mkdirSync(bitcoinPath)
  console.log('set up data dir:', dataPath)

  let bitcoind = createBitcoind({
    regtest: true,
    datadir: bitcoinPath
  })
  await bitcoind.started()
  console.log('set up bitcoind')

  await bitcoind.rpc.generate(200)
  let genesisHash = await bitcoind.rpc.getBlockHash(0)
  let genesisBlock = await bitcoind.rpc.getBlock(genesisHash)
  genesisBlock.merkleRoot = Buffer.from(genesisBlock.merkleroot, 'hex')
  genesisBlock.timestamp = genesisBlock.time
  genesisBlock.prevHash = Buffer.alloc(32)
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
  app.use('bitcoin', peg(genesisBlock, 'pbtc'))
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

  // signatory key commitment
  t.deepEqual(await client.state.bitcoin.signatoryKeys, {})
  let signatoryPriv = randomBytes(32)
  let signatoryPub = secp.publicKeyCreate(signatoryPriv)
  await peg.signatory.commitPubkey(client, privValidator, signatoryPub)
  let signatoryKeyState = await client.state.bitcoin.signatoryKeys
  t.is(Object.keys(signatoryKeyState).length, 1)
  t.true(signatoryKeyState[privValidator.pub_key.value].equals(signatoryPub), 'signatory key is in state')

  // header relay

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
