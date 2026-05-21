import { Handler } from "@netlify/functions";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const VITE_R2_PUBLIC_URL = process.env.VITE_R2_PUBLIC_URL;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
     return { statusCode: 500, body: JSON.stringify({ error: "Missing Cloudflare keys in Netlify Environment Variables" }) };
  }

  try {
    const accountId = R2_ACCOUNT_ID.replace(/^https?:\/\//, '').replace(/\.r2\.cloudflarestorage\.com.*$/, '').replace(/\/$/, '');
    
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    const body = JSON.parse(event.body || "{}");
    const { fileName, fileType } = body;
    
    if (!fileName || !fileType) {
      return { statusCode: 400, body: JSON.stringify({ error: "fileName and fileType required" }) };
    }

    const uniqueId = Math.random().toString(36).substring(2);
    const filePath = `uploads/${Date.now()}_${uniqueId}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME!,
      Key: filePath,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    const cleanPublicUrlBase = VITE_R2_PUBLIC_URL!.replace(/\/$/, "");
    const publicUrl = `${cleanPublicUrlBase}/${filePath.split('/').map(v => encodeURIComponent(v)).join('/')}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ presignedUrl, publicUrl, filePath }),
    };
  } catch (error) {
    console.error("Presign error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate URL" }) };
  }
};
