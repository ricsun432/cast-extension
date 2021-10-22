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
let assets_;
let filePaths = [];
let parent;
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

app.use("/public", express.static("public"));
app.enable("trust proxy");
//Set up the database
const adapter = new JSONFile("db.json");
const db = new Low(adapter);
await db.read();
db.data || (db.data = { loggedInUsers: [] });

app.post("/publish/resources/find", async (req, res) => {
  if (!verify.isValidPostRequest(process.env.CLIENT_SECRET, req)) {
    res.sendStatus(401);
    return;
  }
  await fs.ensureDir("public");
  const files = await fs.readdir("public", {
    withFileTypes: true,
  });
  const resources = files
    .filter((dirent) => dirent.isDirectory())
    .map((folder) => {
      return {
        type: "CONTAINER",
        id: path.join("public", folder.name),
        name: folder.name,
        isOwner: true,
        readOnly: false,
      };
    });
  res.send({
    type: "SUCCESS",
    resources,
  });
});

app.post("/publish/resources/get", async (req, res) => {
  if (!verify.isValidPostRequest(process.env.CLIENT_SECRET, req)) {
    res.sendStatus(401);
    return;
  }
  const dirPathExists = await fs.pathExists(req.body.id);

  if (!dirPathExists) {
    res.send({
      type: "ERROR",
      errorCode: "NOT_FOUND",
    });
    return;
  }

  res.send({
    type: "SUCCESS",
    resource: {
      type: "CONTAINER",
      id: req.body.id,
      name: path.basename(req.body.id),
      isOwner: true,
      readOnly: false,
    },
  });
});

app.get("/url", (req, res) => {
  if (downloaded) {
    res.json({
      assets: assets_,
      links: filePaths,
    });
    downloaded = false;
    asset_ = {};
  } else {
    res.json({});
  }
});
// Downloader here
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
  res.send(`${process.env.NODE_ENV}`);
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
    filePaths = [];
    assets_ = req.body.assets;
    asset_ = asset;
    parent = req.body.parent;
    for (let i = 0; i < assets_.length; i++) {
      const filePath = path.join(req.body.parent, assets_[i].name);
      // Download the asset
      if (assets_[i].type === "JPG" || assets_[i].type === "PNG") {
        const image = await jimp.read(assets_[i].url);
        await image.writeAsync(filePath);
      } else if (assets_[i].type === "PDF" || assets_[i].type === "PPTX") {
        download(assets_[i].url, filePath);
      }

      filePaths.push({
        url: `${req.protocol}://${req.get("host")}/${path.join(
          req.body.parent,
          assets_[i].name
        )}`,
        type: assets_[i].type,
      });
    }

    downloaded = true;
    // Respond with the URL of the published design
    res.send({
      type: "SUCCESS",
      url: `${req.protocol}://${req.get("host")}/${path.join(
        req.body.parent,
        asset.name
      )}`,
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
