const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
} = require("@aws-sdk/client-s3");
const mime = require("mime-types");
const Redis = require("ioredis");
const { v4: uuidv4 } = require("uuid");

const PROJECT_ID = process.env.PROJECT_ID;
const bucketName = `${PROJECT_ID}-${uuidv4().split("-")[0]}`;
const region = "ap-south-1";

const publisher = new Redis(
  `rediss://default:${process.env.REDIS_PASSWORD}@caching-1529a761-sandipan-050b.g.aivencloud.com:24119`
);

const s3_client = new S3Client({
  region: region,
  credentials: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY,
    secretAccessKey: process.env.AWS_S3_SECRET,
  },
});

function publishLog(log, code = "DEFAULT_LOG") {
  publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log, code }));
}

async function setupS3Bucket() {
  try {
    // Create the bucket
    await s3_client.send(new CreateBucketCommand({ Bucket: bucketName }));

    // Disable "Block all public access"
    const publicAccessBlockParams = {
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    };
    await s3_client.send(
      new PutPublicAccessBlockCommand(publicAccessBlockParams)
    );

    // Enable static website hosting
    const websiteParams = {
      Bucket: bucketName,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: "index.html" },
      },
    };
    await s3_client.send(new PutBucketWebsiteCommand(websiteParams));

    // Set the bucket policy to allow public read access
    const bucketPolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucketName}/*`,
        },
      ],
    };

    const policyParams = {
      Bucket: bucketName,
      Policy: JSON.stringify(bucketPolicy),
    };
    await s3_client.send(new PutBucketPolicyCommand(policyParams));

    // Construct the website endpoint URL
    const websiteEndpoint = `http://${bucketName}.s3-website.${region}.amazonaws.com`;

    return websiteEndpoint;
  } catch (err) {
    console.error("Error setting up S3 bucket:", err);
  }
}

async function init() {
  const output_dir = path.join(__dirname, "output");

  publishLog("Build Started...", "BUILD_STARTED");
  publishLog("Building Project...", "BUILDING");
  const p = exec(`cd ${output_dir} && npm install && npm run build`);

  p.stdout.on("data", function (data) {
    publishLog(data.toString(), "BUILD_DATA");
  });

  p.stdout.on("error", function (error) {
    publishLog(error.toString(), "ERROR");
    console.log(error.toString());
  });

  p.on("close", async function () {
    publishLog("Build Completed...", "BUILD_COMPLETED");

    const websiteEndpoint = await setupS3Bucket();

    const build_dir = path.join(__dirname, "output", "dist");
    const build_dir_contents = fs.readdirSync(build_dir, { recursive: true });

    publishLog("Deployment Started...", "DEPLOYMENT_STARTED");
    publishLog(`Deploying...`, "DEPLOYING");
    for (const file of build_dir_contents) {
      const file_path = path.join(build_dir, file);
      if (fs.lstatSync(file_path).isDirectory()) continue;

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: `${file}`,
        Body: fs.createReadStream(file_path),
        ContentType: mime.lookup(file_path),
      });

      await s3_client.send(command);
    }
    publishLog(`Deployed...`, "DEPLOYED");

    publishLog(`${websiteEndpoint}`, "PROJECT_ENDPOINT");
  });
}

init();
