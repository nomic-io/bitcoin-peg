'use strict'

const bitcoin = require('bitcoinjs-lib')
const { PeerGroup } = require('bitcoin-net')
const Blockchain = require('blockchain-spv')
const params = require('webcoin-bitcoin-testnet')
const encodeTx = require('bitcoin-protocol').types.transaction.encode
const download = require('blockchain-download')
const buildMerkleProof = require('bitcoin-merkle-proof').build
const reserve = require('./reserve.js')

// TODO: get this from somewhere else
const { getTxHash, getBlockHash } = require('bitcoin-net/src/utils.js')

const HEADER_BATCH_SIZE = 250

// fetches bitcoin headers and relays any unprocessed ones to the peg chain
async function relayHeaders (pegClient, opts = {}) {
  let tries = opts.tries != null ? opts.tries : 1
  let netOpts = opts.netOpts
  let chainOpts = opts.chainOpts

  let chainState = await pegClient.state.bitcoin.chain
  let chain = Blockchain({
    store: chainState,
    indexed: true,
    // TODO: disable for mainnet
    allowMinDifficultyBlocks: true,
    ...chainOpts
  })

  // connect to bitcoin peers
  let peers = PeerGroup(params.net, netOpts) // TODO: configure
  peers.connect()
  await waitForPeers(peers)

  // catch up chain
  await download(chain, peers)
  peers.close()

  let chainState2 = await pegClient.state.bitcoin.chain
  let tip = chainState2[chainState2.length - 1]

  if (chain.height() <= tip.height) {
    // peg chain is up to date
    return tip
  }

  if (tries === 0) {
    throw Error('Failed to relay headers')
  }

  let toRelay = chain.store.slice(tip.height - chain.height())
  for (let i = 0; i < toRelay.length; i += HEADER_BATCH_SIZE) {
    let batch = toRelay.slice(i, i + HEADER_BATCH_SIZE)
    // TODO: emit errors that don't have to do with duplicate headers
    console.log(await pegClient.send({
      type: 'bitcoin',
      headers: batch
    }))
  }

  // call again to ensure peg chain is now up-to-date, or retry if needed
  return relayHeaders(pegClient, Object.assign({}, opts, { tries: tries - 1 }))
}

// fetches a bitcoin block, and relays the relevant transactions in it (plus merkle proof)
// to the peg chain
async function relayDeposits (pegClient, opts = {}) {
  // get info about signatory set
  let validators = convertValidatorsToLotion(pegClient.validators)
  let signatoryKeys = await pegClient.state.bitcoin.signatoryKeys
  let p2ss = reserve.createOutput(validators, signatoryKeys)

  let bitcoinTip = await relayHeaders(pegClient, Object.assign({}, opts, { tries: 3 }))
  let tipHash = getBlockHash(bitcoinTip)

  // connect to bitcoin peers
  let peers = PeerGroup(params.net) // TODO: configure
  peers.connect()
  await waitForPeers(peers)

  // fetch block
  // TODO: fetch back a few blocks?
  let block = await new Promise((resolve, reject) => {
    // TODO: filter so we don't have to download whole blocks
    peers.getBlocks([ tipHash ], (err, blocks) => {
      if (err) return reject(err)
      resolve(blocks[0])
    })
  })

  // relay any unprocessed txs (max of 4 tries)
  for (let i = 0; i < 4; i++) {
    let processedTxs = await pegClient.state.bitcoin.processedTxs

    // get txs to be relayed
    let hashes = [] // all hashes in block (so we can generate merkle proof)
    let includeHashes = [] // hashes to be included in proof
    let includeTxs = [] // txs to be included in proof
    let relayedHashes = [] // hashes already processed on the peg chain
    for (let tx of block.transactions) {
      let txid = getTxHash(tx)
      hashes.push(txid)

      // filter out txs that aren't valid deposits
      if (!isDepositTx(tx, p2ss)) continue

      // filter out txs that were already processed
      let txidBase64 = txid.toString('base64')
      if (processedTxs[txidBase64]) {
        relayedHashes.push(txid)
        continue
      }

      includeHashes.push(txid)
      includeTxs.push(tx)
    }

    // no txs left to process (success)
    // (either someone else relayed them, or there weren't any in the first place)
    if (includeHashes.length === 0) {
      return relayedHashes
    }

    let proof = buildMerkleProof({ hashes, include: includeHashes })
    // nodes verify against merkleRoot of stored header, so we don't need the `merkleProof` field
    delete proof.merkleRoot

    // we ignore response since it might have already been relayed by someone else
    await pegClient.send({
      type: 'bitcoin',
      height: bitcoinTip.height,
      proof,
      transactions: includeTxs.map((tx) => encodeTx(tx))
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw Error('Failed to fetch and relay block')
}

// calls `relayDeposits` and ensures given txid was relayed
async function relayDeposit (pegClient, txid) {
  if (!Buffer.isBuffer(txid)) {
    throw Error('Must specify txid')
  }
  let txidBase64 = txid.toString('base64')

  // relay deposit txs in latest bitcoin block
  let txids = await relayDeposits(pegClient)

  // check to see if given txid was relayed in this block
  let txidsBase64 = txids.map((txid) => txid.toString('base64'))
  if (txidsBase64.includes(txidBase64)) {
    // success, txid was relayed
    return
  }

  // maybe txid was in an older block? check if it was relayed
  let processedTxs = await pegClient.state.bitcoin.processedTxs
  if (processedTxs[txidBase64]) {
    // success, txid was relayed
    return
  }

  // TODO: instead of erroring here,
  //       1. scan for confirmation. if deposit not confirmed then error
  //       2. relay
  throw Error('Deposit transaction was not relayed')
}

// TODO: build the 3 separate transactions as outlined in the design document
function buildDisbursalTransaction (signedTx, validators, signatoryKeys) {
  // build tx
  let tx = reserve.buildOutgoingTx(signedTx, validators, signatoryKeys)

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

function isDepositTx (tx, p2ss) {
  if (tx.outs.length !== 2) return false
  if (!tx.outs[0].script.equals(p2ss)) return false
  // TODO: check 2nd output is correct format
  // TODO: other checks?
  return true
}

// converts validator set from Tendermint RPC format
// to Lotion {<pubkeyB64>: <votingPower>, ...} object
function convertValidatorsToLotion (validators) {
  return validators.reduce((obj, v) => {
    obj[v.pub_key.value] = v.voting_power
    return obj
  }, {})
}

// gets the signatures for the given input index from the
// peg network's signedTx state object as hex
function getSignatures (signatures, index) {
  return signatures.map((sigs) => {
    if (sigs == null) return null
    return sigs[index].toString('hex') +
      '01' // SIGHASH_ALL
  })
}

function waitForPeers (peers) {
  return new Promise((resolve) => {
    function onPeer (peer) {
      let isLocalhost = peer.socket.remoteAddress === '127.0.0.1'
      if (!isLocalhost && peers.peers.length < 4) {
        return
      }
      peers.removeListener('peer', onPeer)
      resolve()
    }
    peers.on('peer', onPeer)
  })
}

module.exports = {
  relayHeaders,
  relayDeposits,
  relayDeposit,
  buildDisbursalTransaction,
  isDepositTx,
  convertValidatorsToLotion
}
