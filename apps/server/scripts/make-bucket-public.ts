import { S3Client, PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";

config();

const client = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "admin",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "password123",
  },
  forcePathStyle: true,
});

const bucketName = process.env.S3_BUCKET_NAME || "beatsync-bucket";

const policy = {
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

async function run() {
  try {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: JSON.stringify(policy),
      })
    );
    console.log(`✅ Successfully set bucket "${bucketName}" to public read!`);
  } catch (err) {
    console.error("❌ Failed to set policy:", err);
  }
}

run();
