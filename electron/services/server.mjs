// 本地音频流服务：/stream 支持 Range（拖动进度条）、/cover 封面
import express from "express";
import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";
import { createServer } from "node:http";

const MIME = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wma": "audio/x-ms-wma",
};

export class MediaServer {
  constructor(library) {
    this.library = library;
    this.app = express();
    this.port = null;

    this.app.get("/stream", (req, res) => {
      const p = String(req.query.p || "");
      let stat;
      try {
        stat = statSync(p);
      } catch {
        res.status(404).end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      const type = MIME[extname(p).toLowerCase()] || "audio/mpeg";
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (start >= stat.size) {
          res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
          return;
        }
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": type,
        });
        createReadStream(p, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": type,
          "Accept-Ranges": "bytes",
        });
        createReadStream(p).pipe(res);
      }
    });

    this.app.get("/cover", (req, res) => {
      const id = String(req.query.id || "");
      // 通过曲库查封面路径（安全：不接受任意路径）
      const track = this.library.store.getTracks().find((t) => t.coverId === id);
      const p = track ? this.library.coverPath(track) : null;
      if (!p) {
        res.status(404).end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.sendFile(p);
    });
  }

  async start() {
    const server = createServer(this.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.port = server.address().port;
    return this.port;
  }
}
