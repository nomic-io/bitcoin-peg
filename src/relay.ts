let bmp = require('bitcoin-merkle-proof')
import * as bitcoin from 'bitcoinjs-lib'

import * as reserve from './reserve'
import {
  getCurrentP2ssAddress,
  getSignatoryScriptHashFromPegZone
} from './signatory'
import { BitcoinNetwork, SignatoryMap, SignedTx, ValidatorMap } from './types'

let encodeBitcoinTx = require('bitcoin-protocol').types.transaction.encode
let decodeBitcoinTx = require('bitcoin-protocol').types.transaction.decode
let { getTxHash, getBlockHash } = require('bitcoin-net/src/utils.js')

interface RelayOptions {
  bitcoinRPC: any
  lotionLightClient: any
  network: BitcoinNetwork
}

/**
 * Watches a Bitcoin full node for deposits to the signatory address.
 *
 * The Relay will poll its Bitcoin full node at regular
 * intervals to check for deposits to the signatory address.
 *
 * When it finds a Bitcoin deposit transaction, the Relay will first ensure
 * that the peg zone has received a chain of Bitcoin headers up to the block containing
 * the deposit transaction, then create and transmit a peg zone deposit transaction.
 *
 */
export class Relay {
  private bitcoinRPC: any
  private lotionLightClient: any
  private network: BitcoinNetwork

  constructor(relayOpts: RelayOptions) {
    this.bitcoinRPC = relayOpts.bitcoinRPC
    this.lotionLightClient = relayOpts.lotionLightClient
    this.network = relayOpts.network
  }

  async relayHeaders(pegChainHeaders) {
    let rpc = this.bitcoinRPC
    // Compute common ancestor
    let commonHeaderHash
    commonHeaderSearchLoop: for (
      let i = pegChainHeaders.length - 1;
      i >= 0;
      i--
    ) {
      // Check if peg chain header is in the longest chain
      let pegChainHeader = pegChainHeaders[i]
      let blockHash = getBlockHash(pegChainHeader)
        .reverse()
        .toString('hex')
      let rpcHeaderInfo = await rpc.getBlockHeader(blockHash)
      if (rpcHeaderInfo && rpcHeaderInfo.confirmations !== -1) {
        commonHeaderHash = blockHash
        break commonHeaderSearchLoop
      }
    }
    console.log('found common header:')
    if (!commonHeaderHash) {
      throw new Error('No common headers found between peg chain and bitcoind')
    }
    console.log(commonHeaderHash)

    let lastBlockHash = await rpc.getBestBlockHash()
    let lastHeader = await rpc.getBlockHeader(lastBlockHash)
    let headers = [formatHeader(lastHeader)]
    console.log('building headers from bitcoind..')
    while (
      lastHeader.previousblockhash !== commonHeaderHash &&
      lastHeader.hash !== commonHeaderHash
    ) {
      lastHeader = await rpc.getBlockHeader(lastHeader.previousblockhash)
      headers.push(formatHeader(lastHeader))
    }
    headers.reverse()
    console.log('broadcasting a header batch')
    for (let i = 0; i < headers.length; i += 100) {
      let result = await this.lotionLightClient.send({
        type: 'bitcoin',
        headers: headers.slice(i, i + 100)
      })
    }
  }
  /**
   * Process all actions required by state updates on the peg zone or Bitcoin.
   *
   * Returns a promise which resolves when all necessary actions (such as relaying deposits) have been completed.
   */
  async step() {
    let rpc = this.bitcoinRPC
    let lc = this.lotionLightClient
    let p2ss = await getSignatoryScriptHashFromPegZone(lc)
    let p2ssAddress = await getCurrentP2ssAddress(lc, this.network)
    await rpc.importAddress(
      /*address=*/ p2ssAddress,
      /*label=*/ '',
      /*rescan=*/ false,
      /*p2sh=*/ false
    )
    // Relay any headers not yet seen by the peg chain.
    let pegChainHeaders = await lc.state.bitcoin.chain
    let pegChainProcessedTxs = await lc.state.bitcoin.processedTxs
    await this.relayHeaders(pegChainHeaders)
    // Check for Bitcoin deposits

    let allReceivedDepositTxs = await rpc.listTransactions('*', 1e9, 0, true)
    let depositsToRelay = allReceivedDepositTxs.filter(
      tx =>
        tx.address === p2ssAddress &&
        tx.category === 'receive' &&
        typeof tx.blockhash === 'string' &&
        !pegChainProcessedTxs[tx.txid]
    )
    let pegChainDepositTxs = []
    for (let i = 0; i < depositsToRelay.length; i++) {
      const VERBOSITY = 2
      let depositTx = depositsToRelay[i]
      let blockContainingDepositTx = await rpc.getBlock(
        depositTx.blockhash,
        VERBOSITY
      )
      let txHashesInBlock = blockContainingDepositTx.tx.map(tx => {
        return Buffer.from(tx.txid, 'hex').reverse()
      })
      let txHashesInBlockToIncludeInProof = [
        Buffer.from(depositTx.txid, 'hex').reverse()
      ]
      let proof = bmp.build({
        hashes: txHashesInBlock,
        include: txHashesInBlockToIncludeInProof
      })
      let pegChainDepositTx = {
        type: 'bitcoin',
        height: blockContainingDepositTx.height,
        proof,
        transactions: blockContainingDepositTx.tx
          .filter(tx => tx.txid === depositTx.txid)
          .filter(tx => {
            let txid = getTxHash(
              decodeBitcoinTx(Buffer.from(tx.hex, 'hex'))
            ).toString('hex')

            return pegChainProcessedTxs[txid] !== true
          })
          .map(tx => {
            return Buffer.from(tx.hex, 'hex')
          })
      }
      pegChainDepositTxs.push(pegChainDepositTx)
    }

    // Now check for a completed transaction on the peg zone.
    let signedTx: SignedTx | null = await lc.state.bitcoin.signedTx
    if (signedTx) {
      let validators = convertValidatorsToLotion(lc.validators)
      let signatoryKeys: SignatoryMap = await lc.state.bitcoin.signatoryKeys
      let finalizedTx = buildDisbursalTransaction(
        signedTx,
        validators,
        signatoryKeys,
        this.network
      )
    }
    // TODO: not properly tracking processed transactions on state.
    // Relay deposit transactions to the peg chain
    for (let i = 0; i < pegChainDepositTxs.length; i++) {
      let result = await lc.send(pegChainDepositTxs[i])
    }
  }
}

function formatHeader(header) {
  return {
    height: Number(header.height),
    version: Number(header.version),
    prevHash: header.previousblockhash
      ? Buffer.from(header.previousblockhash, 'hex').reverse()
      : Buffer.alloc(32),
    merkleRoot: Buffer.from(header.merkleroot, 'hex').reverse(),
    timestamp: Number(header.time),
    bits: parseInt(header.bits, 16),
    nonce: Number(header.nonce)
  }
}

export function convertValidatorsToLotion(validators): ValidatorMap {
  return validators.reduce((obj, v) => {
    obj[v.pub_key.value] = v.voting_power
    return obj
  }, {})
}

// TODO: build the 3 separate transactions as outlined in the design document
function buildDisbursalTransaction(
  signedTx: SignedTx,
  validators: ValidatorMap,
  signatoryKeys: SignatoryMap,
  network: BitcoinNetwork
) {
  // build tx
  let tx = reserve.buildOutgoingTx(signedTx, validators, signatoryKeys, network)

  // insert signatory set's signatures as p2wsh witness
  let redeemScript = reserve.createWitnessScript(validators, signatoryKeys)
  for (let i = 0; i < tx.ins.length; i++) {
    let signatures = getSignatures(signedTx.signatures, i)
    let scriptSig = reserve.createScriptSig(signatures)
    let p2wsh = bitcoin.payments.p2wsh({
      redeem: {
        input: scriptSig,
        output: redeemScript
      }
    })
    tx.setWitness(i, p2wsh.witness)
  }

  return tx
}
/**
 * Gets the signatures for the given input index from the
 * peg network's signedTx state object as hex
 */
function getSignatures(signatures: SignedTx['signatures'], index: number) {
  let result: string[] = []
  for (let i = 0; i < signatures.length; i++) {
    result.push(
      signatures[i] ? signatures[i][index].toString('hex') + '01' : null
    ) // SIGHASH_ALL
  }
  return result
}
