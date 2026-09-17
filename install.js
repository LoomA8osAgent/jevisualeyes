module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        message: [
          "npm install",
          "npm run build"
        ]
      }
    },
    {
      method: "fs.link",
      params: {
        drive: {
          "data": "app/data"
        }
      }
    }
  ]
}
