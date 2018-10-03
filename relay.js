'use strict'

const chalk = require('chalk')
const cliSpinners = require('cli-spinners')
const diffy = require('diffy')()
const trim = require('diffy/trim')

const { PeerGroup } = require('bitcoin-net')
const Blockchain = require('blockchain-spv')
const params = require('webcoin-bitcoin')
const download = require('blockchain-download')
const { connect } = require('lotion')

const BATCH_SIZE = 250

async function main () {
  let gci = process.argv[2]
  if (gci == null) {
    console.error('usage: node relay.js <GCI>')
    process.exit(1)
  }

  params.net.staticPeers = [ 'localhost' ]
  let peers = PeerGroup(params.net)
  let chain = Blockchain({
    indexed: true,
    start: {
      height: 0,
      version: 1,
      prevHash: Buffer.alloc(32),
      merkleRoot: Buffer.from('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', 'hex').reverse(),
      timestamp: 1231006505,
      bits: 0x1d00ffff,
      nonce: 2083236893
    }
  })

  let lcConnected = false

  diffy.render(() => {
    let lcStatus = lcConnected ?
      trim(`
        Connected to ${chalk.green('???')}
        ${chalk.gray('HEIGHT:')} ${Math.random()}
      `) :
      `${spinner()} Connecting...`

    let btcStatus = peers.peers.length > 0 ?
      trim(`
        Connected to ${chalk.green(Math.min(peers.peers.length, 8) + ' peers')}
        ${chalk.gray('HEIGHT:')} ${chain.height()}
      `) :
      `${spinner()} Connecting...`

    return trim(`
      ${chalk.bold('LOTION LIGHT CLIENT')}
      ${lcStatus}

      ${chalk.bold('BITCOIN SPV CLIENT')}
      ${btcStatus}
    `) + '\n'
  })
  setInterval(() => diffy.render(), 100)

  let { state, send } = await connect(gci)
  lcConnected = true

  async function getTip () {
    // console.log('getting chainLength')
    let chain = await state.chain
    console.log(chain.slice(-10))
    // console.log('c', chain)
    // console.log('chainLength:', chain.length)
    return chain[chain.length - 1]
  }

  peers.connect()
  peers.once('peer', async (peer) => {
    await download(chain, peers)
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

function spinner () {
  let { frames, interval } = cliSpinners.dots
  let i = Math.floor(Date.now() / interval)
  let frame = frames[i % frames.length]
  return chalk.cyan.bold(frame)
}
