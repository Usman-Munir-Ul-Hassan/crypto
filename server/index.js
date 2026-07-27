const express = require("express");
const cors = require("cors");

const app = express();


app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(5000, () => console.log("Server running on port 5000"));