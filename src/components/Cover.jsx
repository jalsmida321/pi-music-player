import React, { useState } from "react";

// 封面缩略图：有封面显示图片，无封面显示首字渐变占位
export default function Cover({ track, port, size = 30, rounded = 0.28 }) {
  const [err, setErr] = useState(false);
  const url = track?.coverId && port ? `http://127.0.0.1:${port}/cover?id=${track.coverId}` : null;
  const style = {
    width: size,
    height: size,
    borderRadius: Math.round(size * rounded),
    flexShrink: 0,
    objectFit: "cover",
  };
  if (!url || err) {
    const title = track?.title || "♪";
    let hue = 0;
    for (const ch of title) hue = (hue * 31 + ch.charCodeAt(0)) >>> 0;
    hue = hue % 360;
    return (
      <div
        style={{
          ...style,
          background: `linear-gradient(135deg, hsl(${hue}, 42%, 74%), hsl(${(hue + 45) % 360}, 42%, 58%))`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 600,
          fontSize: Math.round(size * 0.4),
        }}
      >
        {title[0]}
      </div>
    );
  }
  return <img src={url} style={style} onError={() => setErr(true)} alt="" />;
}
