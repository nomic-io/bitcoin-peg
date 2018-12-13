let lotion = require('lotion')
let coins = require('coins')
let bitcoin = require('../src/index.js')

let app = lotion({
  p2pPort: 26656,
  rpcPort: 26657,
  initialState: {}
})

let checkpoint = {
  version: 536870912,
  prevHash: Buffer.from('e2acb3e71e4e443af48e81d381dea7d35e2e8d5e69fe15000000000000000000', 'hex'),
  merkleRoot: Buffer.from('7f2ada224dc4afba6ca37010b099c02322cb5df24fcedb0ff5b87fb3ca64eeae', 'hex'),
  timestamp: 1543838368,
  bits: 389142908,
  nonce: 512160369,
  height: 552384
}

app.use('bitcoin', bitcoin(checkpoint, 'pbtc'))

app.use('pbtc', coins())

app.start()
  .then((res) => console.log(res))
