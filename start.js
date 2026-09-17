module.exports = async (kernel) => {
  const PORT = await kernel.port()
  return {
    daemon: true,
    run: [
      {
        method: "shell.run",
        params: {
          path: "app",
          env: {
            PORT: String(PORT),
            HOST: "127.0.0.1"
          },
          message: [
            "npm start"
          ],
          on: [{
            // Captures the URL the server prints:
            // "Jevthoven listening at http://127.0.0.1:PORT/"
            event: "/(http:\\/\\/[0-9.:]+)/",
            done: true
          }]
        }
      },
      {
        // The regex capture object is passed in as input.event; index 1 is the group.
        method: "local.set",
        params: {
          url: "{{input.event[1]}}"
        }
      }
    ]
  }
}
