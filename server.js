const express = require("express");
const fs = require("fs-extra");
const jimp = require("jimp");
const path = require("path");
const axios = require("axios");
const { response } = require("express");
const app = express();
let asset_;
app.use(express.json());
app.use(express.static("public"));
app.get("/url", (req, res) => {
  if (asset_) {
    res.send(asset_);
  } else {
    res.send("NO ASSET FOUND");
  }
});

async function download(url, path) {
  const response = await axios({
    method: "GET",
    url: url,
    responseType: "stream",
  });

  response.data.pipe(fs.createWriteStream(path));

  return new Promise((resolve, reject) => {
    response.data.on("end", () => {
      resolve();
    });
    response.data.on("error", (err) => {
      reject(err);
    });
  });
}
app.get("/login", (req, res) => {
  res.redirect(
    `https://staging.pass.buri.dev/oauth/authorize?client_id=75cd73448b797acfc0b420312b79f81d4d29ec80e89804746da6882e7ae1ef01&redirect_uri=https://cast-extension.herokuapp.com/auth&response_type=code&scope=openid+profile+email`
  );
});
app.get("/auth", (req, res) => {
  res.redirect(`https://www.google.com`);
});
app.post("/publish/resources/upload", async (request, response) => {
  // Ensure the "public" directory exists
  await fs.ensureDir(path.join(__dirname, "public"));
  // Get the first asset from the "assets" array
  const [asset] = request.body.assets;
  asset_ = asset;
  const filePath = path.join(__dirname, "public", asset.name);
  // Download the asset
  if (asset.type === "JPG" || asset.type === "PNG") {
    const image = await jimp.read(asset.url);
    await image.writeAsync(filePath);
  } else if (asset.type === "PDF" || asset.type === "PPTX") {
    download(asset.url, filePath);
  }
  // Respond with the URL of the published design
  response.send({
    type: "SUCCESS",
    url: `${request.protocol}://${request.get("host")}/${asset.name}`,
  });
});

app.listen(process.env.PORT || 3000);
