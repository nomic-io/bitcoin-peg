let Blockchain = require('blockchain-spv')
let proofs = require('bitcoin-merkle-proof')
let coins = require('coins')

module.exports = function (startHeader) {
  // TODO: initialize blockchain at startup based on current state
  //       instead of on first transaction
  function chainTxHandler (state, tx) {
    let chain = Blockchain({ store: state.chain })
    chain.add(tx.headers)

    // TODO: remove need for this by keeping length in array root obj in `merk`
    state.chainLength = state.chain.length
  }

  // peg handler for `coins`
  let peg = {
    initialState: {
      outputs: [],
      amount: 0
    },

    // deposit
    onInput (input, tx, state, chain) {
      let { proof, height, tx, amount } = input
      throw Error('Deposit not yet implemented')
    },

    // withdraw
    onOutput () {
      throw Error('Withdraw not yet implemented')
    }
  }

  let [ coinsInitializer, coinsTxHandler ] = coins({
    handlers: { peg }
  })

  function initializer (state, chainInfo) {
    state.chain = [ startHeader ]
    state.chainLength = 1
    coinsInitializer.middleware(state, chainInfo)
  }

  // TODO: clean routing (doesn't belong in this repo)
  function txHandler (state, tx) {
    if (tx.type === 'chain') {
      return chainTxHandler(state, tx)
    }
    if (tx.type === 'coins') {
      return coinsTxHandler.middleware(state, tx)
    }
  }

  return [
    {
      type: 'initializer',
      middleware: initializer
    },
    {
      type: 'tx',
      middleware: txHandler
    }
  ]
}
