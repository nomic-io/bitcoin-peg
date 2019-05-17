'use strict'

import { createOutput } from './reserve'
import { ValidatorMap, SignatoryMap } from './types'
import * as bitcoin from 'bitcoinjs-lib'

export function createTx(
  validators: ValidatorMap,
  signatoryKeys: SignatoryMap,
  utxos: bitcoin.TxOutput[],
  destAddress: Buffer
) {
  let tx = new bitcoin.Transaction()

  // add the utxos as inputs

  let amount = 0
  for (let utxo of utxos) {
    tx.addInput(utxo.txid, utxo.vout)
    amount += utxo.value
    if (!Number.isSafeInteger(amount)) {
      throw Error('Amount overflow')
    }
  }

  // TODO: use feeRate param
  amount -= 10000

  // output that pays to the signatory set
  let depositOutput = createOutput(validators, signatoryKeys)
  tx.addOutput(depositOutput, amount)

  // output that commits to a destination address on the peg chain
  let addressOutput = bitcoin.payments.embed({
    data: [destAddress],
    network: bitcoin.networks.testnet // TODO
  }).output
  tx.addOutput(addressOutput, 0)

  return tx
}