let { PeerGroup } = require('bitcoin-net')
let Blockchain = require('blockchain-spv')
let params = require('webcoin-bitcoin')
let download = require('blockchain-download')
let { connect } = require('lotion')

const BATCH_SIZE = 250

async function main () {
  let gci = process.argv[2]
  if (gci == null) {
    console.error('usage: node relay.js <GCI>')
    process.exit(1)
  }

  let { state, send } = await connect(gci)
  console.log('connected to peg zone network')

  send({
    type: 'bitcoin',
    foo: 123
  })

  async function getTip () {
    // console.log('getting chainLength')
    let chain = await state.chain
    console.log(chain.slice(-10))
    // console.log('c', chain)
    // console.log('chainLength:', chain.length)
    return chain[chain.length - 1]
  }

  params.net.staticPeers = [ 'localhost' ]

  let peers = PeerGroup(params.net)
  let chain = Blockchain({
    indexed: true,
    start: {
      height: 0,
      version: 1,
      prevHash: Buffer(32),
      merkleRoot: Buffer.from('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', 'hex').reverse(),
      timestamp: 1231006505,
      bits: 0x1d00ffff,
      nonce: 2083236893
    }
  })
  peers.connect()
  peers.once('peer', async (peer) => {
    console.log('connected to bitcoin network')
    console.log('syncing bitcoin blockchain')
    await download(chain, peers)
    console.log('done syncing bitcoin blockchain')
    peers.close()
  })
  peers.on('peer', () => {
    // console.log(`connected to ${peers.peers.length} peers`)
  })

  let submitting = false
  chain.on('headers', async () => {
    if (submitting) return
    submitting = true

    try {
      let tip = await getTip()
      console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
      while (chain.height() > tip.height) {
        let headers = chain.store.slice(tip.height - chain.store[0].height + 1)
        for (let i = 0; i < headers.length; i += BATCH_SIZE) {
          let subset = headers.slice(i, i + BATCH_SIZE)
          let res = await send({ type: 'chain', headers: subset })
          if (res.check_tx.code) {
            console.log(res, res.check_tx)
            throw Error(res.check_tx.log)
          }

          tip = await getTip()
          console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
        }
      }
    } catch (err) {
      console.log(err)
    } finally {
      submitting = false
    }
  })
  chain.on('reorg', (e) => {
    console.log('reorg', e)
  })
}

main().catch(function (err) { throw err })
