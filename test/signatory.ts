import test from 'ava'
import { commitPubkey } from '../src/signatory'
import { KeyType } from '../src/types'
import * as seed from 'random-bytes-seed'
import ed = require('ed25519-supercop')
import secp = require('secp256k1')
let randomBytes = seed('seed')

let keypair = ed.createKeyPair(randomBytes(32))
let validatorKey = {
  priv_key: {
    type: KeyType.Ed25519,
    value: keypair.secretKey.toString('base64')
  },
  pub_key: {
    type: KeyType.Ed25519,
    value: keypair.publicKey.toString('base64')
  }
}

let mockedLotionClient = {
  async send(tx) {
    return { check_tx: {}, deliver_tx: {}, height: '42' }
  },
  validators: [
    {
      address: 'B4CD63E54D7FCF52528E8CC5C4DF4EB8B055BEC0',
      pub_key: validatorKey.pub_key,
      power: '10',
      name: '',
      voting_power: 10
    }
  ]
}

let randBytes = randomBytes(32)
let signatoryPub = secp.publicKeyCreate(randBytes)

test('committing to a signatory key', async function(t) {
  let result = await commitPubkey(
    mockedLotionClient,
    validatorKey,
    signatoryPub
  )
  t.is(result.height, '42')
})
