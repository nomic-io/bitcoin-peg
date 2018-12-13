let { PeerGroup } = require('bitcoin-net')
let Blockchain = require('blockchain-spv')
let params = require('webcoin-bitcoin')
let download = require('blockchain-download')
let Inventory = require('bitcoin-inventory')
let Filter = require('bitcoin-filter')
let { connect } = require('lotion')
let encodeTx = require('bitcoin-protocol').types.transaction.encode
let buildMerkleProof = require('bitcoin-merkle-proof').build

// TODO: get this from somewhere else
let { getTxHash } = require('bitcoin-net/lib/utils.js')

const BATCH_SIZE = 250

async function main () {
  let gci = process.argv[2]
  if (gci == null) {
    console.error('usage: node relay.js <GCI>')
    process.exit(1)
  }

  let { state, send } = await connect(gci)
  console.log('connected to peg zone network')

  async function getTip () {
    // console.log('getting chainLength')
    let chain = await state.bitcoin.chain
    // console.log('c', chain)
    // console.log('chainLength:', chain.length)
    return chain[chain.length - 1]
  }

  params.net.staticPeers = [ 'localhost' ]

  let peers = PeerGroup(params.net)
  let inventory = Inventory(peers)
  // let filter = Filter(peers)
  // filter.add(Buffer.alloc(1))
  let chain = Blockchain({
    indexed: true,
    start: await state.bitcoin.chain[0]
  })
  peers.connect()
  peers.once('peer', async (peer) => {
    console.log('connected to bitcoin network')

    let tip = await getTip()

    let blockHash = Blockchain.getHash(tip)
    peers.getBlocks([ blockHash ], (err, blocks) => {
      console.log('getBlocks', err, blocks)

      let block = blocks[0]

      let hashes = []
      let include = []
      for (let tx of block.transactions) {
        let txid = getTxHash(tx)
        hashes.push(txid)
        // TODO: only push relevant txs to include
        include.push(txid)
      }
      let proof = buildMerkleProof({ hashes, include })

      // sanity check
      if (!proof.merkleRoot.equals(tip.merkleRoot)) {
        throw Error('Assertion error: merkle root mismatch')
      }

      // nodes verify against merkleRoot of stored header,
      // we just specify height
      delete proof.merkleRoot
      proof.height = tip.height

      let txBytes = encodeTx(block.transactions[0])

      console.log('relaying', proof, txBytes)

      send({
        type: 'bitcoin',
        proof,
        transaction: txBytes
      }).then((res) => {
        console.log('relayed tx', res)
      })
    })

    // console.log('syncing bitcoin blockchain')
    // await download(chain, peers)
    // console.log('done syncing bitcoin blockchain')
  })

  // chain.on('headers', (headers) => {
  //   console.log('headers', chain.height())
  // })
  //
  // let submitting = false
  // chain.on('headers', async () => {
  //   if (submitting) return
  //   submitting = true
  //
  //   try {
  //     let tip = await getTip()
  //     console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
  //     while (chain.height() > tip.height) {
  //       let headers = chain.store.slice(tip.height - chain.store[0].height + 1)
  //       for (let i = 0; i < headers.length; i += BATCH_SIZE) {
  //         let subset = headers.slice(i, i + BATCH_SIZE)
  //         let res = await send({ type: 'bitcoin', headers: subset })
  //         if (res.check_tx.code) {
  //           console.log(res, res.check_tx)
  //           throw Error(res.check_tx.log)
  //         }
  //
  //         tip = await getTip()
  //         console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
  //       }
  //     }
  //   } catch (err) {
  //     console.log(err)
  //   } finally {
  //     submitting = false
  //   }
  // })
  // chain.on('reorg', (e) => {
  //   console.log('reorg!!', e)
  // })
}

main().catch(function (err) { throw err })
