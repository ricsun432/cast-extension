import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { EventEmitter } from "events";
import express from "express";
import fs from "fs-extra";
import jimp from "jimp";
import { JSONFile, Low } from "lowdb";
import path from "path";
import querystring from "querystring";
import * as verify from "./verify.js";

dotenv.config();
let downloaded = false;
let asset_ = {};
let brand_, extensions_, signatures_, state_, time_, user_, code_;
const app = express();
const Stream = new EventEmitter();
app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(express.static("public"));
app.enable("trust proxy");
//Set up the database
const adapter = new JSONFile("db.json");
const db = new Low(adapter);
await db.read();
db.data || (db.data = { loggedInUsers: [] });

app.get("/url", (req, res) => {
  if (downloaded && Object.keys(asset_).length > 0) {
    res.json({
      ...asset_,
      uri: `${req.protocol}://${req.get("host")}/${asset_.name}`,
    });
    downloaded = false;
    asset_ = {};
  } else {
    res.json({});
  }
});
// Downloader
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
      downloaded = true;
    });
    response.data.on("error", (err) => {
      reject(err);
    });
  });
}
app.get("/env", (req, res) => {
  res.send(`${process.env.CLIENT_SECRET}`);
});
app.get("/login", (req, res) => {
  if (!verify.isValidGetRequest(process.env.CLIENT_SECRET, req)) {
    res.sendStatus(401);
    return;
  }

  const { query } = req;
  const { brand } = query; //ID of the user's team.
  const { extensions } = query; //The extenstion points the user is attempting to authenticate with
  const { signatures } = query; // A comma-separated list of request signatures.
  const { state } = query; // A token the app must return to Canva at the end of the authentication flow.
  const { time } = query; // The UNIX timestamp (in seconds) of when the user started the authentication flow.
  const { user } = query; // The ID of the user.
  const url = `${req.protocol}://${req.get("host")}/auth`;
  const client_id = `75cd73448b797acfc0b420312b79f81d4d29ec80e89804746da6882e7ae1ef01`;
  //assign to server variable
  brand_ = brand;
  extensions_ = extensions;
  signatures_ = signatures;
  state_ = state;
  time_ = time;
  user_ = user;

  //redirect to BuriPass
  res.redirect(
    `https://pass.buri.io/oauth/authorize?client_id=${client_id}&redirect_uri=${url}&response_type=code&scope=openid`
  );
});
app.post("/publish/resources/upload", async (req, res) => {
  if (!verify.isValidPostRequest(process.env.CLIENT_SECRET, req)) {
    res.sendStatus(401);
    return;
  }
  const { loggedInUsers } = db.data;

  //The user is logged-in
  if (loggedInUsers.includes(user_)) {
    // Ensure the "public" directory exists
    await fs.ensureDir("public");
    // Get the first asset from the "assets" array
    const [asset] = req.body.assets;
    asset_ = asset;
    const filePath = path.join("public", asset.name);
    // Download the asset
    if (asset.type === "JPG" || asset.type === "PNG") {
      const image = await jimp.read(asset.url);
      await image.writeAsync(filePath);
    } else if (asset.type === "PDF" || asset.type === "PPTX") {
      download(asset.url, filePath);
    }
    // Respond with the URL of the published design
    res.send({
      type: "SUCCESS",
      url: `${req.protocol}://${req.get("host")}/${asset.name}`,
    });
    return;
  }
  //The user is not logged-in
  res.send({
    type: "ERROR",
    errorCode: "CONFIGURATION_REQUIRED",
  });
});

//Goes to /auth if logged in successfully
app.get("/auth", async (req, res) => {
  // const { query } = req;
  // code_ = query.code;

  const { loggedInUsers } = db.data;

  if (!loggedInUsers.includes(user_)) {
    loggedInUsers.push(user_);
    await db.write();
  }

  //Create query parameters for redirecting back to Canva
  const params = querystring.stringify({
    success: true,
    state: state_,
  });
  res.redirect(302, `https://canva.com/apps/configured?${params}`);
});

app.post("/configuration", async (req, res) => {
  if (!verify.isValidPostRequest(process.env.CLIENT_SECRET, req)) {
    res.sendStatus(401);
    return;
  }
  const { loggedInUsers } = db.data;
  const { user } = req.body;

  //The user is logged-in
  if (loggedInUsers.includes(user)) {
    res.send({
      type: "SUCCESS",
      labels: ["PUBLISH"],
    });
    return;
  }

  //The user is not logged-in
  res.send({
    type: "ERROR",
    errorCode: "CONFIGURATION_REQUIRED",
  });
});

app.post("/configuration/delete", async (req, res) => {
  if (!verify.isValidPostRequest(process.env.CLIENT_SECRET, req)) {
    res.sendStatus(401);
    return;
  }
  //Remove the current user from the database
  db.data.loggedInUsers = db.data.loggedInUsers.filter((user) => {
    return user !== req.body.user;
  });
  await db.write();

  res.send({
    type: "SUCCESS",
  });
});

app.listen(process.env.PORT || 3000);
