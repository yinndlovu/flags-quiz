require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");

const app = express();
app.use(
  cors({
    origin: "*",
    credentials: false,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.set("trust proxy", 1);

const server = http.createServer(app);
const setupGameSocket = require("./src/game/gameSocket");
setupGameSocket(server);

const PORT = process.env.PORT || 7000;

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
