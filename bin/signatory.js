'use strict'

let { readFileSync } = require('fs')
let { randomBytes, createHash } = require('crypto')
let secp = require('secp256k1')
let ed = require('ed25519-supercop')
let { connect } = require('lotion')

async function main () {
  let gci = process.argv[2]
  let privValidatorPath = process.argv[3]

  if (gci == null || privValidatorPath == null) {
    console.error('usage: node signatory.js <GCI> <priv_validator>')
    process.exit(1)
  }

  let client = await connect(gci)
  console.log('connected to peg zone network')

  // let privKey
  // do {
  //   privKey = randomBytes(32)
  // } while (!secp.privateKeyVerify(privKey))
  let privKey = Buffer.from('LBPpa6mU5J4JK/A2LP5hrrXDxOJv3d+gCOROwQyWjNo=', 'base64')
  console.log('generated signatory privkey:', privKey.toString('base64'))

  // pubkey
  let signatoryKey = secp.publicKeyCreate(privKey)

  let validatorJSON = readFileSync(privValidatorPath, 'utf8')
  let validator = JSON.parse(validatorJSON)
  let validatorPriv = Buffer.from(validator.priv_key.value, 'base64')
  let validatorPub = Buffer.from(validator.pub_key.value, 'base64')
  let convertedPriv = convertEd25519(validatorPriv)

  let signature = ed.sign(signatoryKey, validatorPub, convertedPriv)

  // TODO: locate our validator key in validators array
  let signatoryIndex = 0

  let tx = {
    type: 'bitcoin',
    signatoryIndex,
    signatoryKey,
    signature
  }

  let res = await client.send(tx)

  console.log('sent tx', res)

  process.exit(0)
}

function sha512 (data) {
  return createHash('sha512').update(data).digest()
}

function convertEd25519 (ref10Priv) {
  // see https://github.com/orlp/ed25519/issues/10#issuecomment-242761092
  let privConverted = sha512(ref10Priv.slice(0, 32))
  privConverted[0] &= 248
  privConverted[31] &= 63
  privConverted[31] |= 64
  return privConverted
}

main().catch(function (err) { throw err })
