const Blockchain = require('blockchain-spv')
const verifyMerkleProof = require('bitcoin-merkle-proof').verify
const protocol = require('bitcoin-protocol')
const coins = require('coins')
let ed25519 = require('supercop.js')
try {
  ed25519 = require('ed25519-supercop')
} catch (err) {}
const secp256k1 = require('secp256k1')
import * as bitcoin from 'bitcoinjs-lib'
import {
  createWitnessScript,
  getSignatorySet,
  buildOutgoingTx,
  createOutput,
  getVotingPowerThreshold,
  getP2ssInfo
} from './reserve'

import {
  BitcoinNetwork,
  Header,
  BitcoinPegState,
  BitcoinPegTx,
  BitcoinPegContext,
  BitcoinPegHeadersTx,
  isHeadersTx,
  isDepositTx,
  BitcoinPegSignatoryCommitmentTx,
  isSignatoryCommitmentTx,
  isSignatureTx,
  BitcoinPegSignatureTx,
  SignatorySet,
  BitcoinPegDepositTx
} from './types'
// TODO: get this from somewhere else
const { getTxHash } = require('bitcoin-net/src/utils.js')

const SIGNATORY_KEY_LENGTH = 33

const MIN_WITHDRAWAL = 2500 // in satoshis

const MAX_HEADERS = 4032

let bitcoinPeg: any = function(
  initialHeader: Header,
  coinName: string,
  network: BitcoinNetwork
) {
  if (!initialHeader) {
    throw Error('"initialHeader" argument is required')
  }
  if (initialHeader.height % 2016 !== 0) {
    throw new Error('"initialHeader.height" must be divisible by 2016')
  }
  if (!coinName) {
    throw Error('"coinName" argument is required')
  }
  // TODO: use nested routing for different tx types
  function initializer(state: BitcoinPegState) {
    console.log('called bitcoin peg initializer')
    // bitcoin blockchain headers (so we can SPV-verify txs)
    state.chain = [initialHeader]

    // index of transactions we have already processed, to prevent replaying
    // relayed txs
    state.processedTxs = {}

    // queue of withdrawals to be processed in the next disbursal
    state.withdrawals = []

    // map of p2ss address -> signatory set data
    state.signatorySets = {}
  }

  function txHandler(
    state: BitcoinPegState,
    tx: BitcoinPegTx,
    context: BitcoinPegContext
  ) {
    if (isHeadersTx(tx)) {
      // headers tx, add headers to chain
      headersTx(state, tx, context)
    } else if (isDepositTx(tx)) {
      // deposit tx, verify tx and collect UTXO(s)
      depositTx(state, tx, context)
    } else if (isSignatoryCommitmentTx(tx)) {
      // signatory key tx, add validator's pubkey to signatory set
      signatoryKeyTx(state, tx, context)
    } else if (isSignatureTx(tx)) {
      // signature tx, add signatory's sig to outgoing transaction
      signatureTx(state, tx, context)
    } else {
      throw Error('Unknown transaction type')
    }
  }

  // headers being relayed to this chain,
  // verify and add to state
  function headersTx(
    state: BitcoinPegState,
    tx: BitcoinPegHeadersTx,
    context: BitcoinPegContext
  ) {
    let chain = Blockchain({
      network,
      store: state.chain
    })
    // TODO: pass in block timestamp to use current time in verification
    chain.add(tx.headers)

    // truncate length of headers array
    if (state.chain.length > MAX_HEADERS) {
      let removeCount = state.chain.length - MAX_HEADERS
      state.chain.splice(0, removeCount)
    }
  }

  // deposit transaction(s) being relayed to this chain,
  // verify merkle proof against a block header (SPV).
  // then mint new coins to the recipient
  function depositTx(
    state: BitcoinPegState,
    tx: BitcoinPegDepositTx,
    context: BitcoinPegContext
  ) {
    // get specified block header from state
    // TODO: make this into a static blockchain-spv function
    let chain = Blockchain({ store: state.chain })
    let header = chain.getByHeight(tx.height)

    // verify proof is connected to block, and is valid
    tx.proof.merkleRoot = header.merkleRoot
    let txids = verifyMerkleProof(tx.proof)

    // process each transaction
    let i = 0
    for (let txBytes of tx.transactions) {
      // decode transaction
      let bitcoinTx: Transaction = protocol.types.transaction.decode(txBytes)

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
      let expectedP2ss = createOutput(
        context.validators,
        state.signatorySets[state.currentP2ssAddress].signatoryKeys,
        network
      )
      let depositOutput: any = bitcoinTx.outs[0]
      if (!depositOutput.script.equals(expectedP2ss)) {
        throw Error('Invalid deposit output')
      }
      // verify second output commits to recipient address
      let secondOutput = bitcoinTx.outs[1]
      let { data } = bitcoin.payments.embed({
        output: secondOutput.script
      })
      if (typeof data === 'undefined') {
        throw new Error(
          'Second output of Bitcoin tx should commit to coins address'
        )
      }
      let addressHash = data[0]
      if (!addressHash || addressHash.length !== 20) {
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
      console.log(depositOutput)
      console.log(
        'minting ' +
          depositOutput.value +
          ' for ' +
          coins.hashToAddress(addressHash)
      )

      // add deposit outpoint to reserve wallet
      state.signatorySets[state.currentP2ssAddress].utxos.push({
        txid,
        index: 0,
        amount: depositOutput.value
      })
    }
  }

  // signatory key commitment, signed by a validator who is in the signatory
  // set. we have to do this because tendermint validators use ed25519 keys,
  // while for bitcoin we need secp256k1 keys.
  function signatoryKeyTx(
    state: BitcoinPegState,
    tx: BitcoinPegSignatoryCommitmentTx,
    context: BitcoinPegContext
  ) {
    let { signatoryIndex, signatoryKey, signature } = tx

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

    // get validator's public key
    let signatorySet = getSignatorySet(context.validators)
    let signatory = signatorySet[signatoryIndex]
    if (signatory == null) {
      throw Error('Invalid signatory index')
    }
    let validatorKeyBase64 = signatory.validatorKey
    let validatorKey = Buffer.from(validatorKeyBase64, 'base64')

    if (!ed25519.verify(signature, signatoryKey, validatorKey)) {
      throw Error('Invalid signature')
    }

    let previousSignatorySetKeys = state.currentP2ssAddress
      ? state.signatorySets[state.currentP2ssAddress].signatoryKeys
      : {}
    // construct new signatory set
    let newSignatorySet: SignatorySet = {
      utxos: [],
      validators: context.validators,
      prevSignedTx: null,
      signedTx: null,
      signingTx: null,
      signatoryKeys: {
        ...previousSignatorySetKeys,
        [validatorKeyBase64]: signatoryKey
      }
    }

    let p2ssInfo = getP2ssInfo(newSignatorySet, network)
    state.signatorySets[p2ssInfo.address] = newSignatorySet
    state.currentP2ssAddress = p2ssInfo.address
  }

  // signature tx, add signatory's sig to outgoing transaction
  function signatureTx(
    state: BitcoinPegState,
    tx: BitcoinPegSignatureTx,
    context: BitcoinPegContext
  ) {
    let { signatoryIndex, signatures } = tx
    let currentSignatorySet = state.signatorySets[state.currentP2ssAddress]
    let { signingTx } = currentSignatorySet

    if (signingTx == null) {
      throw Error('No pending outgoing transaction')
    }
    if (signingTx.signatures[signatoryIndex] != null) {
      throw Error('Signatures for this signatory already exist')
    }

    if (!Number.isInteger(signatoryIndex)) {
      throw Error('Invalid signatory index')
    }
    if (!Array.isArray(signatures)) {
      throw Error('"signatures" should be an array')
    }
    if (signatures.length !== signingTx.inputs.length) {
      throw Error('Incorrect signature count')
    }
    for (let signature of signatures) {
      if (!Buffer.isBuffer(signature)) {
        throw Error('Invalid signature')
      }
    }

    let signatorySet = getSignatorySet(context.validators)
    let signatory = signatorySet[signatoryIndex]
    if (signatory == null) {
      throw Error('Invalid signatory index')
    }
    let signatoryKey = currentSignatorySet.signatoryKeys[signatory.validatorKey]

    // compute hashes that should have been signed
    let bitcoinTx = buildOutgoingTx(
      signingTx,
      context.validators,
      currentSignatorySet.signatoryKeys,
      network
    )
    // TODO: handle dynamic signatory sets
    let p2ss = createWitnessScript(
      context.validators,
      currentSignatorySet.signatoryKeys
    )
    let sigHashes = signingTx.inputs.map((input, i) =>
      bitcoinTx.hashForWitnessV0(
        i,
        p2ss,
        input.amount,
        bitcoin.Transaction.SIGHASH_ALL
      )
    )

    // verify each signature against its corresponding sighash
    for (let i = 0; i < sigHashes.length; i++) {
      let sigHash = sigHashes[i]
      let signatureDER = signatures[i]
      let signature = secp256k1.signatureImport(signatureDER)
      if (!secp256k1.verify(sigHash, signature, signatoryKey)) {
        throw Error('Invalid signature')
      }
    }

    // sigs are valid, update signing state
    signingTx.signatures[signatoryIndex] = signatures
    signingTx.signedVotingPower += signatory.votingPower
    let votingPowerThreshold = getVotingPowerThreshold(signatorySet)
    if (signingTx.signedVotingPower >= votingPowerThreshold) {
      // done signing, now the tx is valid and can be relayed
      currentSignatorySet.prevSignedTx = currentSignatorySet.signedTx
      currentSignatorySet.signedTx = signingTx
      currentSignatorySet.signingTx = null

      // add change output to our UTXOs
      let txHash = bitcoinTx.getHash()
      let changeIndex = bitcoinTx.outs.length - 1
      let changeOutput: any = bitcoinTx.outs[changeIndex]
      currentSignatorySet.utxos.push({
        txid: txHash,
        index: changeIndex,
        amount: changeOutput.value
      })
      state.processedTxs[txHash.toString('base64')] = true
    }
  }

  // runs at the end of each block
  function blockHandler(state: BitcoinPegState, context: BitcoinPegContext) {
    // TODO: in the future we won't disburse every time there is a withdrawal,
    //       we will wait until we're ready to make a checkpoint (e.g. a few
    //       times a day or when the signatory set has changed)
    let currentSignatorySet = state.signatorySets[state.currentP2ssAddress]
    if (state.withdrawals.length === 0) return
    if (currentSignatorySet.signingTx != null) return

    let inputs = currentSignatorySet.utxos
    currentSignatorySet.utxos = []

    let outputs = state.withdrawals
    state.withdrawals = []

    currentSignatorySet.signingTx = {
      inputs,
      outputs,
      signatures: [],
      signedVotingPower: 0
    }
  }

  return {
    initializers: [initializer],
    transactionHandlers: [txHandler],
    blockHandlers: [blockHandler],

    methods: {
      addWithdrawal(state: BitcoinPegState, amount: number, script: Buffer) {
        if (!Number.isSafeInteger(amount)) {
          throw Error('Amount must be an integer')
        }
        if (amount < MIN_WITHDRAWAL) {
          throw Error(`Amount must be >= ${MIN_WITHDRAWAL}`)
        }
        if (!Buffer.isBuffer(script)) {
          throw Error('Invalid output script')
        }
        state.withdrawals.push({ amount, script })
      }
    }
  }
}

bitcoinPeg.coinsHandler = function coinsHandler(routeName: string) {
  // handle withdrawals
  return {
    onOutput(
      output: { amount: number; script: Buffer },
      state: BitcoinPegState,
      context: BitcoinPegContext
    ) {
      let btc = context.modules[routeName]
      btc.addWithdrawal(output.amount, output.script)
    }
  }
}

import * as relay from './relay'
bitcoinPeg.relay = relay

import * as deposit from './deposit'
import { Transaction } from 'bitcoinjs-lib'
bitcoinPeg.deposit = deposit

export = bitcoinPeg
