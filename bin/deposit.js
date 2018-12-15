let { connect } = require('lotion')

async function main () {
  let gci = process.argv[2]
  if (gci == null) {
    console.error('usage: node deposit.js <GCI>')
    process.exit(1)
  }

  let { state, send } = await connect(gci)
  console.log('connected to peg zone network')

  let { signatoryKeys } = await state.bitcoin
  console.log(signatoryKeys)
}

main().catch(function (err) { throw err })
