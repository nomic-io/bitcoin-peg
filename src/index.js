'use strict'

const Blockchain = require('blockchain-spv')
const verifyMerkleProof = require('bitcoin-merkle-proof').verify
const protocol = require('bitcoin-protocol')
const coins = require('coins')
const ed25519 = require('supercop.js')
const bitcoin = require('bitcoinjs-lib')
// TODO: try to load native ed25519 module
const { getSignatorySet } = require('./reserve.js')
const deposit = require('./deposit.js')

// TODO: get this from somewhere else
const { getTxHash } = require('bitcoin-net/src/utils.js')

const SIGNATORY_KEY_LENGTH = 33
const SIGNATURE_LENGTH = 64

module.exports = function (initialHeader, coinName) {
  if (!initialHeader) {
    throw Error('"initialHeader" argument is required')
  }
  if (!coinName) {
    throw Error('"coinName" argument is required')
  }
  // TODO: use nested routing for different tx types

  function txHandler (state, tx, context) {
    if (tx.headers) {
      // headers tx, add headers to chain
      headersTx(state, tx, context)
    } else if (tx.transactions) {
      // deposit tx, verify tx and collect UTXO(s)
      depositTx(state, tx, context)
    } else if (tx.signatoryKey) {
      // signatory key tx, add validator's pubkey to signatory set
      signatoryKeyTx(state, tx, context)
    } else {
      throw Error('Unknown transaction type')
    }
  }

  function initializer (state) {
    state.chain = [ initialHeader ]
    state.signatoryKeys = {}
    state.processedTxs = {}
    state.utxos = []
  }

  function headersTx (state, tx, context) {
    let chain = Blockchain({
      store: state.chain,
      // TODO: disable for mainnet
      allowMinDifficultyBlocks: true
    })
    chain.add(tx.headers)
  }

  function depositTx (state, tx, context) {
    // get specified block header from state
    let chain = Blockchain({ store: state.chain })
    let header = chain.getByHeight(tx.height)

    // verify proof is connected to block, and is valid
    tx.proof.merkleRoot = header.merkleRoot
    let txids = verifyMerkleProof(tx.proof)

    // process each transaction
    let i = 0
    for (let txBytes of tx.transactions) {
      // decode transaction
      let bitcoinTx = protocol.types.transaction.decode(txBytes)

      // get hash of tx
      let txid = getTxHash(bitcoinTx)
      let txidBase64 = txid.toString('base64')

      // verify tx hasn't already been processed
      if (state.processedTxs[txidBase64]) {
        throw Error('Deposit transaction has already been processed')
      }
      state.processedTxs[txidBase64] = true

      // verify tx hash is included in proof
      if (!txids[i].equals(txid)) {
        throw Error('Transaction does not match proof')
      }
      i += 1

      // verify tx format
      // TODO: use a format that supports joining deposits for multiple people
      if (bitcoinTx.outs.length !== 2) {
        throw Error('Deposit tx should have exactly 2 outputs')
      }
      // verify first output pays to signatory set
      // TODO: compare against older validator sets
      let expectedP2ss = deposit.createOutput(context.validators, state.signatoryKeys)
      let depositOutput = bitcoinTx.outs[0]
      if (!depositOutput.script.equals(expectedP2ss)) {
        throw Error('Invalid deposit output')
      }
      // verify second output commits to recipient address
      let addressHash = bitcoin.payments.embed({
        output: bitcoinTx.outs[1].script
      }).data[0]
      if (addressHash.length !== 20) {
        throw Error('Invalid recipient address commitment output')
      }

      // verify tx is confirmed deep enough
      // TODO
      // TODO: use heuristic based on value

      // mint satoshis for recipient address
      context.modules[coinName].mint({
        type: 'accounts',
        address: coins.hashToAddress(addressHash),
        amount: depositOutput.value
      })
      console.log('minting ' + depositOutput.value + ' for ' + coins.hashToAddress(addressHash))

      // add deposit outpoint to reserve wallet
      state.utxos.push({
        txid,
        index: 0,
        amount: depositOutput.value
      })
    }
  }

  function signatoryKeyTx (state, tx, context) {
    let {
      signatoryIndex,
      signatoryKey,
      signature
    } = tx

    if (!Number.isInteger(signatoryIndex)) {
      throw Error('Invalid signatory index')
    }
    if (!Buffer.isBuffer(signatoryKey)) {
      throw Error('Invalid signatory key')
    }
    if (signatoryKey.length !== SIGNATORY_KEY_LENGTH) {
      throw Error('Invalid signatory key length')
    }
    if (!Buffer.isBuffer(signature)) {
      throw Error('Invalid signature')
    }
    if (signature.length !== SIGNATURE_LENGTH) {
      throw Error('Invalid signatory key length')
    }

    // get validator's public key
    let signatorySet = getSignatorySet(context.validators)
    let validatorKeyBase64 = signatorySet[signatoryIndex].validatorKey
    if (validatorKeyBase64 == null) {
      throw Error('Invalid signatory index')
    }
    let validatorKey = Buffer.from(validatorKeyBase64, 'base64')

    if (!ed25519.verify(signature, signatoryKey, validatorKey)) {
      throw Error('Invalid signature')
    }

    // add signatory key to state
    state.signatoryKeys[validatorKeyBase64] = signatoryKey
  }

  return [
    { type: 'initializer', middleware: initializer },
    { type: 'tx', middleware: txHandler },
  ]
  // return {
  //   initializer,
  //   txHandler,
  //
  //   // handler for 'coins'
  //   coinHandler: () => ({
  //     // withdraw
  //     onOutput () {
  //       throw Error('Withdraw not yet implemented')
  //     }
  //   })
  // }
}
