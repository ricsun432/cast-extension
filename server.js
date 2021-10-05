const express = require("express");
const fs = require("fs-extra");
const jimp = require("jimp");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static("public"));
app.get("/hello", (req, res) => {
  res.send("Welcome to Cast Publish Extension App");
});
app.post("/publish/resources/upload", async (request, response) => {
  // Ensure the "public" directory exists
  await fs.ensureDir(path.join(__dirname, "public"));

  // Get the first asset from the "assets" array
  const [asset] = request.body.assets;
  const filePath = path.join(__dirname, "public", asset.name);
  // Download the asset
  if (asset.type === "JPG" || asset.type === "PNG") {
    const image = await jimp.read(asset.url);
    await image.writeAsync(filePath);
  }
  if (asset.type === "PDF") {
    let pdf;
    fs.readFile(asset.url, (err, data) => {
      pdf = data;
    });
    fs.writeFile(filePath, pdf);
  }
  if (asset.type === "PPTX") {
    let pptx;
    fs.readFile(asset.url, (err, data) => {
      pptx = data;
    });
    fs.writeFile(filePath, pptx);
  }

  // Respond with the URL of the published design
  response.send({
    type: "SUCCESS",
    url: `${request.protocol}://${request.get("host")}/${asset.name}`,
  });
});

app.listen(process.env.PORT || 3000);
