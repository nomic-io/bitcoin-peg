'use strict'

const { Transaction, payments } = require('bitcoinjs-lib')
const createWitnessScript = require('./reserve.js')

const MAX_SIGNATORIES = 76

function getSignatorySet (validators) {
  let entries = Object.entries(validators)
  entries.sort((a, b) => {
    // sort by voting power, breaking ties with pubkey
    let cmp = b[1] - a[1]
    if (cmp === 0) {
      cmp = b[0] < a[0] ? 1 : -1
    }
    return cmp
  })
  return entries
    .map(([ validatorKey, votingPower ]) =>
      ({ validatorKey, votingPower }))
    .slice(0, MAX_SIGNATORIES)
}

function buildDepositTx (utxos, pegAddress, validators, signatoryKeys) {
  let tx = new Transaction()

  // add utxos as inputs to the deposit tx
  let inputAmount = 0
  for (let utxo of utxos) {
    // TODO
    // tx.addInput(txid, utxo.vout)
    inputAmount += utxo.amount
  }

  // output which pays to signatory set
  let signatories = getSignatorySet(validators)
    .map(({ validatorKey, votingPower }) => {
      let validatorKeyBase64 = validatorKey.toString('base64')
      let pubkey = signatoryKeys[validatorKeyBase64]
      return { pubkey, votingPower }
    })
    .filter((s) => s.pubkey != null)
  // p2ss = pay to signatory set
  let p2ss = { output: createWitnessScript(signatories) }
  let p2wsh = payments.p2wsh({ redeem: p2ss })
  tx.addOutput(p2wsh.output, inputAmount)

  // output which commits to peg destination address
  let pegAddressScript = payments.embed({ data: [ pegAddress ] })
  tx.addOutput(pegAddressScript.output, 0)

  // TODO: calculate fee, deduct fee from deposit output

  return tx
}

console.log(buildDepositTx([], Buffer.from('test', 'utf8'), { foo: 123 }, { foo: 'face' }))
