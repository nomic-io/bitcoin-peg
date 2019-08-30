import bmp = require('bitcoin-merkle-proof')

import {
  getSignatoryScriptHashFromPegZone,
  getCurrentP2ssAddress
} from './signatory'
import { BitcoinNetwork } from './types'

let encodeBitcoinTx = require('bitcoin-protocol').types.transaction.encode
let decodeBitcoinTx = require('bitcoin-protocol').types.transaction.decode
let bitcoin = require('bitcoinjs-lib')
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
      console.log(result)
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
    try {
      let p2ss = await getSignatoryScriptHashFromPegZone(lc)
      let p2ssAddress = await getCurrentP2ssAddress(lc, this.network)
      console.log(p2ss)
      console.log('p2ss address:')
      console.log(p2ssAddress)
      await rpc.importAddress(
        /*address=*/ p2ssAddress,
        /*label=*/ '',
        /*rescan=*/ false,
        /*p2sh=*/ false
      )
      // Relay any headers not yet seen by the peg chain.
      let pegChainHeaders = await lc.state.bitcoin.chain
      let pegChainProcessedTxs = await lc.state.bitcoin.processedTxs
      console.log('relaying headers')
      await this.relayHeaders(pegChainHeaders)
      console.log('relayed headers.')
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

      // Relay deposit transactions to the peg chain
      for (let i = 0; i < pegChainDepositTxs.length; i++) {
        let result = await lc.send(pegChainDepositTxs[i])
      }
      console.log('reached end of relayer.step()')
    } catch (e) {
      console.log('error during relay:')
      console.log(e)
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

function delay(ms = 1000) {
  return new Promise((resolve, reject) => {
    setTimeout(function() {
      resolve()
    }, ms)
  })
}

export function convertValidatorsToLotion(validators) {
  return validators.reduce((obj, v) => {
    obj[v.pub_key.value] = v.voting_power
    return obj
  }, {})
}
