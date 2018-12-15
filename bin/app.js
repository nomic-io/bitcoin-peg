let lotion = require('lotion')
let coins = require('coins')
let bitcoin = require('../src/index.js')

let app = lotion({
  genesisPath: './genesis.json',
  keyPath: './priv_validator.json',
  p2pPort: 26656,
  rpcPort: 26657,
  initialState: {}
})

// mainnet
// let checkpoint = {
//   version: 536870912,
//   prevHash: Buffer.from('e2acb3e71e4e443af48e81d381dea7d35e2e8d5e69fe15000000000000000000', 'hex'),
//   merkleRoot: Buffer.from('7f2ada224dc4afba6ca37010b099c02322cb5df24fcedb0ff5b87fb3ca64eeae', 'hex'),
//   timestamp: 1543838368,
//   bits: 389142908,
//   nonce: 512160369,
//   height: 552384
// }
let checkpoint = {
  version: 1073733632,
  prevHash: Buffer.from('0000000000000113d4262419a8aa3a4fe928c0ea81893a2d2ffee5258b2085d8', 'hex').reverse(),
  merkleRoot: Buffer.from('baa3bb3f4fb663bf6974831ff3d2c37479f471f1558447dfae92f146539f7d9f', 'hex').reverse(),
  timestamp: 1544602833,
  bits: 0x1a015269,
  nonce: 3714016562,
  height: 1447488
}

app.use('bitcoin', bitcoin(checkpoint, 'pbtc'))

app.use('pbtc', coins())

app.start()
  .then((res) => console.log(res))
