const express = require("express");
const cors = require("cors");
const prisma = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});


app.get("/api/alerts", async (req, res) => {
  try {
    const alerts = await prisma.cryptoAlert.findMany();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));