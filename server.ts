import express from "express";
import cors from "cors";
import path from "path";
import { S3Client, PutObjectCommand, DeleteObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServer as createViteServer } from "vite";
import sharp from "sharp";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Check required environment variables
  const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
  const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
  const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
  const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
  const VITE_R2_PUBLIC_URL = process.env.VITE_R2_PUBLIC_URL;

  const isR2Configured = Boolean(
    R2_ACCOUNT_ID &&
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY &&
    R2_BUCKET_NAME &&
    VITE_R2_PUBLIC_URL
  );

  let s3: S3Client | null = null;
  if (isR2Configured) {
    const accountId = R2_ACCOUNT_ID!.replace(/^https?:\/\//, '').replace(/\.r2\.cloudflarestorage\.com.*$/, '').replace(/\/$/, '');
    s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  // --- API ROUTES ---

// API ROUTES
  app.get("/api/health", async (req, res) => {
    try {
       const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
       const list = s3 ? await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, MaxKeys: 100 })) : null;
       res.json({ status: "ok", r2Configured: isR2Configured, keys: list?.Contents?.map(c => c.Key) });
    } catch(e) {
       res.json({ status: "ok", error: e.toString() });
    }
  });

  // Generate a Pre-signed URL for uploading
  app.get("/api/image-proxy", async (req, res) => {
    if (!s3 || !isR2Configured) {
      return res.status(500).json({ error: "R2 is not configured" });
    }

    try {
      const urlStr = req.query.url as string;
      const width = parseInt(req.query.w as string) || undefined;
      const height = parseInt(req.query.h as string) || undefined;
      const quality = parseInt(req.query.q as string) || 80;

      if (!urlStr) {
         return res.status(400).json({ error: "URL is required" });
      }

      // Extract filePath from the provided public URL
      const r2Base = (VITE_R2_PUBLIC_URL || '').replace(/\/$/, "");
      let key = urlStr;
      
      if (key.startsWith(r2Base)) {
        key = key.substring(r2Base.length);
      }
      
      // Clean up the key: remove leading slashes and any query parameters
      key = key.split('?')[0];
      if (key.startsWith('/')) key = key.substring(1);
      
      try {
        key = decodeURIComponent(key);
      } catch (e) {
        // ignore
      }

      // Fetch the image directly from the provided URL
      let dataBuffer: Buffer;
      try {
         const fileRes = await fetch(urlStr);
         if (!fileRes.ok) {
            return res.status(404).json({ error: "Image not found at source" });
         }
         const arrayBuffer = await fileRes.arrayBuffer();
         dataBuffer = Buffer.from(arrayBuffer);
      } catch (e) {
         console.error('Failed to fetch image from source URL:', e);
         return res.status(500).json({ error: "Failed to download image" });
      }

      const isWebpOptIn = req.headers.accept?.includes('image/webp');
      const format = isWebpOptIn ? 'webp' : 'jpeg';

      res.set('Content-Type', `image/${format}`);
      res.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache

      let transform = sharp(dataBuffer);
      
      if (format === 'webp') {
          transform = transform.webp({ quality });
      } else {
          transform = transform.jpeg({ quality });
      }

      if (width || height) {
         transform = transform.resize({ 
             width, 
             height, 
             fit: height ? 'cover' : 'inside', 
             withoutEnlargement: true 
         });
      }
      
      const resizedBuffer = await transform.toBuffer();
      res.send(resizedBuffer);

    } catch (e) {
      console.error(`image proxy error`, e);
      res.redirect(req.query.url as string);
    }
  });

  app.post("/api/upload-url", async (req, res) => {
    if (!s3 || !isR2Configured) {
      return res.status(500).json({ error: "R2 is not configured on the server" });
    }

    try {
      const { fileName, fileType } = req.body;
      
      if (!fileName || !fileType) {
         return res.status(400).json({ error: "fileName and fileType are required" });
      }

      // Generate a unique file path while preserving the original file name
      const uniqueId = Math.random().toString(36).substring(2);
      const filePath = `uploads/${Date.now()}_${uniqueId}/${fileName}`;

      const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: filePath,
        ContentType: fileType,
      });

      // URL expires in 15 minutes
      const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      
      // Clean up the public URL to ensure no double slashes
      const cleanPublicUrlBase = VITE_R2_PUBLIC_URL!.replace(/\/$/, "");
      // Encode the file path for the public URL so spaces and special characters work
      const publicUrl = `${cleanPublicUrlBase}/${filePath.split('/').map(v => encodeURIComponent(v)).join('/')}`;

      res.json({
        presignedUrl,
        publicUrl,
        filePath
      });
    } catch (e: any) {
      console.error("Presign error:", e);
      res.status(500).json({ error: "Failed to generate upload URL." });
    }
  });

  // Delete an object or objects
  app.post("/api/delete-file", async (req, res) => {
    if (!s3 || !isR2Configured) {
      return res.status(500).json({ error: "R2 is not configured" });
    }

    try {
      const { filePath, filePaths } = req.body;
      const pathsToDelete = filePaths || (filePath ? [filePath] : []);

      if (pathsToDelete.length === 0) {
        return res.status(400).json({ error: "No files to delete" });
      }

      for (let i = 0; i < pathsToDelete.length; i += 1000) {
        const chunk = pathsToDelete.slice(i, i + 1000);
        const command = new DeleteObjectsCommand({
          Bucket: R2_BUCKET_NAME!,
          Delete: {
            Objects: chunk.filter(Boolean).map((Key: string) => ({ Key })),
            Quiet: true,
          },
        });
        await s3.send(command);
      }
      
      res.json({ success: true });
    } catch (e) {
      console.error("Delete error:", e);
      res.status(500).json({ error: "Failed to delete file(s) from R2." });
    }
  });

  // Delete an entire folder using a prefix
  app.post("/api/delete-folder", async (req, res) => {
    if (!s3 || !isR2Configured) {
      return res.status(500).json({ error: "R2 is not configured" });
    }

    try {
      const { folderPath } = req.body;
      if (!folderPath || folderPath === "uploads" || folderPath === "uploads/") {
        return res.status(400).json({ error: "Cannot delete the root folder" });
      }

      const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
      const listCommand = new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME!,
        Prefix: folderPath.endsWith("/") ? folderPath : folderPath + "/",
      });

      const listResult = await s3.send(listCommand) as any;

      if (listResult.Contents && listResult.Contents.length > 0) {
        const pathsToDelete = listResult.Contents.map((obj: any) => obj.Key);
        
        for (let i = 0; i < pathsToDelete.length; i += 1000) {
          const chunk = pathsToDelete.slice(i, i + 1000);
          const command = new DeleteObjectsCommand({
            Bucket: R2_BUCKET_NAME!,
            Delete: {
              Objects: chunk.map((Key: string) => ({ Key })),
              Quiet: true,
            },
          });
          await s3.send(command);
        }
      }
      
      res.json({ success: true });
    } catch (e) {
      console.error("Delete folder error:", e);
      res.status(500).json({ error: "Failed to delete folder from R2." });
    }
  });

  // Proxy the download of original files without compression
  app.get("/api/proxy-download", async (req, res) => {
    try {
      const urlStr = req.query.url as string;
      if (!urlStr) {
         return res.status(400).json({ error: "URL is required" });
      }

      // Fetch the image directly from the provided URL
      const fileRes = await fetch(urlStr);
      if (!fileRes.ok) {
         return res.status(404).json({ error: "Image not found at source" });
      }
      
      // Set appropriate headers for downloading
      const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=31536000"); // 1 year cache
      
      // Stream the response back to the client
      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return res.send(buffer);
    } catch (e) {
      console.error('Failed to proxy download file:', e);
      return res.status(500).json({ error: "Failed to download file" });
    }
  });

  // --- VITE FRONTEND MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
