'use strict'
import * as bitcoin from 'bitcoinjs-lib'

import { createOutput } from './reserve'
import { BitcoinNetwork, SignatoryMap, ValidatorMap } from './types'

export function createBitcoinTx(
  validators: ValidatorMap,
  signatoryKeys: SignatoryMap,
  utxos: any,
  destAddress: Buffer,
  network: BitcoinNetwork
): bitcoin.Transaction {
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
  let depositOutput = createOutput(validators, signatoryKeys, network)
  try {
    tx.addOutput(depositOutput, amount)
  } catch (e) {
    console.log(e.stack)
  }

  // output that commits to a destination address on the peg chain
  let addressOutput = bitcoin.payments.embed({
    data: [destAddress],
    network: bitcoin.networks[network]
  }).output
  tx.addOutput(addressOutput, 0)

  return tx
}
