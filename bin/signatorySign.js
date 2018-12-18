'use strict'

let bitcoin = require('bitcoinjs-lib')
let secp256k1 = require('secp256k1')
let { connect } = require('lotion')
let {
  buildOutgoingTx,
  getSignatorySet,
  createWitnessScript,
  getSignatories
} = require('../src/reserve.js')

async function main () {
  let gci = process.argv[2]
  let signatoryPriv = process.argv[3]

  if (gci == null || signatoryPriv == null) {
    console.error('usage: node signatory.js <GCI> <priv_validator>')
    process.exit(1)
  }
  signatoryPriv = Buffer.from(signatoryPriv, 'base64')

  let client = await connect(gci)
  console.log('connected to peg zone network')

  let signatoryPub = secp256k1.publicKeyCreate(signatoryPriv)
  let validators = {}
  client.validators.forEach((v) => {
    validators[v.pub_key.value] = v.voting_power
  })
  let signatoryKeys = await client.state.bitcoin.signatoryKeys
  let signatories = getSignatorySet(validators)
  let signatoryIndex
  for (let i = 0; i < signatories.length; i++) {
    let signatory = signatories[i]
    if (signatoryKeys[signatory.validatorKey].equals(signatoryPub)) {
      // found our signatory
      signatoryIndex = i
      break
    }
  }
  if (signatoryIndex == null) {
    console.log('given key not in signatory set')
    process.exit(1)
  }

  let signingTx = await client.state.bitcoin.signingTx
  if (signingTx == null) {
    console.log('no tx to be signed')
    process.exit(0)
  }
  console.log(signingTx)

  let bitcoinTx = buildOutgoingTx(signingTx, validators, signatoryKeys)
  console.log(bitcoinTx)

  let p2ss = createWitnessScript(getSignatories(validators, signatoryKeys))
  let sigHashes = signingTx.inputs.map((input, i) =>
    bitcoinTx.hashForWitnessV0(i, p2ss, input.amount, bitcoin.Transaction.SIGHASH_ALL))
  let signatures = sigHashes.map((hash) => {
    let signature = secp256k1.sign(hash, signatoryPriv).signature
    return secp256k1.signatureExport(signature)
  })

  let tx = {
    type: 'bitcoin',
    signatures,
    signatoryIndex
  }

  let res = await client.send(tx)
  console.log('sent tx', res)

  process.exit(0)
}

main().catch(function (err) { throw err })
