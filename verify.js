import { createHmac } from "crypto";
import dotenv from "dotenv";
dotenv.config();

const isValidPostRequest = (secret, req) => {
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
  const body = req.rawBody;
  const message = `${version}:${timestamp}:${path}:${body}`;

  //Calculate the signature
  const signature = calculateSignature(secret, message);

  //Reject requests with invalid signatures
  if (!request.header("X-Canva-Signatures").includes(signature)) {
    return false;
  }

  return true;
};

const isValidGetRequest = (secret, req) => {
  //Verify the timestamp
  const sentAtSeconds = req.query.time;
  const receivedAtSeconds = new Date().getTime() / 1000;

  if (!isValidTimestamp(sentAtSeconds, receivedAtSeconds)) {
    return false;
  }

  //Construct the message
  const version = "v1";
  const { time, user, brand, extensions, state } = req.query;
  const message = `${version}:${time}:${user}:${brand}:${extensions}:${state}`;

  //Calculate a signature
  const signature = calculateSignature(secret, message);

  //Reject requests with invalid signatures
  if (!req.query.signatures.includes(signature)) {
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
  return createHmac("sha256", key).update(message).digest("hex");
};

export { isValidGetRequest, isValidPostRequest };
