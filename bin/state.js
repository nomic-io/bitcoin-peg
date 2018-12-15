let connect = require('lotion-connect')
let { inspect } = require('util')

async function main () {
  let gci = process.argv[2]
  if (gci == null) {
    console.error('usage: node relay.js <GCI>')
    process.exit(1)
  }

  let pegClient = await connect(gci)
  let state = await pegClient.getState()

  console.log(inspect(state, false, 10))
  process.exit(0)
}

main().catch(function (err) { throw err })
