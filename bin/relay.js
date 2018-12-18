let { PeerGroup } = require('bitcoin-net')
let Blockchain = require('blockchain-spv')
let params = require('webcoin-bitcoin-testnet')
let download = require('blockchain-download')
let Inventory = require('bitcoin-inventory')
let Filter = require('bitcoin-filter')
let connect = require('lotion-connect')
let encodeTx = require('bitcoin-protocol').types.transaction.encode
let buildMerkleProof = require('bitcoin-merkle-proof').build
let { createOutput, createWitnessScript, createScriptSig, getSignatories, buildOutgoingTx } = require('../src/reserve.js')
let bitcoin = require('bitcoinjs-lib')

// TODO: get this from somewhere else
let { getTxHash } = require('bitcoin-net/src/utils.js')

const HEADER_BATCH_SIZE = 250
const SCAN_BATCH_SIZE = 5

async function main () {
  let gci = process.argv[2]
  if (gci == null) {
    console.error('usage: node relay.js <GCI>')
    process.exit(1)
  }

  let pegClient = await connect(gci)
  console.log('connected to peg zone network')

  let validators = pegClient.validators.reduce((obj, v) => {
    obj[v.pub_key.value] = v.voting_power
    return obj
  }, {})
  let signatoryKeys = await pegClient.state.bitcoin.signatoryKeys

  async function getTip () {
    let length = await pegClient.state.bitcoin.chain.length
    return pegClient.state.bitcoin.chain[length - 1]
  }

  let tipHeader = await getTip()
  let startHeader = await pegClient.state.bitcoin.chain[0]
  // scan starting 10 blocks ago, without going past checkpoint height
  let scanHeight = Math.max(
    tipHeader.height - 10,
    startHeader.height
  )
  async function scanForDeposits () {
    console.log('scanForDeposits', scanHeight)

    let { processedTxs } = await pegClient.state.bitcoin

    let p2ss = createOutput(validators, signatoryKeys)
    // TODO: reset filter
    // TODO: add p2ss to filter
    // filter.add(p2ss)

    let headers = []
    let endHeight = Math.min(
      scanHeight + SCAN_BATCH_SIZE,
      tipHeader.height,
      chain.height()
    )
    for (let i = scanHeight; i <= endHeight; i++) {
      let header = chain.getByHeight(i)
      headers.push(header)
    }
    let blockHashes = headers.map(Blockchain.getHash)

    // TODO: filter so we don't have to download whole blocks
    peers.getBlocks(blockHashes, (err, blocks) => {
      if (err) {
        // retry
        // TODO: debug log
        setTimeout(scanForDeposits, 1000)
        return
      }

      let height = scanHeight - 1
      for (let block of blocks) {
        height += 1
        let hashes = []
        let includeHashes = []
        let includeTxs = []
        for (let tx of block.transactions) {
          let txid = getTxHash(tx)
          let txidBase64 = tx.toString('base64')
          hashes.push(txid)
          if (!isDepositTx(tx, p2ss)) continue
          if (processedTxs[txidBase64]) continue
          includeHashes.push(txid)
          includeTxs.push(tx)
        }

        console.log('found ' + includeHashes.length + ' txs')

        if (includeHashes.length === 0) {
          // no unprocessed deposit txs in this block
          scanHeight = height
          continue
        }

        let proof = buildMerkleProof({ hashes, include: includeHashes })

        // nodes verify against merkleRoot of stored header
        delete proof.merkleRoot

        let txBytes = includeTxs.map((tx) => encodeTx(tx))

        pegClient.send({
          type: 'bitcoin',
          height,
          proof,
          transactions: txBytes
        }).then((res) => {
          console.log('relayed txs', res)
        })

        scanHeight = height
      }

      if (scanHeight < tipHeader.height) {
        // continue scanning
        scanForDeposits()
      }
    })
  }

  params.net.staticPeers = [ 'localhost' ]

  let peers = PeerGroup(params.net)
  let inventory = Inventory(peers)
  // let filter = Filter(peers)
  let chain = Blockchain({
    indexed: true,
    start: startHeader,
    // TODO: disable for mainnet
    allowMinDifficultyBlocks: true
  })
  peers.connect()

  peers.on('peer', startSync)
  function startSync (peer) {
    if (peers.peers.length < 5) return
    peers.removeListener('peer', startSync)

    console.log('connected to bitcoin network')
    console.log('syncing bitcoin blockchain')
    download(chain, peers).then(() => {
      console.log('done syncing bitcoin blockchain')

      pegClient.state.bitcoin.signedTx.then((signedTx) => {
        if (signedTx == null) return

        console.log('Relaying tx that was signed by the signatory set')
        // TODO: put this somewhere else
        let tx = buildOutgoingTx(signedTx, validators, signatoryKeys)
        let redeemScript = createWitnessScript(getSignatories(validators, signatoryKeys))
        for (let i = 0; i < tx.ins.length; i++) {
          let signatures = getSignatures(signedTx.signatures, i)
          let scriptSig = createScriptSig(signatures)
          let p2wsh = bitcoin.payments.p2wsh({
            redeem: {
              input: scriptSig,
              output: redeemScript
            }
          })
          tx.setWitness(i, p2wsh.witness)
        }

        console.log('built signed tx:', tx.toHex())
        inventory.broadcast(tx)
        console.log('broadcasting')
      })
    })
  }

  let submittingHeaders = false
  chain.on('headers', async (headers) => {
    console.log('headers', chain.height())

    if (submittingHeaders) return
    submittingHeaders = true

    try {
      let tip = await getTip()
      console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
      while (chain.height() > tip.height) {
        let headers = chain.store.slice(tip.height - chain.store[0].height + 1)
        for (let i = 0; i < headers.length; i += HEADER_BATCH_SIZE) {
          let subset = headers.slice(i, i + HEADER_BATCH_SIZE)
          let res = await pegClient.send({ type: 'bitcoin', headers: subset })
          if (res.check_tx.code) {
            console.log(res, res.check_tx)
            throw Error(res.check_tx.log)
          }

          tip = await getTip()
          console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
        }
      }

      if (chain.height() === tip.height) {
        console.log('done relaying headers')
        scanForDeposits()
      }
    } catch (err) {
      console.log(err)
    } finally {
      submittingHeaders = false
    }
  })

  chain.on('reorg', (e) => {
    console.log('reorg!!', e)
  })
}

function isDepositTx (tx, p2ss) {
  if (tx.outs.length !== 2) return false
  if (!tx.outs[0].script.equals(p2ss)) return false
  // TODO: check 2nd output is correct format
  // TODO: other checks?
  return true
}

function getSignatures (signatures, index) {
  return signatures.map((sigs) => {
    if (sigs == null) return null
    return sigs[index].toString('hex')
  })
}

main().catch(function (err) { throw err })
