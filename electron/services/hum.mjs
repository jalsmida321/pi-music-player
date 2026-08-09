// 哼唱识别：ACRCloud Identify Protocol V1（免费档 500 次/天，支持哼唱识别）
import { createHmac } from "node:crypto";

// 项目 Host 在控制台可见（每个项目唯一）；未配置时按区域回退尝试
const FALLBACK_HOSTS = [
  "identify-eu-west-1.acrcloud.com",
  "identify-us-east-1.acrcloud.com",
  "identify-ap-southeast-1.acrcloud.com",
];

function normalizeHost(host) {
  if (!host) return null;
  return String(host)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * @param {Buffer} wavBuffer 8kHz 单声道 16-bit PCM WAV
 * @param {{host?:string, accessKey:string, accessSecret:string}} cfg
 */
export async function acrCloudIdentify(wavBuffer, cfg) {
  if (!cfg?.accessKey || !cfg?.accessSecret) {
    return { ok: false, error: "未配置 ACRCloud Key，请到「设置 → 哼唱识别」填写（免费注册：console.acrcloud.com）" };
  }
  const hosts = [
    ...(normalizeHost(cfg.host) ? [normalizeHost(cfg.host)] : []),
    ...FALLBACK_HOSTS.filter((h) => h !== normalizeHost(cfg.host)),
  ];

  const ts = Math.floor(Date.now() / 1000);
  // v1 协议签名：string_to_sign = METHOD + "\n" + URI + "\n" + access_key + "\n" + data_type + "\n" + signature_version + "\n" + timestamp
  const stringToSign = `POST\n/v1/identify\n${cfg.accessKey}\naudio\n1\n${ts}`;
  const sig = createHmac("sha1", cfg.accessSecret).update(stringToSign).digest("base64");

  let lastErr = null;
  for (const host of hosts) {
    try {
      const form = new FormData();
      form.append("access_key", cfg.accessKey);
      form.append("data_type", "audio");
      form.append("signature", sig);
      form.append("signature_version", "1");
      form.append("timestamp", String(ts));
      form.append("sample_bytes", String(wavBuffer.length));
      form.append("sample", new Blob([wavBuffer], { type: "audio/wav" }), "hum.wav");

      const res = await fetch(`https://${host}/v1/identify`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => null);
      if (!data) {
        return { ok: false, error: `识别服务响应异常（HTTP ${res.status}，节点 ${host}），请稍后重试` };
      }
      if (data.status?.code !== 0) {
        const msg = data.status?.msg || `HTTP ${res.status}`;
        const code = data.status?.code;
        // 认证类错误无需再试其他节点
        if (/key|secret|auth|signature|timestamp/i.test(msg)) {
          return { ok: false, error: `识别服务拒绝：${msg}（code ${code}）— 请检查 Access Key / Secret Key` };
        }
        lastErr = `${msg}（code ${code}，节点 ${host}）`;
        continue; // 参数类错误换个节点试试
      }
      const music = data.metadata?.music;
      if (!music || music.length === 0) {
        return {
          ok: false,
          error:
            `服务端未匹配到（code ${data.status?.code ?? "?"}）。最常见原因：` +
            `① 控制台项目 Audio Engine 未勾选「Cover Song (humming) Identification」；` +
            `② 哼唱与录音质量（安静环境、哼 10 秒以上、旋律清晰）。` +
            `本次音频已保存到 用户数据目录/debug/hum_last.wav，可发给开发者排查。`,
        };
      }
      const top = music[0];
      return {
        ok: true,
        result: {
          title: top.title,
          artists: (top.artists || []).map((a) => a.name),
          album: top.album?.name || null,
          score: top.score,
        },
      };
    } catch (e) {
      lastErr = `无法连接 ${host}（${e?.message || e}）`;
      continue; // DNS/网络失败 → 换节点
    }
  }
  return {
    ok: false,
    error:
      `${lastErr || "识别失败"}。请确认：① 设置里 Host/Key 填的是控制台「你的项目」里的值；` +
      `② 项目 Audio Engine 勾选了「Cover Song (humming) Identification」`,
  };
}
