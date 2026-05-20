import { Handler } from "@netlify/functions";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const handler: Handler = async (event) => {
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
  const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing R2 Config" }) };
  }

  const urlStr = event.queryStringParameters?.url;
  
  if (!urlStr) {
     return { statusCode: 400, body: "URL is required" };
  }

  try {
    const accountId = R2_ACCOUNT_ID.replace(/^https?:\/\//, '').replace(/\.r2\.cloudflarestorage\.com.*$/, '').replace(/\/$/, '');
    
    const s3 = new S3Client({
      region: "auto",
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
    });

    const r2Base = (process.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, "");
    let key = urlStr;
    
    if (key.startsWith(r2Base)) {
      key = key.substring(r2Base.length);
    }
    
    // Clean up the key
    key = key.split('?')[0];
    if (key.startsWith('/')) key = key.substring(1);
    
    // Redirect non-R2 URLs
    if (!urlStr.includes('r2.dev') && !urlStr.includes(R2_BUCKET_NAME)) {
         return {
             statusCode: 302,
             headers: { Location: urlStr }
         };
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });

    // Generate a pre-signed URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    // Redirect the browser to the pre-signed URL
    // Cache the redirect itself for a short time so the browser doesn't hit our function on every reload
    return {
      statusCode: 302,
      headers: {
        Location: presignedUrl,
        'Cache-Control': 'public, max-age=1800' // Cache redirect for 30 minutes
      }
    };
  } catch (error: any) {
    console.error("image proxy redirect error:", error);
    // Fallback redirect to the raw url
    return {
        statusCode: 302,
        headers: { Location: urlStr }
    };
  }
};
