let { PeerGroup } = require('bitcoin-net')
let Blockchain = require('blockchain-spv')
let params = require('webcoin-bitcoin')
let download = require('blockchain-download')

async function main () {
  let height = +process.argv[2]
  height = height - (height % 2016)

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

  chain.on('reorg', (e) => {
    console.log('reorg', e)
  })

  chain.on('headers', (e) => {
    console.log('synced to height', chain.height())
    if (chain.height() >= height) {
      let header = chain.getByHeight(height)
      header.prevHash = header.prevHash.toString('hex')
      header.merkleRoot = header.merkleRoot.toString('hex')
      console.log(header)
      process.exit(0)
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
}

main().catch(function (err) { throw err })
