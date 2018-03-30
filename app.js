let lotion = require('lotion')
let coins = require('coins')
let peg = require('.')

let app = lotion({
  p2pPort: 46656,
  tendermintPort: 46657,
  logTendermint: true,
  devMode: true
})

let bitcoinGenesis = {
  height: 0,
  version: 1,
  prevHash: Buffer(32),
  merkleRoot: Buffer.from('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', 'hex').reverse(),
  timestamp: 1231006505,
  bits: 0x1d00ffff,
  nonce: 2083236893
}

app.use(peg(bitcoinGenesis))

app.listen(8888).then((res) => console.log(res))
