module.exports = function(wallaby) {
  return {
    env: {
      type: 'node',
      runner: 'node',
      params: {
        env: 'DEBUG=bitcoin-peg*'
      }
    },
    files: ['src/*.ts'],
    tests: ['test/*.ts'],
    testFramework: 'ava',
    workers: {
      restart: true
    }
  }
}
