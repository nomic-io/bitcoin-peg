'use strict'

const { createHash } = require('crypto')
const ed = require('ed25519-supercop')
const secp = require('secp256k1')

async function commitPubkey (client, privValidator, signatoryPub) {
  if (!secp.publicKeyVerify(signatoryPub)) {
    throw Error('Invalid signatory public key')
  }

  // locate our validator key in validators array
  let signatoryIndex
  for (let i = 0; i < client.validators.length; i++) {
    let validator = client.validators[i]
    if (validator.pub_key.value === privValidator.pub_key.value) {
      signatoryIndex = i
      break
    }
  }
  if (signatoryIndex == null) {
    throw Error('Given validator key not found in validator set')
  }

  let signature = sign(privValidator, signatoryPub)

  let res = await client.send({
    type: 'bitcoin',
    signatoryIndex,
    signatoryKey: signatoryPub,
    signature
  })
  if (res.check_tx.code || res.deliver_tx.code) {
    let log = res.check_tx.log || res.deliver_tx.log
    throw Error(`Error sending signatory key commitment transaction: ${log}`)
  }
  return res
}

function sha512 (data) {
  return createHash('sha512').update(data).digest()
}

function sign (privValidator, message) {
  if (privValidator.priv_key.type !== 'tendermint/PrivKeyEd25519') {
    throw Error('Expected privkey type "tendermint/PrivKeyEd25519"')
  }

  let pub = Buffer.from(privValidator.pub_key.value, 'base64')
  let ref10Priv = Buffer.from(privValidator.priv_key.value, 'base64')
  let priv = convertEd25519(ref10Priv)

  return ed.sign(message, pub, priv)
}

// TODO: move this somewhere else
function convertEd25519 (ref10Priv) {
  // see https://github.com/orlp/ed25519/issues/10#issuecomment-242761092
  let privConverted = sha512(ref10Priv.slice(0, 32))
  privConverted[0] &= 248
  privConverted[31] &= 63
  privConverted[31] |= 64
  return privConverted
}

module.exports = {
  commitPubkey,
  convertEd25519
}
