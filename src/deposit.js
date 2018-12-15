'use strict'

const {
  Transaction,
  payments,
  networks,
  script
} = require('bitcoinjs-lib')
const {
  createWitnessScript,
  getSignatorySet
} = require('./reserve.js')

function createOutput (validators, signatoryKeys) {
  // get signatory key for each signatory
  let signatories = getSignatorySet(validators)
    .map(({ validatorKey, votingPower }) => {
      let pubkey = signatoryKeys[validatorKey]
      if (pubkey) {
        pubkey = pubkey.toString('hex')
      }
      return { pubkey, votingPower }
    })
    .filter((s) => s.pubkey != null)

  // p2ss = pay to signatory set
  let p2ss = { output: createWitnessScript(signatories) }

  return payments.p2wsh({
    redeem: p2ss,
    network: networks.testnet // TODO
  }).output
}

module.exports = {
  createOutput
}
