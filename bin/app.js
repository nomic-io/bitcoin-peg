let lotion = require('lotion')
let coins = require('coins')
let bitcoin = require('../src/index.js')

let app = lotion({
  p2pPort: 26656,
  rpcPort: 26657,
  initialState: {}
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

app.use('bitcoin', bitcoin(bitcoinGenesis, 'pbtc'))

app.use('pbtc', coins())

app.start()
  .then((res) => console.log(res))
