import dns from 'dns';
import ipaddr from 'ipaddr.js';

export async function checkSSRFSafe(urlStr: string): Promise<{ safe: boolean; error?: string }> {
  if (!urlStr) {
    return { safe: true };
  }
  
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch (e) {
    return { safe: false, error: '无效的 URL 格式' };
  }

  // 1. Check protocol
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { safe: false, error: `不支持的协议类型: ${parsedUrl.protocol}` };
  }

  const hostname = parsedUrl.hostname;

  // Function to check if IP is a private/internal network
  const isPrivateIP = (ipString: string): boolean => {
    try {
      const addr = ipaddr.parse(ipString);
      const range = addr.range();
      // "unicast" represents public rutable IP
      return range !== 'unicast';
    } catch (e) {
      return false; // Can't parse IP (might be a hostname still)
    }
  };

  // If the hostname itself is an IP address
  if (ipaddr.isValid(hostname)) {
    if (isPrivateIP(hostname)) {
      return { safe: false, error: '禁止使用内网直连 IP' };
    }
    return { safe: true };
  }

  // If hostname is localhost or ends with common internal domains
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === 'host.docker.internal' || hostname.includes('mybay-agent.host')) {
      return { safe: false, error: '禁止解析受限的内网域名' };
  }

  // 2. perform DNS resolution
  try {
    const addresses = await new Promise<string[]>((resolve, reject) => {
      dns.resolve(hostname, (err, records) => {
        if (err) return reject(err);
        resolve(records);
      });
    });

    if (!addresses || addresses.length === 0) {
      return { safe: false, error: '无法解析所提供域名的 DNS' };
    }

    // Check every resolved IP address
    for (const ip of addresses) {
      if (isPrivateIP(ip)) {
        return { safe: false, error: '该域名解析到受限的内部 IP 地址，存在 SSRF 风险' };
      }
    }

    return { safe: true };
  } catch (e: any) {
    // If it's a domain that doesn't exist etc.
    return { safe: false, error: '域名解析失败: ' + e.message };
  }
}
