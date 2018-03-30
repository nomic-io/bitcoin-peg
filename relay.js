let { PeerGroup } = require('bitcoin-net')
let Blockchain = require('blockchain-spv')
let params = require('webcoin-bitcoin')
let download = require('blockchain-download')
let { get, post } = require('axios')
let { connect } = require('lotion')

const BATCH_SIZE = 400

async function main () {
  let { state, send } = await connect('55c3b7cec02db58234f278c40dae33027fc263643f487b2438bbabb11cad47b9')
  console.log('connected to peg zone network')

  async function getTip () {
    let length = await state.chainLength
    return state.chain[length - 1]
  }

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
          console.log(res)
          if (res.result.check_tx.code !== 0) throw Error(res.result.check_tx.log)

          tip = await getTip()
          console.log(`peg zone SPV: ${tip.height}, local SPV: ${chain.height()}`)
        }
      }
    } catch (err) {} finally {
      submitting = false
    }
  })
  chain.on('reorg', (e) => {
    console.log('reorg', e)
  })
}

main().catch(function (err) { throw err })
