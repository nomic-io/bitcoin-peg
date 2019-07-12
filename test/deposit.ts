// import test from 'ava'
// import { createTx } from '../src/deposit'
// import * as bitcoin from 'bitcoinjs-lib'
// import * as bs58 from 'bs58'

// test('create deposit bitcoin transaction', function(t) {
//   const validatorPublicKey = 'aOSx00CgYJ3/WGNgioJEs91irUHNvy+bV20hRTby7ak='
//   let validators = { [validatorPublicKey]: 10 }

//   let utxo = {
//     script: bs58.decode('1cMh228HTCiwS8ZsaakH8A8wze1JR5ZsP'),
//     value: 10000
//   }
//   let utxos = [utxo]
//   let signatoryKeys = {
//     [validatorPublicKey]: Buffer.from(validatorPublicKey, 'base64')
//   }

//   let depositTx = createTx(
//     validators,
//     signatoryKeys,
//     utxos,
//     Buffer.from('judd')
//   )
// })
