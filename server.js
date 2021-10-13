import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs-extra";
import jimp from "jimp";
import { JSONFile, Low } from "lowdb";
import path from "path";
import querystring from "querystring";
dotenv.config();

let asset_;
let brand_, extensions_, signatures_, state_, time_, user_, code_;
const app = express();
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

const isValidPostRequest = (secret, request) => {
  //Verify the timestamp
  const sentAtSeconds = request.header("X-Canva-Timestamp");
  const receivedAtSeconds = new Date().getTime() / 1000;

  if (!isValidTimestamp(sentAtSeconds, receivedAtSeconds)) {
    return false;
  }

  //Construct the message
  const version = "v1";
  const timestamp = request.header("X-Canva-Timestamp");
  const path = getPathForSignatureVerification(request.path);
  const body = request.rawBody;
  const message = `${version}:${timestamp}:${path}:${body}`;

  //Calculate the signature
  const signature = calculateSignature(secret, message);

  //Reject requests with invalid signatures
  if (!request.header("X-Canva-Signatures").includes(signature)) {
    return false;
  }

  return true;
};

const isValidTimestamp = (
  sentAtSeconds,
  receivedAtSeconds,
  leniencyInSeconds = 300
) => {
  return (
    Math.abs(Number(sentAtSeconds) - Number(receivedAtSeconds)) <
    Number(leniencyInSeconds)
  );
};

const getPathForSignatureVerification = (input) => {
  const paths = [
    "/configuration",
    "/configuration/delete",
    "/content/resources/find",
    "/editing/image/process",
    "/editing/image/process/get",
    "/publish/resources/find",
    "/publish/resources/get",
    "/publish/resources/upload",
  ];
  return paths.find((path) => input.endsWith(path));
};

const calculateSignature = (secret, message) => {
  //Decode the client secret
  const key = Buffer.from(secret, "base64");

  //Calculate the signature
  return crypto.createHmac("sha256", key).update(message).digest("hex");
};
app.get("/env", (req, res) => {
  res.send(`${process.env.NODE_ENV}`);
});

app.get("/url", (req, res) => {
  if (asset_) {
    res.send(asset_);
  } else {
    console.log(req.cookies);
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
  if (!isValidPostRequest(process.env.CLIENT_SECRET, req)) {
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
    //&brand=${brand}&extensions=${extensions}&signatures=${signatures}&state=${state}&time=${time}&user=${user} -> comment muna
  );
});
app.post("/publish/resources/upload", async (req, res) => {
  if (!isValidPostRequest(process.env.CLIENT_SECRET, req)) {
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
  if (!isValidPostRequest(process.env.CLIENT_SECRET, req)) {
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
  if (!isValidPostRequest(process.env.CLIENT_SECRET, req)) {
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
