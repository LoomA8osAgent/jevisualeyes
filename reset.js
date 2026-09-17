module.exports = {
  run: [{
    // remove installed dependencies; the vendored app code stays
    method: "fs.rm",
    params: {
      path: "app/node_modules"
    }
  }, {
    method: "fs.rm",
    params: {
      path: "app/web/dist"
    }
  }]
}
