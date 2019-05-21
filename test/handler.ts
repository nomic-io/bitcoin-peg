import * as bitcoinPeg from '../src/index'
import test from 'ava'
import * as coins from 'coins'
import lotion = require('lotion-mock')

let trustedHeader = {
  version: 1073676288,
  prevHash: Buffer.from(
    '08d61fcf532a044364f0648a41a55bba405d5aa0bf6f415d8402000000000000',
    'hex'
  ),
  merkleRoot: Buffer.from(
    'a4fb1664d00ae4448dbdf8f99f1a78f7c5bb8036fd69d6f34aed5ee62386f65c',
    'hex'
  ),
  timestamp: 1556877853,
  bits: 436373240,
  nonce: 388744679,
  height: 1514016
}

let app = lotion({
  initialState: {}
})

app.use('bitcoin', bitcoinPeg(trustedHeader, 'mycoin'))

app.use(
  'mycoin',
  coins({
    initialBalances: {},
    handlers: {
      bitcoin: bitcoinPeg.coinsHandler('bitcoin')
    }
  })
)

app.start()

test('bitcoin deposit transaction', function(t) {
  console.log(app.state)
})
