let { PeerGroup } = require('bitcoin-net')
let Blockchain = require('blockchain-spv')
let params = require('webcoin-bitcoin-testnet')
let download = require('blockchain-download')

async function main () {
  let height = +process.argv[2]
  height = height - (height % 2016)

  params.net.staticPeers = [ 'localhost' ]

  let peers = PeerGroup(params.net)
  params.blockchain.genesisHeader.height = 0
  let chain = Blockchain({
    indexed: true,
    allowMinDifficultyBlocks: true,
    start: {
      version: 1073733632,
      prevHash: Buffer.from('0000000000000113d4262419a8aa3a4fe928c0ea81893a2d2ffee5258b2085d8', 'hex').reverse(),
      merkleRoot: Buffer.from('baa3bb3f4fb663bf6974831ff3d2c37479f471f1558447dfae92f146539f7d9f', 'hex').reverse(),
      timestamp: 1544574033,
      bits: 0x1a015269,
      nonce: 3714016562,
      height: 1447488
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
